-- The engine writes execution_runs with the service key, and that was failing
-- with "permission denied for table execution_runs".
--
-- Row Level Security governs which ROWS a role may touch; table GRANTs govern
-- whether the role may touch the table at all. The initial migration granted
-- the four tables to `authenticated` and revoked them from `anon`, but never
-- granted them to `service_role`, so PostgREST refused every service-key
-- request before RLS was ever consulted.
--
-- Granting here does not widen the product's attack surface. `service_role`
-- already bypasses RLS by design and its key is held only by server-side code
-- (the engine and the web app's admin client); it is never sent to a browser.
-- What it does fix is the engine being unable to record a run at all.

grant select, insert, update, delete on table public.graphs to service_role;
grant select, insert, update, delete on table public.graph_versions to service_role;
grant select, insert, update, delete on table public.mcp_server_connections to service_role;
grant select, insert, update, delete on table public.execution_runs to service_role;

-- `anon` stays revoked: an unauthenticated request must still be stopped by the
-- grant layer, before RLS is reached.
revoke all on table public.graphs from anon;
revoke all on table public.graph_versions from anon;
revoke all on table public.mcp_server_connections from anon;
revoke all on table public.execution_runs from anon;
