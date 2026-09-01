-- toolgraph: triggers.
--
-- public.set_updated_at() is defined in 20260101000000_init.sql alongside the
-- other shared helpers; this file only wires it up and adds the graph
-- versioning trigger.

/* -------------------------------------------------------------------------- */
/* updated_at                                                                  */
/* -------------------------------------------------------------------------- */

drop trigger if exists graphs_set_updated_at on public.graphs;
create trigger graphs_set_updated_at
  before update on public.graphs
  for each row
  execute function public.set_updated_at();

drop trigger if exists mcp_server_connections_set_updated_at on public.mcp_server_connections;
create trigger mcp_server_connections_set_updated_at
  before update on public.mcp_server_connections
  for each row
  execute function public.set_updated_at();

/* -------------------------------------------------------------------------- */
/* graph versioning                                                            */
/* -------------------------------------------------------------------------- */

-- Snapshots the graph_json a row had *before* an update into graph_versions.
--
-- `security definer` because history must be written whether or not the caller
-- could have inserted that row themselves — an admin edit through the service
-- role, a future support tool, a background migration. `set search_path = ''`
-- for the same reason as in the init migration: an empty search path means an
-- unqualified name cannot be hijacked, so every reference below names its
-- schema.
create or replace function public.record_graph_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_version integer;
begin
  -- Belt and braces. The trigger already carries a WHEN clause, but the guard
  -- keeps the function correct if it is ever attached without one. `is distinct
  -- from` rather than `<>` so a null on either side behaves.
  if new.graph_json is not distinct from old.graph_json then
    return new;
  end if;

  -- Safe without an explicit lock: this fires inside the UPDATE that already
  -- holds a row lock on old.id, so two concurrent edits to the same graph are
  -- serialised by Postgres before either one reaches this query. Concurrent
  -- edits to *different* graphs never contend, since max() is scoped by
  -- graph_id. If that row lock ever goes away, the unique (graph_id, version)
  -- constraint is the backstop and the loser of the race aborts rather than
  -- overwriting history.
  select coalesce(max(gv.version), 0) + 1
    into next_version
    from public.graph_versions gv
   where gv.graph_id = old.id;

  -- auth.uid() is null when the write comes from the service role or from psql,
  -- and created_by is not null, so fall back to the graph's owner: the history
  -- row is still attributable to the account the graph belongs to.
  insert into public.graph_versions (graph_id, version, graph_json, created_by)
  values (old.id, next_version, old.graph_json, coalesce((select auth.uid()), old.owner));

  return new;
end;
$$;

comment on function public.record_graph_version() is
  'AFTER UPDATE trigger on public.graphs: appends the previous graph_json to '
  'public.graph_versions when the document actually changed. Title-only or '
  'updated_at-only edits do not create a version.';

revoke all on function public.record_graph_version() from public;

drop trigger if exists graphs_record_version on public.graphs;
create trigger graphs_record_version
  after update on public.graphs
  for each row
  when (old.graph_json is distinct from new.graph_json)
  execute function public.record_graph_version();
