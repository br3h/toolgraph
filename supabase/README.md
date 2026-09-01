# Database

Postgres schema, Row Level Security policies and the isolation tests that prove
them.

## Layout

```
supabase/
├── config.toml                          local dev stack configuration
├── migrations/
│   ├── 20260101000000_init.sql          extensions + the set_updated_at helper
│   ├── 20260101000100_tables.sql        the four tables
│   ├── 20260101000200_rls.sql           RLS policies, four per table
│   └── 20260101000300_triggers.sql      updated_at, and graph version history
└── tests/
    └── rls.test.ts                      cross-user isolation tests
```

## Running the local stack

Needs Docker. Anything that provides a Docker daemon works — Docker Desktop,
[colima](https://github.com/abiosoft/colima), OrbStack.

```bash
supabase start            # Postgres, Auth, PostgREST, Studio
supabase db reset         # drops and reapplies every migration from scratch
pnpm test:rls             # the isolation tests
supabase stop             # when you are done
```

`supabase start` prints the local API URL and its keys. Those keys are fixed
local development values — identical on every machine, granting access to
nothing but your own ephemeral container. They are read at runtime by the tests
rather than committed, so no JWT-shaped string lives in this repo.

If Docker is unavailable the RLS suite skips itself rather than failing, and
says so. CI always has Docker, so the tests genuinely run there — a local skip
never becomes a silent pass.

## Applying to a hosted project

```bash
supabase login                                  # opens a browser
supabase link --project-ref <your-project-ref>  # from the project URL
supabase db push                                # applies pending migrations
```

The project ref is the subdomain of your `NEXT_PUBLIC_SUPABASE_URL`.

## The tables

| Table                    | What it holds                                                         |
| ------------------------ | --------------------------------------------------------------------- |
| `graphs`                 | One saved canvas: title plus the `ToolGraphDocument` as `jsonb`       |
| `graph_versions`         | Append-only history, written by a trigger when `graph_json` changes   |
| `mcp_server_connections` | A user's saved server endpoints. **No credential column, by design.** |
| `execution_runs`         | One row per test-run attempt, written by the engine                   |

### Why `mcp_server_connections` has no secret column

Per-server auth material is supplied by the client at connect time, passed
straight through to the transport, and never written down. The table carries a
SQL comment saying so, along with a commented-out example of the only sanctioned
alternative — Supabase Vault, storing a `secret_id` referencing
`vault.secrets` and reading back through `vault.decrypted_secrets`, which is not
exposed over PostgREST. A plaintext column is never an option.

## Row Level Security

Every table has RLS enabled and **four explicit policies** — one each for
`select`, `insert`, `update` and `delete`. Nothing is left to a default.

Three details are load-bearing:

**`auth.uid()` is wrapped in a subselect.** `(select auth.uid()) = owner` lets
Postgres evaluate the call once per statement instead of once per row. On a list
of a hundred graphs that is the difference between one call and a hundred.

**Every `update` policy has both `using` and `with check`.** `using` decides
which rows you may update; `with check` decides what they may become. With only
`using`, a user can update their own row and set `owner` to someone else's id —
handing them the record, or taking it. `rls.test.ts` asserts that specific
attempt fails.

**`graph_versions` scopes through its parent.** It has no `owner` column, so its
policies test ownership of the graph the version belongs to:

```sql
exists (
  select 1 from public.graphs g
  where g.id = graph_id and g.owner = (select auth.uid())
)
```

**`anon` is revoked outright** on all four tables, so RLS is not the only thing
standing between an unauthenticated request and the data.

Trigger functions are `security definer` with `set search_path = ''`. The empty
search path is the important half: without it, an unprivileged caller can create
a schema that shadows an unqualified name inside a definer-rights function and
turn it into privilege escalation. `execute` is revoked from `public` on those
functions so they cannot be invoked directly over PostgREST.

## What the isolation tests check

`supabase/tests/rls.test.ts` creates two real users and asserts, as user B, that
user A's rows are invisible and unmodifiable:

- `select` on each of A's rows returns zero rows
- `update` and `delete` of A's rows affect nothing
- inserting a row with `owner` set to A's id is rejected
- A cannot reassign `owner` on their own graph to B
- an anonymous client reads nothing from any table
- `graph_versions` is invisible to B despite having no `owner` column

Each negative assertion distinguishes "correctly denied" from "failed for some
unrelated reason", so a broken query can never look like working security.

## Adding a table

1. Write the `create table` in a new timestamped migration.
2. `alter table ... enable row level security;` in the same file.
3. Add all four policies. Give `update` both `using` and `with check`.
4. `revoke all on table ... from anon;`
5. Add a case to `rls.test.ts`.

A table without policies is readable by every authenticated user, which is
almost never what you want and is never obvious from the outside.
