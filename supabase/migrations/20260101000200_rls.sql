-- toolgraph: row level security.
--
-- Rules this file follows, without exception:
--
--   1. One policy per operation per table. No FOR ALL. A policy that covers four
--      operations is a policy nobody can read, and `using` means something
--      different for each of them.
--   2. Every policy is `to authenticated`. Nothing is granted to `anon`, and the
--      table grants below revoke anon's access outright so RLS is not the only
--      thing standing between an anonymous request and a row.
--   3. auth.uid() is wrapped as `(select auth.uid())`. Postgres treats the
--      subselect as a stable initplan and evaluates it once per statement
--      instead of once per row, which is the difference between an index scan
--      and a sequential scan on a large table.
--   4. UPDATE policies carry BOTH `using` and `with check`. `using` decides
--      which rows you may target; `with check` decides what the row is allowed
--      to look like afterwards. With `using` alone, a user can UPDATE their own
--      row and set owner to somebody else's id — the row passes the visibility
--      test on the way in and there is no test on the way out. That is a real
--      ownership-transfer hole, and it is what the `with check` clause on every
--      update policy below closes. There is a regression test for it in
--      supabase/tests/rls.test.ts.

/* -------------------------------------------------------------------------- */
/* Table grants                                                                */
/* -------------------------------------------------------------------------- */

-- Supabase grants the API roles on newly created public tables automatically.
-- These statements make the intended grants explicit rather than inherited, so
-- the schema is correct on a project where that behaviour is switched off, and
-- so `anon` is unambiguously left with nothing.
revoke all on table public.graphs from anon;
revoke all on table public.graph_versions from anon;
revoke all on table public.mcp_server_connections from anon;
revoke all on table public.execution_runs from anon;

grant select, insert, update, delete on table public.graphs to authenticated;
grant select, insert, update, delete on table public.graph_versions to authenticated;
grant select, insert, update, delete on table public.mcp_server_connections to authenticated;
grant select, insert, update, delete on table public.execution_runs to authenticated;

/* -------------------------------------------------------------------------- */
/* graphs                                                                      */
/* -------------------------------------------------------------------------- */

drop policy if exists graphs_select_own on public.graphs;
create policy graphs_select_own
  on public.graphs
  for select
  to authenticated
  using ((select auth.uid()) = owner);

drop policy if exists graphs_insert_own on public.graphs;
create policy graphs_insert_own
  on public.graphs
  for insert
  to authenticated
  with check ((select auth.uid()) = owner);

drop policy if exists graphs_update_own on public.graphs;
create policy graphs_update_own
  on public.graphs
  for update
  to authenticated
  using ((select auth.uid()) = owner)
  with check ((select auth.uid()) = owner);

drop policy if exists graphs_delete_own on public.graphs;
create policy graphs_delete_own
  on public.graphs
  for delete
  to authenticated
  using ((select auth.uid()) = owner);

/* -------------------------------------------------------------------------- */
/* graph_versions                                                              */
/* -------------------------------------------------------------------------- */

-- graph_versions has no owner column on purpose: a denormalised copy of the
-- owner is a copy that can drift. Ownership is derived from the parent graph
-- instead, and because that lookup is itself an ordinary query it is subject to
-- nothing but the foreign key — the EXISTS below reads public.graphs directly
-- rather than through the graphs policies, so a version row is visible exactly
-- when its parent graph belongs to the caller.

drop policy if exists graph_versions_select_own on public.graph_versions;
create policy graph_versions_select_own
  on public.graph_versions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.graphs g
      where g.id = graph_id
        and g.owner = (select auth.uid())
    )
  );

-- The `created_by` clause is the ownership-transfer guard for this table: it
-- stops a user attributing a snapshot to somebody else. The versioning trigger
-- is `security definer` and so is not filtered by this policy.
drop policy if exists graph_versions_insert_own on public.graph_versions;
create policy graph_versions_insert_own
  on public.graph_versions
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1
      from public.graphs g
      where g.id = graph_id
        and g.owner = (select auth.uid())
    )
  );

-- `with check` re-runs the parent lookup against the NEW row, so graph_id cannot
-- be repointed at a graph the caller does not own.
drop policy if exists graph_versions_update_own on public.graph_versions;
create policy graph_versions_update_own
  on public.graph_versions
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.graphs g
      where g.id = graph_id
        and g.owner = (select auth.uid())
    )
  )
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1
      from public.graphs g
      where g.id = graph_id
        and g.owner = (select auth.uid())
    )
  );

drop policy if exists graph_versions_delete_own on public.graph_versions;
create policy graph_versions_delete_own
  on public.graph_versions
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.graphs g
      where g.id = graph_id
        and g.owner = (select auth.uid())
    )
  );

/* -------------------------------------------------------------------------- */
/* mcp_server_connections                                                      */
/* -------------------------------------------------------------------------- */

drop policy if exists mcp_server_connections_select_own on public.mcp_server_connections;
create policy mcp_server_connections_select_own
  on public.mcp_server_connections
  for select
  to authenticated
  using ((select auth.uid()) = owner);

drop policy if exists mcp_server_connections_insert_own on public.mcp_server_connections;
create policy mcp_server_connections_insert_own
  on public.mcp_server_connections
  for insert
  to authenticated
  with check ((select auth.uid()) = owner);

drop policy if exists mcp_server_connections_update_own on public.mcp_server_connections;
create policy mcp_server_connections_update_own
  on public.mcp_server_connections
  for update
  to authenticated
  using ((select auth.uid()) = owner)
  with check ((select auth.uid()) = owner);

drop policy if exists mcp_server_connections_delete_own on public.mcp_server_connections;
create policy mcp_server_connections_delete_own
  on public.mcp_server_connections
  for delete
  to authenticated
  using ((select auth.uid()) = owner);

/* -------------------------------------------------------------------------- */
/* execution_runs                                                              */
/* -------------------------------------------------------------------------- */

drop policy if exists execution_runs_select_own on public.execution_runs;
create policy execution_runs_select_own
  on public.execution_runs
  for select
  to authenticated
  using ((select auth.uid()) = owner);

-- Owner alone is not enough on insert. A run row also names a graph, and that
-- graph's run history is read by graph_id: without the parent check a user could
-- insert a run they own against someone else's graph and inject rows into that
-- graph's history. The extra conjunct closes it.
drop policy if exists execution_runs_insert_own on public.execution_runs;
create policy execution_runs_insert_own
  on public.execution_runs
  for insert
  to authenticated
  with check (
    (select auth.uid()) = owner
    and exists (
      select 1
      from public.graphs g
      where g.id = graph_id
        and g.owner = (select auth.uid())
    )
  );

drop policy if exists execution_runs_update_own on public.execution_runs;
create policy execution_runs_update_own
  on public.execution_runs
  for update
  to authenticated
  using ((select auth.uid()) = owner)
  with check (
    (select auth.uid()) = owner
    and exists (
      select 1
      from public.graphs g
      where g.id = graph_id
        and g.owner = (select auth.uid())
    )
  );

drop policy if exists execution_runs_delete_own on public.execution_runs;
create policy execution_runs_delete_own
  on public.execution_runs
  for delete
  to authenticated
  using ((select auth.uid()) = owner);
