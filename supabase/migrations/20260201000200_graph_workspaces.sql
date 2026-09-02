-- toolgraph: graphs and runs can belong to a workspace.
--
-- Same additive shape as the connections migration: one nullable column, and
-- one extra disjunct on each policy. Every existing row keeps workspace_id NULL
-- and is governed by exactly the expression it was before.

alter table public.graphs
  add column if not exists workspace_id uuid references public.workspaces (id) on delete cascade;

comment on column public.graphs.workspace_id is
  'When set, every member of the workspace can open and edit this graph. NULL means private to `owner`, which is what every pre-existing row is.';

create index if not exists graphs_workspace_updated_at_idx
  on public.graphs (workspace_id, updated_at desc)
  where workspace_id is not null;

/* -------------------------------------------------------------------------- */
/* graphs — RLS                                                                */
/* -------------------------------------------------------------------------- */

drop policy if exists graphs_select_own on public.graphs;
create policy graphs_select_own
  on public.graphs
  for select
  to authenticated
  using (
    (select auth.uid()) = owner
    or (workspace_id is not null and public.is_workspace_member(workspace_id))
  );

drop policy if exists graphs_insert_own on public.graphs;
create policy graphs_insert_own
  on public.graphs
  for insert
  to authenticated
  with check (
    (select auth.uid()) = owner
    and (workspace_id is null or public.is_workspace_member(workspace_id))
  );

-- The `with check` conjunct is the containment guard: a member editing a shared
-- graph cannot move it into a workspace they do not belong to, and cannot pull
-- a shared graph out into their own account by nulling workspace_id — the first
-- disjunct of the outer clause still requires them to be the owner for that.
drop policy if exists graphs_update_own on public.graphs;
create policy graphs_update_own
  on public.graphs
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

-- Deleting a shared graph destroys other people's work, so inside a workspace
-- it takes admin. A member can edit it but not remove it.
drop policy if exists graphs_delete_own on public.graphs;
create policy graphs_delete_own
  on public.graphs
  for delete
  to authenticated
  using (
    ((select auth.uid()) = owner and workspace_id is null)
    or ((select auth.uid()) = owner and workspace_id is not null)
    or (workspace_id is not null and public.can_administer_workspace(workspace_id))
  );

/* -------------------------------------------------------------------------- */
/* graph_versions — RLS follows the parent                                     */
/* -------------------------------------------------------------------------- */

-- These policies derive visibility from public.graphs, and that lookup is a
-- plain subquery not filtered by the graphs policies, so widening `graphs`
-- above does not widen these. They are restated with the same disjunct so a
-- shared graph's history is visible to the people who can see the graph.

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
        and (
          g.owner = (select auth.uid())
          or (g.workspace_id is not null and public.is_workspace_member(g.workspace_id))
        )
    )
  );

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
        and (
          g.owner = (select auth.uid())
          or (g.workspace_id is not null and public.is_workspace_member(g.workspace_id))
        )
    )
  );

drop policy if exists graph_versions_update_own on public.graph_versions;
create policy graph_versions_update_own
  on public.graph_versions
  for update
  to authenticated
  using (
    exists (
      select 1 from public.graphs g
      where g.id = graph_id
        and (
          g.owner = (select auth.uid())
          or (g.workspace_id is not null and public.is_workspace_member(g.workspace_id))
        )
    )
  )
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.graphs g
      where g.id = graph_id
        and (
          g.owner = (select auth.uid())
          or (g.workspace_id is not null and public.is_workspace_member(g.workspace_id))
        )
    )
  );

drop policy if exists graph_versions_delete_own on public.graph_versions;
create policy graph_versions_delete_own
  on public.graph_versions
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.graphs g
      where g.id = graph_id
        and (
          g.owner = (select auth.uid())
          or (g.workspace_id is not null and public.can_administer_workspace(g.workspace_id))
        )
    )
  );

/* -------------------------------------------------------------------------- */
/* execution_runs — RLS                                                        */
/* -------------------------------------------------------------------------- */

-- A run belongs to the person who started it, and that does not change. What
-- changes is that a run against a SHARED graph is visible to the workspace, so
-- "why did last night's run fail" is answerable by whoever is on call rather
-- than only by whoever pressed the button.
--
-- Insert and update stay exactly as they were — `owner` must be the caller —
-- with the parent-graph check widened so a member can run a shared graph at all.

drop policy if exists execution_runs_select_own on public.execution_runs;
create policy execution_runs_select_own
  on public.execution_runs
  for select
  to authenticated
  using (
    (select auth.uid()) = owner
    or exists (
      select 1 from public.graphs g
      where g.id = graph_id
        and g.workspace_id is not null
        and public.is_workspace_member(g.workspace_id)
    )
  );

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
        and (
          g.owner = (select auth.uid())
          or (g.workspace_id is not null and public.is_workspace_member(g.workspace_id))
        )
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
        and (
          g.owner = (select auth.uid())
          or (g.workspace_id is not null and public.is_workspace_member(g.workspace_id))
        )
    )
  );

-- Unchanged: you may delete your own run rows and nobody else's, whatever
-- workspace the graph is in. A run is a record of what *you* did.
