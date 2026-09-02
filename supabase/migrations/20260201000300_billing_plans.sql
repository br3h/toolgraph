-- toolgraph: plans, billing intervals and seats.
--
-- Until now there was one paid plan at $15 a month and a subscription was a
-- status plus an end date. Three things are added, and all three are real
-- billing facts rather than labels on a pricing card:
--
--   plan      free | pro | team
--   interval  monthly | annual  — a different price AND a different period
--   seats     how many people the payment covers (team only)
--
-- The crypto settlement model is unchanged and does not need to change: a
-- payment is a transfer of a USD-equivalent amount, and what the amount buys is
-- (period length x seat count). Annual is not a monthly price shown twelve
-- times; it is a distinct expected amount that grants a distinct period.
--
-- Backwards compatibility: every existing row gets plan='pro', interval='monthly',
-- seats=1, which is exactly what those rows already meant. Nobody's entitlement
-- changes, and nothing that reads `status`/`current_period_end` needs to know
-- these columns exist.

/* -------------------------------------------------------------------------- */
/* subscriptions                                                               */
/* -------------------------------------------------------------------------- */

alter table public.subscriptions
  add column if not exists plan text not null default 'pro'
    check (plan in ('free', 'pro', 'team')),
  add column if not exists billing_interval text not null default 'monthly'
    check (billing_interval in ('monthly', 'annual')),
  add column if not exists seats integer not null default 1
    check (seats between 1 and 200),
  -- The workspace a Team subscription pays for. NULL for pro and free.
  -- Restricted rather than cascaded: deleting a workspace must not silently
  -- delete the record of money someone paid.
  add column if not exists workspace_id uuid references public.workspaces (id) on delete set null;

comment on column public.subscriptions.plan is
  'free | pro | team. Entitlement is still gated on status=''active'' and a future current_period_end; this column says what was bought.';
comment on column public.subscriptions.billing_interval is
  'monthly | annual. Annual is a real period (365 days), not a presentation of the monthly price.';
comment on column public.subscriptions.seats is
  'How many members the Team payment covers. Always 1 for free and pro.';

-- A Team subscription must name the workspace it pays for, and a personal one
-- must not. Without this a "team" row with no workspace would be a plan nobody
-- can be a seat on, and the seat check below would have nothing to count.
alter table public.subscriptions
  drop constraint if exists subscriptions_team_workspace_check;
alter table public.subscriptions
  add constraint subscriptions_team_workspace_check check (
    (plan = 'team' and workspace_id is not null)
    or (plan <> 'team' and workspace_id is null)
  );

alter table public.subscriptions
  drop constraint if exists subscriptions_seats_plan_check;
alter table public.subscriptions
  add constraint subscriptions_seats_plan_check check (
    plan = 'team' or seats = 1
  );

-- One Team subscription per workspace. Two active ones would make "how many
-- seats has this workspace paid for" ambiguous, and ambiguity in an entitlement
-- check resolves in whichever direction the query happens to sort.
create unique index if not exists subscriptions_workspace_key
  on public.subscriptions (workspace_id)
  where workspace_id is not null;

/* -------------------------------------------------------------------------- */
/* payment_submissions                                                         */
/* -------------------------------------------------------------------------- */

-- What the payer said they were buying, recorded at submission time. The server
-- recomputes the expected USD from these three columns rather than trusting a
-- client-supplied amount, so they are the audit trail for "why was $150
-- expected here".
alter table public.payment_submissions
  add column if not exists plan text not null default 'pro'
    check (plan in ('pro', 'team')),
  add column if not exists billing_interval text not null default 'monthly'
    check (billing_interval in ('monthly', 'annual')),
  add column if not exists seats integer not null default 1
    check (seats between 1 and 200),
  add column if not exists workspace_id uuid references public.workspaces (id) on delete set null,
  -- The USD figure the server required for this submission, frozen at the time
  -- it was made. Prices can change; a claim must be judged against what was
  -- quoted when it was filed, and a support conversation six months later needs
  -- this number to exist.
  add column if not exists expected_usd numeric check (expected_usd is null or expected_usd > 0);

comment on column public.payment_submissions.expected_usd is
  'What the server required at submission time, frozen. A claim is judged against the price that was quoted, not against today''s.';

alter table public.payment_submissions
  drop constraint if exists payment_submissions_team_workspace_check;
alter table public.payment_submissions
  add constraint payment_submissions_team_workspace_check check (
    (plan = 'team' and workspace_id is not null)
    or (plan <> 'team' and workspace_id is null)
  );

alter table public.payment_submissions
  drop constraint if exists payment_submissions_seats_plan_check;
alter table public.payment_submissions
  add constraint payment_submissions_seats_plan_check check (
    plan = 'team' or seats = 1
  );

/* -------------------------------------------------------------------------- */
/* payment_submissions — RLS, restated                                         */
/* -------------------------------------------------------------------------- */

-- The insert policy gains one conjunct. A Team claim must name a workspace the
-- caller can actually administer: without it, anyone could file a payment claim
-- against a stranger's workspace id and — on verification — mint seats on it.
drop policy if exists payment_submissions_insert_own on public.payment_submissions;
create policy payment_submissions_insert_own
  on public.payment_submissions
  for insert
  to authenticated
  with check (
    (select auth.uid()) = owner
    and status = 'pending'
    and (workspace_id is null or public.can_administer_workspace(workspace_id))
  );

/* -------------------------------------------------------------------------- */
/* Team entitlement, as a function                                             */
/* -------------------------------------------------------------------------- */

-- "Is this workspace on a paid Team plan right now, and for how many seats?"
--
-- Every caller that gates a workspace feature asks this, and it must be one
-- expression: an entitlement check duplicated across the web app, the engine
-- and a policy is an entitlement check that will disagree with itself. The
-- definition of paid is unchanged from the rest of the schema — status must be
-- 'active' AND the period must not have ended. 'pending' is never entitlement.
create or replace function public.workspace_paid_seats(target uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  -- `coalesce` is a SQL construct rather than a function, so it cannot be (and
  -- does not need to be) schema-qualified the way pg_catalog.now() is below.
  select coalesce(
    (
      select s.seats
      from public.subscriptions s
      where s.workspace_id = target
        and s.plan = 'team'
        and s.status = 'active'
        and s.current_period_end is not null
        and s.current_period_end > pg_catalog.now()
      limit 1
    ),
    0
  );
$$;

revoke all on function public.workspace_paid_seats(uuid) from public;
grant execute on function public.workspace_paid_seats(uuid) to authenticated, service_role;

comment on function public.workspace_paid_seats(uuid) is
  'Seats a workspace has actually paid for right now, or 0. The single definition of Team entitlement — status must be active and the period unexpired.';
