# Database

The Postgres schema behind toolgraph: four tables, row level security on every
one of them, and an isolation suite that proves the policies actually hold.

Everything here targets a **Supabase** database. The migrations reference
`auth.users` and grant to the `anon` and `authenticated` roles, so they will not
apply to a stock Postgres — that is deliberate, since the whole access model is
built on those roles.

## Layout

| Path                | What it is                                                        |
| ------------------- | ----------------------------------------------------------------- |
| `config.toml`       | Local stack definition. No project ref, no keys — safe to commit. |
| `migrations/`       | Applied in filename order. Never edit an applied migration.       |
| `tests/rls.test.ts` | Cross-tenant isolation suite, run against a live stack.           |
| `tsconfig.json`     | Typechecks the suite, which no workspace package covers.          |

Migrations, in order:

1. `20260101000000_init.sql` — `extensions` schema, pgcrypto, `set_updated_at()`.
2. `20260101000100_tables.sql` — the four tables, their indexes, RLS switched on.
3. `20260101000200_rls.sql` — grants and sixteen policies (four per table).
4. `20260101000300_triggers.sql` — `updated_at` stamping and graph versioning.

RLS is enabled in step 2 rather than step 3 so a table never exists, even for the
width of one migration, without it. Until the policies land, RLS denies
everything — the safe direction to fail.

## Running the stack

Requires Docker (or Podman) and the [Supabase CLI](https://supabase.com/docs/guides/local-development).

```bash
supabase start          # brings up Postgres, GoTrue, PostgREST, Studio
supabase db reset       # drops the database and replays every migration
```

`db reset` is the one that matters: it proves the migrations apply from nothing,
which is what a deploy does. Re-run it after touching any file in `migrations/`.

Useful endpoints once the stack is up:

- API — `http://127.0.0.1:54321`
- Studio — `http://127.0.0.1:54323`
- Postgres — `postgresql://postgres:postgres@127.0.0.1:54322/postgres`

Stop it with `supabase stop`, or `supabase stop --no-backup` to discard the
volume as well.

## Running the isolation tests

```bash
pnpm test:rls
```

The suite creates two real users through the admin API, gives each their own
JWT-scoped client, and checks that neither can see or touch the other's rows. It
reads its connection details from the environment, falling back to the CLI's
fixed local values:

| Variable                                        | Falls back to                    |
| ----------------------------------------------- | -------------------------------- |
| `SUPABASE_URL`, `SUPABASE_API_URL`, `API_URL`   | `http://127.0.0.1:54321`         |
| `SUPABASE_ANON_KEY`, `ANON_KEY`                 | the CLI's local anon key         |
| `SUPABASE_SERVICE_ROLE_KEY`, `SERVICE_ROLE_KEY` | the CLI's local service-role key |

To point it at a stack whose keys differ from the defaults:

```bash
eval "$(supabase status -o env)" && pnpm test:rls
```

Note that `supabase status -o env` emits **shell-quoted** values
(`ANON_KEY="ey..."`). That is correct for `eval`, but writing those lines
straight into a file that is read literally — GitHub Actions' `$GITHUB_ENV`, for
instance — leaves the quotes embedded in the value and every request 401s. The
suite strips one balanced pair defensively, but the export is worth getting
right at the source.

**If no stack is answering, the suite skips itself rather than failing**, so
`pnpm test:rls` is safe to run on a machine without Docker. It still registers
and typechecks, so a skip is visible as 18 skipped tests rather than an empty
run. CI decides whether that is acceptable — the `database-rls` job always has a
stack, so a skip there means something is wrong with the stack, not the tests.

Typecheck the suite on its own (no stack needed):

```bash
pnpm exec tsc -p supabase/tsconfig.json
```

## The access model, in one page

Four tables, all in `public`, all with RLS enabled:

- **`graphs`** — one saved canvas. Owned via `owner uuid → auth.users`.
- **`graph_versions`** — append-only snapshots of `graphs.graph_json`.
  **No owner column**; ownership is derived from the parent graph, because a
  denormalised copy of the owner is a copy that can drift.
- **`mcp_server_connections`** — how to reach one MCP server.
- **`execution_runs`** — one execution of a graph.

Every table gets four separate policies — `select`, `insert`, `update`,
`delete`. No `for all`: a policy covering four operations is a policy nobody can
read, and `using` means something different for each of them.

Three rules hold across all sixteen:

1. **Everything is `to authenticated`.** `anon` gets nothing, and
   `revoke all on table … from anon` means an anonymous request is refused by
   the grant before RLS is ever consulted.
2. **`auth.uid()` is always wrapped as `(select auth.uid())`.** The subselect is
   a stable initplan, so Postgres evaluates it once per statement instead of
   once per row — the difference between an index scan and a sequential scan.
3. **Every `update` policy carries both `using` and `with check`.** This is the
   one worth understanding. `using` decides which rows you may target;
   `with check` decides what the row is allowed to look like afterwards. With
   `using` alone a user can update their own row and set `owner` to somebody
   else's id: the row passes the visibility test on the way in, and there is no
   test on the way out. That is a silent ownership-transfer hole, and closing it
   is what the `with check` clause is for. `rejects an ownership transfer of a
row you do own` in the test suite is its regression test.

`graph_versions` has no owner column, so all four of its policies scope through
the parent instead:

```sql
exists (
  select 1 from public.graphs g
  where g.id = graph_id and g.owner = (select auth.uid())
)
```

## Credentials are not stored here

`mcp_server_connections` has **no credential column**, by design. Per-server auth
material — bearer tokens, API keys, stdio env vars — is supplied by the client at
connect time, passed straight through to the transport, and never persisted.

If persistence ever becomes genuinely necessary, [Supabase Vault](https://supabase.com/docs/guides/database/vault)
is the only sanctioned path: store the ciphertext id, never the secret.

```sql
-- select vault.create_secret('<token>', 'mcp:' || id::text, 'MCP bearer token');
-- alter table public.mcp_server_connections
--   add column secret_id uuid references vault.secrets (id);
```

Reading back goes through `vault.decrypted_secrets`, which is exposed to neither
`anon` nor `authenticated`. The table comment in
`20260101000100_tables.sql` says the same thing, and
`keeps no credential column on mcp_server_connections` in the test suite fails
the build if a credential-shaped column ever appears.

## Triggers

- **`set_updated_at()`** on `graphs` and `mcp_server_connections`. Clients cannot
  set `updated_at` themselves; the trigger always overwrites it.
- **`record_graph_version()`** on `graphs`. On update, when `graph_json` actually
  changed, it appends the **previous** document to `graph_versions` at
  `coalesce(max(version), 0) + 1` for that graph. A title-only edit creates no
  version.

Both are `security definer` with `set search_path = ''`. That pairing is the
point: an empty search path means an unprivileged caller cannot shadow an
unqualified name with an object in a schema they control, which is the classic
route from a definer-rights function to privilege escalation. Every
non-`pg_catalog` reference in both functions is therefore schema-qualified, and
both have `execute` revoked from `public` so they cannot be called directly over
PostgREST.

## Changing the schema

```bash
supabase migration new <name>     # creates a timestamped file
# edit it, then:
supabase db reset                 # replay everything from scratch
pnpm test:rls                     # prove the policies still hold
```

Two rules:

- **Never edit a migration that has been applied anywhere.** Add a new one.
- **A new table is not finished until it has RLS, four policies, a `revoke` from
  `anon`, and a test.** A table added without them is readable by every user of
  the application, and nothing in the build will tell you.
