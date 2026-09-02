-- toolgraph: billing.
--
-- One paid plan, $15 a month, settled only in cryptocurrency. There is no card
-- processor and therefore no webhook: the user sends funds to a fixed address,
-- tells us the transaction hash, and the server reads the chain itself. Two
-- tables carry that.
--
--   public.subscriptions        — one row per account. The entitlement.
--   public.payment_submissions  — one row per claimed payment. The audit trail.
--
-- Tables, RLS and grants live together in this file rather than split across
-- three the way the original schema was. The ordering below still holds the
-- property that matters: `enable row level security` is in the same statement
-- block as the table, so neither table exists for even one statement without
-- RLS on, and until the policies are created RLS denies everything.
--
-- The rules from 20260101000200_rls.sql apply unchanged:
--
--   1. One policy per operation per table. No FOR ALL.
--   2. Every policy is `to authenticated`; `anon` is revoked outright so RLS is
--      not the only thing between an anonymous request and a row.
--   3. auth.uid() is wrapped as `(select auth.uid())` so Postgres evaluates it
--      once per statement as a stable initplan rather than once per row.
--   4. An UPDATE policy carries both `using` and `with check`.

/* -------------------------------------------------------------------------- */
/* subscriptions                                                               */
/* -------------------------------------------------------------------------- */

-- status is the *verified* state and nothing softer:
--
--   none     no payment has ever been claimed.
--   pending  a payment has been submitted and is not yet verified. NOT paid.
--   active   a payment was verified on chain and current_period_end is future.
--   expired  the paid period has run out.
--
-- Nothing in the product may treat 'pending' as entitlement. Showing someone as
-- subscribed before the chain has confirmed their transaction is the exact
-- failure this column exists to prevent.
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users (id) on delete cascade,
  status text not null default 'none'
    check (status in ('none', 'pending', 'active', 'expired')),
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One subscription per account, and the target of the server's upsert. It
  -- also *is* the index on (owner): a unique constraint is backed by a btree on
  -- exactly that column, so a separate `create index ... (owner)` would be a
  -- second copy of the same structure for the planner to maintain and never
  -- choose. Every read of this table is "the row for this user", and this
  -- constraint serves it.
  constraint subscriptions_owner_key unique (owner)
);

alter table public.subscriptions enable row level security;

comment on table public.subscriptions is
  'One row per account holding the paid-plan entitlement. Written only by the server with the service key; users have select and nothing else.';

comment on column public.subscriptions.status is
  'none | pending | active | expired. ''pending'' is a claim, not an entitlement — only ''active'' with a future current_period_end means paid.';

/* -------------------------------------------------------------------------- */
/* payment_submissions                                                         */
/* -------------------------------------------------------------------------- */

-- One row per claimed payment, kept whatever the outcome. A rejected claim is
-- as much a part of the record as a verified one: it is what makes a support
-- conversation about a real payment that failed verification possible.
--
-- amount_reported is what the *chain* said, stored as a decimal string rather
-- than a float — 0.1 ETH is not representable in binary floating point and
-- money must not be rounded on its way into the audit trail.
create table if not exists public.payment_submissions (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users (id) on delete cascade,
  currency text not null check (currency in ('ETH', 'USDT', 'BTC')),
  tx_hash text not null check (char_length(tx_hash) between 10 and 120),
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'rejected')),
  amount_reported text,
  usd_at_verification numeric,
  failure_reason text check (char_length(failure_reason) <= 500),
  submitted_at timestamptz not null default now(),
  verified_at timestamptz,
  -- THE most important constraint in this file.
  --
  -- Without it a single real payment can be claimed again and again — by the
  -- person who made it, or by anyone else who reads the hash off a public block
  -- explorer, since every hash here is public data. Each claim would verify
  -- successfully, because the chain does say that transaction paid us, and each
  -- one would mint another 30 days of subscription. One payment, unlimited
  -- subscriptions.
  --
  -- The database is the right place for this and application code is not: two
  -- concurrent submissions of the same hash would both pass a "have we seen
  -- this?" SELECT before either INSERT lands. A unique index cannot be raced.
  -- The scope is (currency, tx_hash) and not tx_hash alone because the hash
  -- spaces are separate chains, and it is not scoped by owner because a replay
  -- by a *different* account is the case that matters most.
  constraint payment_submissions_currency_tx_hash_key unique (currency, tx_hash)
);

alter table public.payment_submissions enable row level security;

-- The billing page lists "my submissions, newest first"; this index serves that
-- end to end without a sort.
create index if not exists payment_submissions_owner_submitted_at_idx
  on public.payment_submissions (owner, submitted_at desc);

comment on table public.payment_submissions is
  'One row per claimed crypto payment, kept whether it verified or was rejected. Inserted by the user as ''pending''; only the server may move it on.';

comment on constraint payment_submissions_currency_tx_hash_key on public.payment_submissions is
  'Replay guard. A transaction hash is public, so without this constraint one real payment could be claimed by any number of accounts and each claim would verify.';

comment on column public.payment_submissions.amount_reported is
  'What the chain reported, as an exact decimal string. Never a float — binary floating point cannot represent most amounts.';

/* -------------------------------------------------------------------------- */
/* Table grants                                                                */
/* -------------------------------------------------------------------------- */

-- RLS governs which ROWS a role may touch; GRANTs govern whether it may touch
-- the table at all. 20260102000000_service_role_grants.sql exists because the
-- first schema granted the API roles but never service_role, and every
-- service-key write failed with "permission denied for table" before RLS was
-- ever consulted. These tables are written exclusively by the service key, so
-- the same omission here would break billing outright.
grant select, insert, update, delete on table public.subscriptions to service_role;
grant select, insert, update, delete on table public.payment_submissions to service_role;

-- What `authenticated` is allowed to do at the table level is a hard ceiling
-- under the policies below, deliberately narrower than the usual CRUD grant:
-- the entitlement table is read-only to users, and a submission can be created
-- but never edited or withdrawn.
grant select on table public.subscriptions to authenticated;
grant select, insert on table public.payment_submissions to authenticated;

-- `anon` stays revoked: an unauthenticated request is stopped by the grant
-- layer, before RLS is reached.
revoke all on table public.subscriptions from anon;
revoke all on table public.payment_submissions from anon;

/* -------------------------------------------------------------------------- */
/* subscriptions — RLS                                                         */
/* -------------------------------------------------------------------------- */

drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own
  on public.subscriptions
  for select
  to authenticated
  using ((select auth.uid()) = owner);

-- The next three policies exist to be denials, and they are written out rather
-- than left absent on purpose.
--
-- A user who can write their own subscriptions row can set status = 'active'
-- and current_period_end = now() + 100 years, and has granted themselves the
-- paid plan without paying. That is the whole security model of this table:
-- status is a server assertion about what the chain showed, so only the service
-- key may write it.
--
-- An absent policy already denies — RLS is deny-by-default — but an absent
-- policy is indistinguishable from an oversight when someone reads this file in
-- a year, and "add the missing insert policy" is a plausible mistake to make.
-- A policy that says `false` cannot be misread. The `grant select`-only above
-- is the second, independent layer.

drop policy if exists subscriptions_insert_never on public.subscriptions;
create policy subscriptions_insert_never
  on public.subscriptions
  for insert
  to authenticated
  with check (false);

drop policy if exists subscriptions_update_never on public.subscriptions;
create policy subscriptions_update_never
  on public.subscriptions
  for update
  to authenticated
  using (false)
  with check (false);

drop policy if exists subscriptions_delete_never on public.subscriptions;
create policy subscriptions_delete_never
  on public.subscriptions
  for delete
  to authenticated
  using (false);

/* -------------------------------------------------------------------------- */
/* payment_submissions — RLS                                                   */
/* -------------------------------------------------------------------------- */

drop policy if exists payment_submissions_select_own on public.payment_submissions;
create policy payment_submissions_select_own
  on public.payment_submissions
  for select
  to authenticated
  using ((select auth.uid()) = owner);

-- Two conjuncts, and the second is not decoration. `owner` stops a user filing
-- a claim against somebody else's account. `status = 'pending'` stops them
-- inserting a row that is *already* 'verified' — the verification pipeline and
-- any admin view read that column to decide what has been settled, and a user
-- who can write it directly can declare their own payment good without a
-- transaction existing at all. A claim enters this table as a claim.
drop policy if exists payment_submissions_insert_own on public.payment_submissions;
create policy payment_submissions_insert_own
  on public.payment_submissions
  for insert
  to authenticated
  with check (
    (select auth.uid()) = owner
    and status = 'pending'
  );

-- No update: the outcome of a verification is the server's to write, and a user
-- who could edit tx_hash after the fact could point a rejected row at a valid
-- transaction. No delete: the audit trail is append-only, and a user who could
-- delete a row could delete the record of a hash and clear the way to replay it
-- past the unique constraint above.

drop policy if exists payment_submissions_update_never on public.payment_submissions;
create policy payment_submissions_update_never
  on public.payment_submissions
  for update
  to authenticated
  using (false)
  with check (false);

drop policy if exists payment_submissions_delete_never on public.payment_submissions;
create policy payment_submissions_delete_never
  on public.payment_submissions
  for delete
  to authenticated
  using (false);

/* -------------------------------------------------------------------------- */
/* Triggers                                                                    */
/* -------------------------------------------------------------------------- */

-- public.set_updated_at() is the shared helper from 20260101000000_init.sql:
-- `security definer` with an empty search_path, revoked from public. Reused
-- rather than redefined so there is one implementation to audit.
--
-- payment_submissions gets no such trigger: it has no updated_at column, and it
-- should not — submitted_at and verified_at are two distinct facts about a row
-- that is written once and settled once, not a single "last touched" stamp.
drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row
  execute function public.set_updated_at();
