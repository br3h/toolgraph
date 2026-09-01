-- toolgraph: application tables.
--
-- Row level security is enabled in this file rather than the next one so a table
-- never exists — not even for the width of one migration — without RLS on. The
-- policies themselves live in 20260101000200_rls.sql; until they are created RLS
-- denies everything, which is the safe direction to fail.

/* -------------------------------------------------------------------------- */
/* graphs                                                                      */
/* -------------------------------------------------------------------------- */

-- graph_json holds a ToolGraphDocument (see packages/schema-core/src/types.ts).
-- The default is the empty document for version 1 of that shape, so a row is
-- always readable by the client without a null check.
create table if not exists public.graphs (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  graph_json jsonb not null default
    '{"version":1,"name":"","nodes":[],"edges":[],"servers":[]}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.graphs enable row level security;

-- The dashboard query is "my graphs, most recently touched first"; this index
-- serves it end to end without a sort.
create index if not exists graphs_owner_updated_at_idx
  on public.graphs (owner, updated_at desc);

comment on table public.graphs is
  'One saved toolgraph canvas. graph_json is a ToolGraphDocument and never contains credentials.';

/* -------------------------------------------------------------------------- */
/* graph_versions                                                              */
/* -------------------------------------------------------------------------- */

-- Append-only history. A row is written by the trigger in 20260101000300 with
-- the *previous* graph_json each time graphs.graph_json actually changes, so
-- version N is the document as it stood before edit N+1.
create table if not exists public.graph_versions (
  id uuid primary key default gen_random_uuid(),
  graph_id uuid not null references public.graphs (id) on delete cascade,
  version integer not null check (version > 0),
  graph_json jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id) on delete cascade,
  constraint graph_versions_graph_id_version_key unique (graph_id, version)
);

alter table public.graph_versions enable row level security;

-- The unique constraint's index is (graph_id, version) ascending, which cannot
-- serve "newest first" as a backwards scan cheaply enough for the history pane.
create index if not exists graph_versions_graph_id_version_desc_idx
  on public.graph_versions (graph_id, version desc);

comment on table public.graph_versions is
  'Append-only snapshots of graphs.graph_json. Ownership is inherited from the parent graph; there is deliberately no owner column to drift out of sync.';

/* -------------------------------------------------------------------------- */
/* mcp_server_connections                                                      */
/* -------------------------------------------------------------------------- */

create table if not exists public.mcp_server_connections (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  transport text not null check (transport in ('stdio', 'sse', 'http')),
  url text,
  command text,
  args text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mcp_server_connections_owner_name_key unique (owner, name),
  -- A connection is unusable without the field its transport actually dials, so
  -- the database refuses the half-filled row rather than leaving the engine to
  -- discover it at connect time.
  constraint mcp_server_connections_transport_target_check check (
    (transport = 'stdio' and command is not null and char_length(command) > 0)
    or (transport in ('sse', 'http') and url is not null and char_length(url) > 0)
  )
);

alter table public.mcp_server_connections enable row level security;

create index if not exists mcp_server_connections_owner_updated_at_idx
  on public.mcp_server_connections (owner, updated_at desc);

comment on table public.mcp_server_connections is
  'How to reach one MCP server. There is NO credential column here, by design: '
  'per-server auth material (bearer tokens, API keys, stdio env vars) is supplied '
  'by the client at connect time, passed straight through to the transport, and '
  'never persisted in this table. See McpConnectionSecrets in '
  'packages/schema-core/src/types.ts. If persistence is ever genuinely required, '
  'Supabase Vault is the only sanctioned path — store the ciphertext id, never the '
  'secret. Sketch of that path, intentionally left commented out: '
  '  -- select vault.create_secret(''<token>'', ''mcp:'' || id::text, ''MCP bearer token''); '
  '  -- alter table public.mcp_server_connections add column secret_id uuid references vault.secrets (id); '
  'Reading it back goes through vault.decrypted_secrets, which is not exposed to '
  'the anon or authenticated roles.';

comment on column public.mcp_server_connections.url is
  'Endpoint for the sse and http transports. Null for stdio.';
comment on column public.mcp_server_connections.command is
  'Executable to spawn for the stdio transport. Null for sse and http.';

/* -------------------------------------------------------------------------- */
/* execution_runs                                                              */
/* -------------------------------------------------------------------------- */

create table if not exists public.execution_runs (
  id uuid primary key default gen_random_uuid(),
  graph_id uuid not null references public.graphs (id) on delete cascade,
  owner uuid not null references auth.users (id) on delete cascade,
  status text not null check (status in ('running', 'succeeded', 'failed', 'cancelled')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  step_count integer not null default 0 check (step_count >= 0),
  -- Bounded so a runaway stack trace cannot be used to bloat a row; the full
  -- error stays in the streamed ExecutionEvent, not in the database.
  error_summary text check (char_length(error_summary) <= 2000)
);

alter table public.execution_runs enable row level security;

-- Two access paths: the run history of one graph, and "everything I ran".
create index if not exists execution_runs_graph_id_started_at_idx
  on public.execution_runs (graph_id, started_at desc);
create index if not exists execution_runs_owner_started_at_idx
  on public.execution_runs (owner, started_at desc);

comment on table public.execution_runs is
  'One execution of a graph. Per-step detail is streamed as ExecutionEvent values and is not persisted here.';
