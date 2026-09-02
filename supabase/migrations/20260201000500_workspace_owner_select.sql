-- toolgraph: let a workspace's owner see it without depending on trigger order.
--
-- THE BUG THIS FIXES. `workspaces_select_member` was written as
--
--   using (public.is_workspace_member(id))
--
-- and the owner's membership row is written by the `workspaces_add_owner_member`
-- AFTER INSERT trigger. That is fine for every later read — the trigger has long
-- since run — but it is not fine for the insert itself.
--
-- PostgREST issues `INSERT ... RETURNING` whenever the client asks for the new
-- row (`.insert(...).select('id')`), and RETURNING output is projected as part
-- of the same statement, BEFORE AFTER-row triggers fire. So at the moment the
-- returned row is checked against the SELECT policy, the membership row does
-- not exist yet, `is_workspace_member()` is false, and Postgres refuses the
-- whole statement with:
--
--   new row violates row-level security policy for table "workspaces"
--
-- The effect was that creating a workspace failed outright. It was invisible to
-- a plain `INSERT` in a psql session — which is exactly how it got missed — and
-- was caught by the CI suite, which goes through PostgREST like the app does.
--
-- THE FIX. Let the owner see their own workspace directly, as a disjunct that
-- does not depend on anything having run yet. This widens nothing in practice:
-- the trigger makes the owner a member microseconds later, so the second
-- disjunct was already true for them on every subsequent read. What it removes
-- is the ordering dependency.
--
-- The same reasoning does NOT apply to workspace_members, invitations, graphs or
-- connections: none of those has a policy that depends on a row written by a
-- trigger on the same statement.

drop policy if exists workspaces_select_member on public.workspaces;
create policy workspaces_select_member
  on public.workspaces
  for select
  to authenticated
  using (
    -- True from the instant the row exists, including inside the RETURNING of
    -- the INSERT that created it.
    owner = (select auth.uid())
    or public.is_workspace_member(id)
  );

-- The update policy has the same shape of dependency in principle, but not in
-- practice: an UPDATE ... RETURNING only ever targets a row that already exists,
-- so its membership row exists too. It is left as `can_administer_workspace()`
-- alone, which correctly means an admin who is not the owner may still rename.
