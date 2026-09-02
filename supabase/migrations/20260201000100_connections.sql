-- toolgraph: connections become a real product surface.
--
-- public.mcp_server_connections has existed since the first migration, with
-- policies and indexes, and nothing has ever written to it. Servers lived only
-- inside graphs.graph_json.servers, which meant a server was scoped to one
-- graph and its URL and Authorization header had to be re-typed on every visit.
--
-- This file makes a connection a first-class, reusable object:
--
--   * it can belong to a workspace instead of a person;
--   * it records health — when it was last reached, and why it last failed;
--   * it caches the tool schemas it advertised, so opening a graph does not
--     require waking the engine and re-introspecting;
--   * it can carry a credential, encrypted, in a table no browser token can
--     reach.
--
-- Nothing here changes graphs.graph_json. A graph that embeds its servers keeps
-- working exactly as before; saved connections are an additional way to get the
-- same McpServerConnection onto a canvas.

/* -------------------------------------------------------------------------- */
/* mcp_server_connections — new columns                                        */
/* -------------------------------------------------------------------------- */

alter table public.mcp_server_connections
  -- NULL means "belongs to the person in `owner`", which is every existing row.
  add column if not exists workspace_id uuid references public.workspaces (id) on delete cascade,

  -- Which provider template produced this. 'mcp' is the generic, hand-configured
  -- server that has always existed; later first-party providers name themselves
  -- here so the UI can show the right icon, scopes and setup copy without
  -- guessing from the URL.
  add column if not exists provider text not null default 'mcp'
    check (provider in ('mcp', 'openapi')),

  -- Health, as three separate facts rather than one overloaded enum:
  --   status            what we last observed
  --   last_checked_at   when we last tried at all
  --   last_success_at   when we last succeeded
  --   last_error        why the last attempt failed, already sanitised
  --
  -- 'untested' is the honest initial state and is NOT 'connected'. A connection
  -- that has never been reached must not display as working.
  add column if not exists status text not null default 'untested'
    check (status in ('untested', 'connected', 'failing')),
  add column if not exists last_checked_at timestamptz,
  add column if not exists last_success_at timestamptz,
  add column if not exists last_error text check (char_length(last_error) <= 500),

  -- The tools the server advertised at last_success_at, as McpToolDescriptor[].
  -- A cache, never a source of truth: every run re-introspects, and the security
  -- checks in the engine run against what the server says now, not against this.
  add column if not exists tools_cache jsonb,
  add column if not exists tool_count integer not null default 0 check (tool_count >= 0),

  -- Set when a credential exists in public.connection_secrets. A boolean here
  -- rather than a join, so the list view can render the padlock without the web
  -- app needing service-role access just to draw a page.
  add column if not exists has_credential boolean not null default false;

-- Exactly one of (owner-scoped, workspace-scoped) is meaningful, but `owner` is
-- kept populated in both cases: it records who created the connection, which is
-- what the audit trail wants, and dropping it would make the not-null and the
-- existing RLS policies impossible to keep.
comment on column public.mcp_server_connections.workspace_id is
  'When set, the connection is shared with the workspace and every member can use it. NULL means personal to `owner`. Existing rows are all NULL, so their behaviour is unchanged.';

comment on column public.mcp_server_connections.tools_cache is
  'Tools advertised at last_success_at. A cache for rendering the palette without waking the engine — never trusted for execution, which always re-introspects.';

-- The unique constraint was (owner, name), which would stop two members of a
-- workspace each having a personal connection called "staging". Scope it to the
-- container instead: unique per workspace, or unique per person when personal.
alter table public.mcp_server_connections
  drop constraint if exists mcp_server_connections_owner_name_key;

create unique index if not exists mcp_server_connections_personal_name_key
  on public.mcp_server_connections (owner, name)
  where workspace_id is null;

create unique index if not exists mcp_server_connections_workspace_name_key
  on public.mcp_server_connections (workspace_id, name)
  where workspace_id is not null;

create index if not exists mcp_server_connections_workspace_idx
  on public.mcp_server_connections (workspace_id, updated_at desc)
  where workspace_id is not null;

/* -------------------------------------------------------------------------- */
/* mcp_server_connections — RLS, widened for workspaces                        */
/* -------------------------------------------------------------------------- */

-- Each policy gains one disjunct and keeps the original one untouched, so a
-- personal connection (workspace_id IS NULL) is governed by exactly the
-- expression it was before this migration.

drop policy if exists mcp_server_connections_select_own on public.mcp_server_connections;
create policy mcp_server_connections_select_own
  on public.mcp_server_connections
  for select
  to authenticated
  using (
    (select auth.uid()) = owner
    or (workspace_id is not null and public.is_workspace_member(workspace_id))
  );

-- `owner` is still forced to the caller even for a workspace connection: it is
-- the "who added this" record. The workspace clause additionally requires
-- membership, so a member cannot insert a row into a workspace they are not in.
drop policy if exists mcp_server_connections_insert_own on public.mcp_server_connections;
create policy mcp_server_connections_insert_own
  on public.mcp_server_connections
  for insert
  to authenticated
  with check (
    (select auth.uid()) = owner
    and (workspace_id is null or public.is_workspace_member(workspace_id))
  );

-- The `with check` half is what stops a member moving a workspace connection
-- into a workspace they are not in, or out into their own account.
drop policy if exists mcp_server_connections_update_own on public.mcp_server_connections;
create policy mcp_server_connections_update_own
  on public.mcp_server_connections
  for update
  to authenticated
  using (
    (select auth.uid()) = owner
    or (workspace_id is not null and public.is_workspace_member(workspace_id))
  )
  with check (
    (
      (select auth.uid()) = owner
      or (workspace_id is not null and public.is_workspace_member(workspace_id))
    )
    and (workspace_id is null or public.is_workspace_member(workspace_id))
  );

-- Deleting a shared connection breaks it for everybody, so it is an admin
-- action inside a workspace — unlike editing, which any member may do.
drop policy if exists mcp_server_connections_delete_own on public.mcp_server_connections;
create policy mcp_server_connections_delete_own
  on public.mcp_server_connections
  for delete
  to authenticated
  using (
    ((select auth.uid()) = owner and workspace_id is null)
    or (workspace_id is not null and public.can_administer_workspace(workspace_id))
  );

/* -------------------------------------------------------------------------- */
/* connection_secrets                                                          */
/* -------------------------------------------------------------------------- */

-- Where a connection's Authorization header lives, and the most sensitive table
-- in this schema.
--
-- Two independent layers stand between a browser and this data, and both are
-- required:
--
--   1. GRANTS. Neither `anon` nor `authenticated` is granted anything at all —
--      not even SELECT. PostgREST refuses a request from either role before RLS
--      is consulted, so a stolen user JWT cannot read this table by any query.
--      Only `service_role` is granted, and that key exists only in server-side
--      code.
--
--   2. RLS is enabled with NO policies. Deny-by-default. Even if a grant were
--      restored by accident, every row is invisible.
--
-- And the ciphertext itself is a third: the column holds AES-256-GCM output
-- from the application, keyed by CREDENTIAL_ENCRYPTION_KEY, which lives in the
-- host's environment and not in the database. A database dump on its own —
-- including a Supabase backup someone downloads — contains no usable secret.
--
-- What is deliberately NOT here: any column a human might read casually. There
-- is no `hint`, no last-four, no plaintext label beyond the kind of credential.
create table if not exists public.connection_secrets (
  connection_id uuid primary key
    references public.mcp_server_connections (id) on delete cascade,

  -- What the ciphertext decrypts to, so the app knows how to apply it without
  -- decrypting first. Not the value; the shape.
  kind text not null default 'headers' check (kind in ('headers', 'env')),

  -- AES-256-GCM, base64, as `v1.<iv>.<ciphertext>.<tag>`. The version prefix is
  -- what makes a future key rotation or algorithm change a migration rather
  -- than a guess about what each row contains.
  ciphertext text not null check (char_length(ciphertext) between 16 and 20000),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.connection_secrets enable row level security;

comment on table public.connection_secrets is
  'Encrypted per-connection credentials. NOT granted to anon or authenticated — only service_role — and RLS is on with no policies, so it is unreachable from any browser-held token by two independent mechanisms. The value is AES-256-GCM ciphertext keyed outside the database.';

comment on column public.connection_secrets.ciphertext is
  'v1.<iv>.<ciphertext>.<tag>, base64, AES-256-GCM. The key is CREDENTIAL_ENCRYPTION_KEY in the application environment and is never stored here, so a database dump alone yields nothing.';

revoke all on table public.connection_secrets from anon;
revoke all on table public.connection_secrets from authenticated;
grant select, insert, update, delete on table public.connection_secrets to service_role;

drop trigger if exists connection_secrets_set_updated_at on public.connection_secrets;
create trigger connection_secrets_set_updated_at
  before update on public.connection_secrets
  for each row
  execute function public.set_updated_at();

-- Keeps mcp_server_connections.has_credential honest without the application
-- having to remember to update it. The flag is what the UI reads; the row here
-- is what actually exists. Letting them drift would mean a padlock icon that
-- lies in one direction or the other.
create or replace function public.sync_connection_has_credential()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    update public.mcp_server_connections
    set has_credential = false
    where id = old.connection_id;
    return old;
  end if;

  update public.mcp_server_connections
  set has_credential = true
  where id = new.connection_id;
  return new;
end;
$$;

drop trigger if exists connection_secrets_sync_flag on public.connection_secrets;
create trigger connection_secrets_sync_flag
  after insert or update or delete on public.connection_secrets
  for each row
  execute function public.sync_connection_has_credential();
