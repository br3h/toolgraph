-- toolgraph: workspaces.
--
-- The Team plan needs somewhere for a graph to live that is not one person's
-- account. This file adds that, and it is deliberately ADDITIVE: nothing here
-- changes how an existing row behaves.
--
-- The model:
--
--   public.workspaces             — a shared container. Has exactly one owner.
--   public.workspace_members      — who is in it, and with what role.
--   public.workspace_invitations  — a pending invite, addressed to an email.
--
-- Ownership of a graph or a connection becomes "owner = me" OR "workspace_id is
-- a workspace I belong to". Because `workspace_id` is added as a NULLABLE column
-- in a later migration and every existing row keeps NULL, the second disjunct is
-- unreachable for pre-existing data and behaviour is bit-for-bit unchanged. That
-- is the whole backwards-compatibility argument, and it is why the column is
-- nullable rather than backfilled with a personal workspace.
--
-- The rules from 20260101000200_rls.sql still hold: one policy per operation,
-- `to authenticated`, `(select auth.uid())`, and `with check` on every update.

/* -------------------------------------------------------------------------- */
/* workspaces                                                                  */
/* -------------------------------------------------------------------------- */

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  -- The billing subject and the only role that can delete the workspace. Kept
  -- as a column rather than derived from workspace_members so the "a workspace
  -- always has exactly one owner" invariant is a foreign key, not a query.
  owner uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  -- Lowercased, url-safe, and unique across the instance. Not currently routed
  -- on, but a workspace that has to be renamed to get a stable URL later is a
  -- workspace that breaks every link somebody saved.
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.workspaces enable row level security;

create index if not exists workspaces_owner_idx on public.workspaces (owner);

comment on table public.workspaces is
  'A shared container for graphs and connections. Billing for the Team plan attaches to the owner''s subscription, and seats are counted from workspace_members.';

/* -------------------------------------------------------------------------- */
/* workspace_members                                                           */
/* -------------------------------------------------------------------------- */

-- Roles, narrowest first:
--
--   member  read and write graphs; use connections; cannot see credentials,
--           cannot invite, cannot remove anybody.
--   admin   everything a member can do, plus invite and remove members.
--   owner   everything, plus delete the workspace and transfer ownership.
--           Exactly one row per workspace carries it, enforced by the partial
--           unique index below.
create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  constraint workspace_members_workspace_user_key unique (workspace_id, user_id)
);

alter table public.workspace_members enable row level security;

create index if not exists workspace_members_user_idx on public.workspace_members (user_id);

-- One owner per workspace, in the database rather than in a code path somebody
-- can forget to run. A transfer therefore has to demote and promote inside one
-- transaction, which is exactly the property we want.
create unique index if not exists workspace_members_single_owner_idx
  on public.workspace_members (workspace_id)
  where role = 'owner';

comment on table public.workspace_members is
  'Membership and role. Seat count for billing is the number of rows for a workspace.';

/* -------------------------------------------------------------------------- */
/* Membership helpers                                                          */
/* -------------------------------------------------------------------------- */

-- These exist to break a recursion, not to save typing.
--
-- The natural RLS policy for workspace_members is "you can see rows for a
-- workspace you are a member of", which reads workspace_members from inside a
-- workspace_members policy. Postgres detects that as infinite recursion and
-- errors at query time (42P17). A `security definer` function is the sanctioned
-- way out: it runs as the owner, so RLS does not re-enter, and it is the ONLY
-- thing inside these policies that touches the table.
--
-- Both are `stable` so the planner calls them once per statement rather than
-- once per row, and both pin `search_path = ''` for the same reason the trigger
-- helper in 20260101000000_init.sql does — an empty search_path means an
-- unprivileged caller cannot shadow an unqualified name with an object in a
-- schema they control.

create or replace function public.is_workspace_member(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = target
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.workspace_role(target uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.workspace_members m
  where m.workspace_id = target
    and m.user_id = (select auth.uid())
  limit 1;
$$;

-- "admin or owner", which is the check three quarters of the policies below
-- want. Written once so the two role names cannot drift apart between them.
create or replace function public.can_administer_workspace(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.workspace_role(target) in ('owner', 'admin');
$$;

-- These are called from RLS policies evaluated as `authenticated`, so that role
-- must be able to execute them. `anon` is not granted: it has no workspaces.
revoke all on function public.is_workspace_member(uuid) from public;
revoke all on function public.workspace_role(uuid) from public;
revoke all on function public.can_administer_workspace(uuid) from public;

grant execute on function public.is_workspace_member(uuid) to authenticated, service_role;
grant execute on function public.workspace_role(uuid) to authenticated, service_role;
grant execute on function public.can_administer_workspace(uuid) to authenticated, service_role;

/* -------------------------------------------------------------------------- */
/* workspace_invitations                                                       */
/* -------------------------------------------------------------------------- */

-- An invitation is addressed to an EMAIL, because the person may not have an
-- account yet. That makes the email the join key when they eventually sign up,
-- and it is stored lowercased so `Ada@x.com` and `ada@x.com` are one invite.
--
-- There is no token column, and that is deliberate. A token in a link is a
-- bearer credential: anyone who sees the URL joins the workspace, including
-- whoever forwards the mail. Acceptance here requires being signed in as the
-- invited address, which the database checks against auth.users. The invite is
-- therefore not transferable by forwarding it.
create table if not exists public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null check (char_length(email) between 3 and 254 and email = lower(email)),
  role text not null default 'member' check (role in ('admin', 'member')),
  invited_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  constraint workspace_invitations_workspace_email_key unique (workspace_id, email)
);

alter table public.workspace_invitations enable row level security;

create index if not exists workspace_invitations_email_idx
  on public.workspace_invitations (email)
  where accepted_at is null;

comment on table public.workspace_invitations is
  'A pending invite addressed to an email. Deliberately has no bearer token: acceptance requires being signed in as that address, so forwarding the mail does not transfer the invite.';

-- The invited person's own address, read from auth.users rather than trusted
-- from the client. `security definer` because `authenticated` cannot select
-- auth.users directly, which is correct — this exposes one row's email to its
-- own owner and nothing else.
create or replace function public.current_user_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(u.email)
  from auth.users u
  where u.id = (select auth.uid());
$$;

revoke all on function public.current_user_email() from public;
grant execute on function public.current_user_email() to authenticated, service_role;

/* -------------------------------------------------------------------------- */
/* Grants                                                                      */
/* -------------------------------------------------------------------------- */

revoke all on table public.workspaces from anon;
revoke all on table public.workspace_members from anon;
revoke all on table public.workspace_invitations from anon;

grant select, insert, update, delete on table public.workspaces to authenticated;
grant select, insert, update, delete on table public.workspace_members to authenticated;
grant select, insert, update, delete on table public.workspace_invitations to authenticated;

grant select, insert, update, delete on table public.workspaces to service_role;
grant select, insert, update, delete on table public.workspace_members to service_role;
grant select, insert, update, delete on table public.workspace_invitations to service_role;

/* -------------------------------------------------------------------------- */
/* workspaces — RLS                                                            */
/* -------------------------------------------------------------------------- */

drop policy if exists workspaces_select_member on public.workspaces;
create policy workspaces_select_member
  on public.workspaces
  for select
  to authenticated
  using (public.is_workspace_member(id));

-- Creating a workspace means creating one you own. The owner's membership row
-- is written by the trigger below, so there is no window in which a workspace
-- exists with nobody in it.
drop policy if exists workspaces_insert_own on public.workspaces;
create policy workspaces_insert_own
  on public.workspaces
  for insert
  to authenticated
  with check ((select auth.uid()) = owner);

-- Renaming is an admin action.
--
-- The ownership-transfer hole every update policy in this schema has to close
-- cannot be closed with a `with check` clause here: the clause would have to
-- compare the new `owner` against the old one, and an RLS expression only sees
-- one row at a time. It is closed by the `workspaces_freeze_owner` trigger
-- below instead, which is a BEFORE UPDATE and does see both. A real transfer
-- goes through public.transfer_workspace_ownership(), which is `security
-- definer` and so is not filtered by either.
drop policy if exists workspaces_update_admin on public.workspaces;
create policy workspaces_update_admin
  on public.workspaces
  for update
  to authenticated
  using (public.can_administer_workspace(id))
  with check (public.can_administer_workspace(id));

-- Deletion is the owner's alone: it cascades to every graph, connection and
-- membership in the workspace.
drop policy if exists workspaces_delete_owner on public.workspaces;
create policy workspaces_delete_owner
  on public.workspaces
  for delete
  to authenticated
  using ((select auth.uid()) = owner);

/* -------------------------------------------------------------------------- */
/* workspace_members — RLS                                                     */
/* -------------------------------------------------------------------------- */

drop policy if exists workspace_members_select_member on public.workspace_members;
create policy workspace_members_select_member
  on public.workspace_members
  for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

-- No INSERT policy for `authenticated`, on purpose, and written as an explicit
-- denial rather than left absent.
--
-- If a user could insert their own membership row they could join any workspace
-- whose id they can guess or read — and workspace ids travel in URLs. Joining is
-- therefore only possible through public.accept_workspace_invitation(), which is
-- `security definer` and checks that an unexpired invitation exists for the
-- caller's own verified email.
drop policy if exists workspace_members_insert_never on public.workspace_members;
create policy workspace_members_insert_never
  on public.workspace_members
  for insert
  to authenticated
  with check (false);

-- Role changes are an admin action, and cannot touch the owner row: demoting
-- the owner would leave the workspace with no one who can delete or transfer
-- it, and promoting somebody to owner would collide with the single-owner index
-- rather than doing anything useful.
drop policy if exists workspace_members_update_admin on public.workspace_members;
create policy workspace_members_update_admin
  on public.workspace_members
  for update
  to authenticated
  using (public.can_administer_workspace(workspace_id) and role <> 'owner')
  with check (public.can_administer_workspace(workspace_id) and role in ('admin', 'member'));

-- Two ways a membership row goes away, and both are here:
--   an admin removing somebody (but never the owner), or
--   anybody removing themselves, which is "leave workspace".
-- The owner cannot leave; they transfer ownership or delete the workspace.
drop policy if exists workspace_members_delete_admin_or_self on public.workspace_members;
create policy workspace_members_delete_admin_or_self
  on public.workspace_members
  for delete
  to authenticated
  using (
    role <> 'owner'
    and (
      public.can_administer_workspace(workspace_id)
      or user_id = (select auth.uid())
    )
  );

/* -------------------------------------------------------------------------- */
/* workspace_invitations — RLS                                                 */
/* -------------------------------------------------------------------------- */

-- Two audiences: people already in the workspace, and the person invited. The
-- second disjunct is what lets a new signup discover they have been invited.
drop policy if exists workspace_invitations_select_member_or_invitee on public.workspace_invitations;
create policy workspace_invitations_select_member_or_invitee
  on public.workspace_invitations
  for select
  to authenticated
  using (
    public.is_workspace_member(workspace_id)
    or email = public.current_user_email()
  );

drop policy if exists workspace_invitations_insert_admin on public.workspace_invitations;
create policy workspace_invitations_insert_admin
  on public.workspace_invitations
  for insert
  to authenticated
  with check (
    public.can_administer_workspace(workspace_id)
    and invited_by = (select auth.uid())
    and accepted_at is null
  );

-- Nothing about an invitation is editable. Change of mind means revoke and
-- re-send; in particular `accepted_at` must not be writable by a user, since
-- that column is the only record of whether the invite was consumed.
drop policy if exists workspace_invitations_update_never on public.workspace_invitations;
create policy workspace_invitations_update_never
  on public.workspace_invitations
  for update
  to authenticated
  using (false)
  with check (false);

-- An admin revokes; an invitee declines.
drop policy if exists workspace_invitations_delete_admin_or_invitee on public.workspace_invitations;
create policy workspace_invitations_delete_admin_or_invitee
  on public.workspace_invitations
  for delete
  to authenticated
  using (
    public.can_administer_workspace(workspace_id)
    or email = public.current_user_email()
  );

/* -------------------------------------------------------------------------- */
/* Joining, and transferring                                                   */
/* -------------------------------------------------------------------------- */

-- The only path into workspace_members for a non-owner.
--
-- Every guard that matters is inside this function rather than in application
-- code: the invitation must exist, must not have been accepted, must not have
-- expired, and must be addressed to the CALLER'S OWN verified email — read from
-- auth.users, never from an argument. A caller can pass any workspace id they
-- like and still only join one they were actually invited to.
create or replace function public.accept_workspace_invitation(target uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  caller_email text := public.current_user_email();
  invitation public.workspace_invitations%rowtype;
begin
  if caller is null or caller_email is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into invitation
  from public.workspace_invitations i
  where i.workspace_id = target
    and i.email = caller_email
    and i.accepted_at is null
    and i.expires_at > pg_catalog.now()
  for update;

  if not found then
    raise exception 'no open invitation for this account' using errcode = 'P0002';
  end if;

  -- `on conflict do nothing` rather than an error: accepting twice (a
  -- double-clicked button, a retried request) should be idempotent, not a
  -- failure the user has to interpret.
  insert into public.workspace_members (workspace_id, user_id, role)
  values (invitation.workspace_id, caller, invitation.role)
  on conflict (workspace_id, user_id) do nothing;

  update public.workspace_invitations
  set accepted_at = pg_catalog.now()
  where id = invitation.id;

  return invitation.workspace_id;
end;
$$;

revoke all on function public.accept_workspace_invitation(uuid) from public;
grant execute on function public.accept_workspace_invitation(uuid) to authenticated;

-- What the invitee can see before they are a member.
--
-- This exists because of a real gap the policies above create on purpose. An
-- invited person can read their own workspace_invitations row (the `email =
-- current_user_email()` disjunct), but that row carries only a workspace id —
-- and public.workspaces is visible to MEMBERS only, which they are not yet. An
-- invitation screen would therefore have had to say "you have been invited to
-- 4f3a…-9c21", which is not something anybody can act on.
--
-- Widening workspaces_select_member to include invitees would be the wrong fix:
-- it would make every workspace's name and slug readable by anyone who can get
-- an invitation row created for them. This returns the two fields an invite
-- screen needs, for the caller's own open invitations only, and nothing else.
create or replace function public.pending_invitations()
returns table (
  invitation_id uuid,
  workspace_id uuid,
  workspace_name text,
  role text,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.workspace_id, w.name, i.role, i.expires_at
  from public.workspace_invitations i
  join public.workspaces w on w.id = i.workspace_id
  where i.email = public.current_user_email()
    and i.accepted_at is null
    and i.expires_at > pg_catalog.now()
  order by i.created_at;
$$;

revoke all on function public.pending_invitations() from public;
grant execute on function public.pending_invitations() to authenticated;

comment on function public.pending_invitations() is
  'The caller''s own open invitations, with the workspace name. Exists because an invitee is not yet a member and so cannot read public.workspaces — and widening that policy to invitees would leak every workspace name to anyone who can get an invite row created.';

-- Demote-and-promote in one statement pair inside one transaction, because the
-- single-owner partial index makes any other ordering fail. Only the current
-- owner may call it, and only onto an existing member.
create or replace function public.transfer_workspace_ownership(target uuid, new_owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if not exists (
    select 1 from public.workspaces w where w.id = target and w.owner = caller
  ) then
    raise exception 'only the owner can transfer a workspace' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = target and m.user_id = new_owner
  ) then
    raise exception 'the new owner must already be a member' using errcode = 'P0002';
  end if;

  -- Old owner first. The reverse order would have two rows with role='owner'
  -- for the width of one statement, which the partial unique index rejects.
  update public.workspace_members
  set role = 'admin'
  where workspace_id = target and user_id = caller;

  update public.workspace_members
  set role = 'owner'
  where workspace_id = target and user_id = new_owner;

  -- Lets workspaces_freeze_owner know this is the sanctioned path. `true` for
  -- the third argument makes it transaction-local, so it is gone the moment
  -- this statement's transaction ends and cannot leak into a later request on
  -- the same pooled connection.
  perform pg_catalog.set_config('toolgraph.transferring_owner', 'on', true);

  update public.workspaces
  set owner = new_owner
  where id = target;

  perform pg_catalog.set_config('toolgraph.transferring_owner', 'off', true);
end;
$$;

revoke all on function public.transfer_workspace_ownership(uuid, uuid) from public;
grant execute on function public.transfer_workspace_ownership(uuid, uuid) to authenticated;

/* -------------------------------------------------------------------------- */
/* Triggers                                                                    */
/* -------------------------------------------------------------------------- */

-- The creator becomes the owner member. Without this a freshly created
-- workspace is invisible to the person who just created it, because every
-- select policy above is written in terms of membership rather than the
-- `owner` column.
create or replace function public.add_workspace_owner_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, new.owner, 'owner')
  on conflict (workspace_id, user_id) do update set role = 'owner';
  return new;
end;
$$;

drop trigger if exists workspaces_add_owner_member on public.workspaces;
create trigger workspaces_add_owner_member
  after insert on public.workspaces
  for each row
  execute function public.add_workspace_owner_member();

-- The `owner` column is not editable through an ordinary UPDATE by anybody,
-- including the owner. It moves only via transfer_workspace_ownership(), which
-- runs as definer and therefore does not fire this check's `session_user`
-- guard... except that it does fire, since triggers run for definer functions
-- too. So the transfer function sets a transaction-local flag that this trigger
-- honours, and nothing else can set it without already being inside that
-- function.
create or replace function public.freeze_workspace_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner is distinct from old.owner
     and pg_catalog.current_setting('toolgraph.transferring_owner', true) is distinct from 'on' then
    raise exception 'workspace ownership is transferred with transfer_workspace_ownership()'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists workspaces_freeze_owner on public.workspaces;
create trigger workspaces_freeze_owner
  before update on public.workspaces
  for each row
  execute function public.freeze_workspace_owner();

drop trigger if exists workspaces_set_updated_at on public.workspaces;
create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row
  execute function public.set_updated_at();
