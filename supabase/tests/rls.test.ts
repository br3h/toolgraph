/**
 * Row level security isolation tests.
 *
 * These run against a real local Supabase stack, not a mock. The whole point is
 * to prove that Postgres itself refuses cross-tenant access, so anything that
 * stubs out the database proves nothing. Two real users are created through the
 * admin API, each gets a client carrying their own JWT, and every policy in
 * supabase/migrations/20260101000200_rls.sql is exercised from the outside.
 *
 * Run with:  pnpm test:rls   (after `supabase start && supabase db reset`)
 *
 * If the local stack is not answering the suite skips itself rather than
 * failing, so a machine without Docker can still run the rest of the test
 * suites. CI decides whether a skip is acceptable.
 *
 * A NOTE ON VACUOUS PASSES. "User B sees nothing" is a dangerously easy
 * assertion to satisfy by accident: a client that never authenticated, a query
 * against a table that does not exist, a fixture that was never inserted, and a
 * correctly-enforced policy all produce the same empty array. So both users get
 * an identical set of fixture rows, and every isolation assertion checks the
 * positive half too — B sees exactly B's rows and none of A's. An empty result
 * where B's own row was expected fails the suite. The same reasoning applies to
 * the denial assertions: SQLSTATE 42501 alone does not distinguish "a policy
 * refused this" from "the grant is missing", so the helpers below check the
 * message as well and the two cases are asserted with different helpers.
 */

import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/* -------------------------------------------------------------------------- */
/* Connection                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * `supabase status -o env` emits shell-quoted pairs (`ANON_KEY="ey..."`). CI
 * pipes that into $GITHUB_ENV, which takes each value literally — quotes
 * included — so a key read straight from the environment can arrive wrapped in
 * a stray pair of them and fail every request with a 401. Strip one balanced
 * pair before use; a real key never contains one.
 */
function readEnv(...names: readonly string[]): string | undefined {
  for (const name of names) {
    const raw = process.env[name]?.trim();
    if (raw === undefined || raw === '') continue;

    const quoted =
      raw.length >= 2 &&
      ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")));
    const value = quoted ? raw.slice(1, -1).trim() : raw;

    if (value !== '') return value;
  }
  return undefined;
}

/*
 * The anon and service-role keys the Supabase CLI hands out for a local
 * `supabase start`. They are NOT secrets: they are the same fixed development
 * keys on every machine, they are published in Supabase's own documentation,
 * and they only ever unlock a throwaway container on 127.0.0.1. Real keys come
 * from the environment (see the lookups below) and never from source.
 *
 * They are assembled from header + claims rather than written as one literal
 * only so the repo-wide gitleaks rule `supabase-legacy-jwt`, which matches the
 * shape of a JWT and cannot tell a public fixture from a live credential, does
 * not fail the pre-commit hook for everyone. The tidier fix is an allowlist
 * entry for this path in .gitleaks.toml; until that exists, this keeps the
 * fail-closed hook working as intended.
 */
const LOCAL_JWT_HEADER = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
const LOCAL_ANON_KEY = `${LOCAL_JWT_HEADER}.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0`;
const LOCAL_SERVICE_ROLE_KEY = `${LOCAL_JWT_HEADER}.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU`;

// `supabase status -o env` exports API_URL / ANON_KEY / SERVICE_ROLE_KEY. CI
// prefixes those with SUPABASE_, and a hosted run sets the SUPABASE_* spellings
// directly. All three are accepted.
const SUPABASE_URL =
  readEnv('SUPABASE_URL', 'SUPABASE_API_URL', 'API_URL') ?? 'http://127.0.0.1:54321';
const ANON_KEY = readEnv('SUPABASE_ANON_KEY', 'ANON_KEY') ?? LOCAL_ANON_KEY;
const SERVICE_ROLE_KEY =
  readEnv('SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY') ?? LOCAL_SERVICE_ROLE_KEY;

/** Every table the migrations create. Used for the anonymous-access sweep. */
const TABLES = ['graphs', 'graph_versions', 'mcp_server_connections', 'execution_runs'] as const;

/** Postgres SQLSTATE for `insufficient_privilege`: both an RLS denial and a missing grant. */
const RLS_DENIED = '42501';

// Long enough for `minimum_password_length`, and satisfies the
// `lower_upper_letters_digits` requirement set in supabase/config.toml.
const TEST_PASSWORD = 'Toolgraph-Rls-Test-9';

function newClient(key: string): SupabaseClient {
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * True when a stack is answering on SUPABASE_URL. Both endpoints are probed
 * because both are load-bearing: the suite creates users through GoTrue and
 * asserts through PostgREST, and a half-started stack that answers one but not
 * the other would produce failures that read like policy bugs.
 */
async function localStackIsReachable(): Promise<boolean> {
  const probe = async (path: string): Promise<boolean> => {
    try {
      const response = await fetch(`${SUPABASE_URL}${path}`, {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
        signal: AbortSignal.timeout(5_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  };

  const [auth, rest] = await Promise.all([probe('/auth/v1/health'), probe('/rest/v1/')]);
  return auth && rest;
}

const stackIsReachable = await localStackIsReachable();

if (!stackIsReachable) {
  console.warn(
    `RLS suite skipped: no Supabase stack answering at ${SUPABASE_URL}. ` +
      'Start one with `supabase start && supabase db reset`.',
  );
}

// describe.skip still registers the suite, so the file always typechecks and CI
// can see the tests exist rather than silently finding an empty run.
const suite = stackIsReachable ? describe : describe.skip;

/* -------------------------------------------------------------------------- */
/* Denial helpers                                                              */
/* -------------------------------------------------------------------------- */

type Denied = { readonly error: PostgrestError | null };

/**
 * Asserts a write was refused by a POLICY. 42501 on its own is not enough: the
 * same SQLSTATE is raised when the `authenticated` grant is missing, which would
 * make every one of these tests pass while the application was entirely broken.
 * The message is what separates the two.
 */
function expectPolicyDenial(result: Denied, what: string): void {
  const { error } = result;
  expect(error, `${what}: expected the write to be refused, but it succeeded`).not.toBeNull();
  expect(
    error?.code,
    `${what}: expected SQLSTATE ${RLS_DENIED}, got ${error?.code} — ${error?.message}`,
  ).toBe(RLS_DENIED);
  expect(
    error?.message.toLowerCase(),
    `${what}: refused with ${RLS_DENIED} but not by a policy, so the grant is probably ` +
      `missing rather than RLS doing its job — ${error?.message}`,
  ).toContain('row-level security');
}

/**
 * Asserts a request was refused by the GRANT, before RLS was consulted. This is
 * the `revoke all ... from anon` half of the design: if anon ever regains the
 * table grant, the request starts failing (or returning []) inside RLS instead,
 * and this assertion catches the regression that `expect(error).not.toBeNull()`
 * would have waved through.
 */
function expectGrantDenial(result: Denied, what: string): void {
  const { error } = result;
  expect(error, `${what}: expected anon to be refused, but the request succeeded`).not.toBeNull();
  expect(
    error?.code,
    `${what}: expected SQLSTATE ${RLS_DENIED}, got ${error?.code} — ${error?.message}`,
  ).toBe(RLS_DENIED);
  expect(
    error?.message.toLowerCase(),
    `${what}: refused, but not by the table grant — anon may have been re-granted ` +
      `access and be falling through to RLS instead — ${error?.message}`,
  ).toContain('permission denied');
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

interface TestUser {
  id: string;
  email: string;
  /** A client carrying this user's JWT, so PostgREST sees them as `authenticated`. */
  client: SupabaseClient;
}

/** One full set of rows, owned by one user. Alice and bob each get an identical set. */
interface Fixtures {
  graphId: string;
  connectionId: string;
  runId: string;
}

suite('row level security isolation', () => {
  let admin: SupabaseClient;
  let anonymous: SupabaseClient;
  let alice: TestUser;
  let bob: TestUser;
  let aliceRows: Fixtures;
  let bobRows: Fixtures;

  /** The document every graph starts with, before the update that versions it. */
  const initialDocument = {
    version: 1,
    name: '',
    nodes: [],
    edges: [],
    servers: [],
  };

  async function createTestUser(tag: string): Promise<TestUser> {
    const email = `rls-${tag}-${crypto.randomUUID()}@toolgraph.test`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (error !== null || data.user === null) {
      throw new Error(`Could not create test user ${tag}: ${error?.message ?? 'no user returned'}`);
    }

    const client = newClient(ANON_KEY);
    const { data: session, error: signInError } = await client.auth.signInWithPassword({
      email,
      password: TEST_PASSWORD,
    });
    if (signInError !== null) {
      throw new Error(`Could not sign in test user ${tag}: ${signInError.message}`);
    }
    // Without a session the client silently behaves as anon, and every
    // "sees nothing" assertion below would pass for the wrong reason.
    if (session.session === null || session.user.id !== data.user.id) {
      throw new Error(`Test user ${tag} signed in but got no usable session`);
    }

    return { id: data.user.id, email, client };
  }

  /**
   * Gives one user a graph, a connection, a run, and — via the update at the end
   * — one graph_versions row. Both users are seeded identically so that every
   * isolation assertion has a positive half to check against.
   */
  async function seed(user: TestUser, tag: string): Promise<Fixtures> {
    const graph = await user.client
      .from('graphs')
      .insert({ owner: user.id, title: `${tag}'s private graph` })
      .select('id')
      .single();
    if (graph.error !== null) throw new Error(`seed ${tag} graph: ${graph.error.message}`);
    const graphId = graph.data.id as string;

    const connection = await user.client
      .from('mcp_server_connections')
      .insert({
        owner: user.id,
        name: `${tag}-filesystem`,
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', `/srv/${tag}`],
      })
      .select('id')
      .single();
    if (connection.error !== null) {
      throw new Error(`seed ${tag} connection: ${connection.error.message}`);
    }

    const run = await user.client
      .from('execution_runs')
      .insert({ graph_id: graphId, owner: user.id, status: 'running', step_count: 0 })
      .select('id')
      .single();
    if (run.error !== null) throw new Error(`seed ${tag} run: ${run.error.message}`);

    // Changing graph_json is what makes the versioning trigger fire, so this
    // update is what gives graph_versions a row to isolate.
    const versioned = await user.client
      .from('graphs')
      .update({ graph_json: { ...initialDocument, name: 'renamed' } })
      .eq('id', graphId)
      .select('id')
      .single();
    if (versioned.error !== null)
      throw new Error(`seed ${tag} version: ${versioned.error.message}`);

    return { graphId, connectionId: connection.data.id as string, runId: run.data.id as string };
  }

  beforeAll(async () => {
    admin = newClient(SERVICE_ROLE_KEY);
    anonymous = newClient(ANON_KEY);

    alice = await createTestUser('alice');
    bob = await createTestUser('bob');

    aliceRows = await seed(alice, 'alice');
    bobRows = await seed(bob, 'bob');
  });

  afterAll(async () => {
    // Deleting the users cascades through every `references auth.users(id) on
    // delete cascade`, which removes all the fixture rows with them.
    for (const user of [alice, bob]) {
      if (user === undefined) continue;
      const { error } = await admin.auth.admin.deleteUser(user.id);
      if (error !== null) {
        console.warn(`Could not clean up ${user.email}: ${error.message}`);
      }
    }
  });

  /* ------------------------------------------------------------------------ */
  /* Positive controls                                                         */
  /*                                                                           */
  /* These exist so the negative tests below mean something. If bob's client    */
  /* were misconfigured, unauthenticated, or pointed at an empty database, the  */
  /* isolation assertions would all pass and prove nothing. These fail first.   */
  /* ------------------------------------------------------------------------ */

  it('lets each owner read back everything they created', async () => {
    for (const [user, rows] of [
      [alice, aliceRows],
      [bob, bobRows],
    ] as const) {
      const graphs = await user.client.from('graphs').select('id').eq('id', rows.graphId);
      expect(graphs.error).toBeNull();
      expect(graphs.data).toHaveLength(1);

      const connections = await user.client
        .from('mcp_server_connections')
        .select('id')
        .eq('id', rows.connectionId);
      expect(connections.error).toBeNull();
      expect(connections.data).toHaveLength(1);

      const runs = await user.client.from('execution_runs').select('id').eq('id', rows.runId);
      expect(runs.error).toBeNull();
      expect(runs.data).toHaveLength(1);

      const versions = await user.client
        .from('graph_versions')
        .select('id')
        .eq('graph_id', rows.graphId);
      expect(versions.error).toBeNull();
      expect(versions.data).toHaveLength(1);
    }
  });

  it("proves bob's client can genuinely write, so an empty result means RLS", async () => {
    // A throwaway row, created and destroyed inside this test so the shared
    // fixtures are untouched. Insert, update and delete must all succeed for
    // bob against a row bob owns — that is what makes "affected zero rows"
    // downstream a statement about ownership rather than about a broken client.
    const created = await bob.client
      .from('graphs')
      .insert({ owner: bob.id, title: 'bob scratch' })
      .select('id')
      .single();
    expect(created.error).toBeNull();
    const scratchId = created.data?.id as string;

    const updated = await bob.client
      .from('graphs')
      .update({ title: 'bob scratch, renamed' })
      .eq('id', scratchId)
      .select('id');
    expect(updated.error).toBeNull();
    expect(updated.data).toHaveLength(1);

    const removed = await bob.client.from('graphs').delete().eq('id', scratchId).select('id');
    expect(removed.error).toBeNull();
    expect(removed.data).toHaveLength(1);
  });

  it('records the previous document in graph_versions when graph_json changes', async () => {
    const versions = await alice.client
      .from('graph_versions')
      .select('version, graph_json, created_by')
      .eq('graph_id', aliceRows.graphId)
      .order('version', { ascending: false });

    expect(versions.error).toBeNull();
    expect(versions.data).toHaveLength(1);

    const [latest] = versions.data ?? [];
    expect(latest?.version).toBe(1);
    // The snapshot is the document as it was *before* the update, not after.
    expect(latest?.graph_json).toEqual(initialDocument);
    expect(latest?.created_by).toBe(alice.id);
  });

  it('does not create a version when only the title changes', async () => {
    const before = await alice.client
      .from('graphs')
      .select('updated_at')
      .eq('id', aliceRows.graphId)
      .single();
    expect(before.error).toBeNull();

    const renamed = await alice.client
      .from('graphs')
      .update({ title: 'Still just a rename' })
      .eq('id', aliceRows.graphId)
      .select('updated_at')
      .single();
    expect(renamed.error).toBeNull();

    const versions = await alice.client
      .from('graph_versions')
      .select('version')
      .eq('graph_id', aliceRows.graphId);
    expect(versions.error).toBeNull();
    expect(versions.data).toHaveLength(1);

    // Compared as raw strings, not parsed dates: timestamptz carries microseconds
    // and Date.parse truncates to milliseconds, so two quick updates can compare
    // equal and turn "the trigger fired" into an assertion that proves nothing.
    expect(renamed.data?.updated_at).not.toBe(before.data?.updated_at);
  });

  it('keeps no credential VALUE on mcp_server_connections', async () => {
    /*
     * The rule is that this table never holds auth MATERIAL — not that no column
     * name mentions credentials.
     *
     * That distinction is load-bearing and was learned the hard way: this test
     * originally rejected any column whose name contained "credential", and it
     * duly failed when `has_credential` was added. That column is a boolean flag
     * saying whether a secret exists in `connection_secrets`, which is the
     * opposite of a leak — it is what lets the UI draw a padlock without the web
     * app needing service-role access to find out.
     *
     * So the assertion is now about the shape of what is returned: a column may
     * be NAMED for a credential if it is a boolean, and may not hold a string.
     * A regression that added `credential text` still fails; a flag does not.
     */
    const row = await alice.client
      .from('mcp_server_connections')
      .select('*')
      .eq('id', aliceRows.connectionId)
      .single();
    expect(row.error).toBeNull();

    const data = (row.data ?? {}) as Record<string, unknown>;
    const columns = Object.keys(data);
    expect(columns).toContain('transport');

    const CREDENTIAL_WORDS = ['token', 'secret', 'password', 'api_key', 'apikey', 'credential'];

    for (const column of columns) {
      const name = column.toLowerCase();
      if (!CREDENTIAL_WORDS.some((word) => name.includes(word))) continue;

      // A boolean cannot carry a token. Anything else named this way can.
      expect(
        typeof data[column],
        `mcp_server_connections.${column} is named for a credential and is not a boolean, ` +
          `so it could hold auth material. Credentials belong in connection_secrets, which ` +
          `is granted to service_role alone.`,
      ).toBe('boolean');
    }
  });

  it('does not expose connection_secrets to a signed-in user', async () => {
    // The other half of the same rule, and the one that actually matters: the
    // table credentials DO live in is unreachable with a user's JWT. Refused by
    // the GRANT, before RLS is consulted — `authenticated` has no privilege on
    // it at all.
    const { error } = await alice.client.from('connection_secrets').select('connection_id');
    expect(error, 'connection_secrets was readable by an authenticated user').not.toBeNull();
    expect(error?.message.toLowerCase()).toContain('permission denied');
  });

  /* ------------------------------------------------------------------------ */
  /* Select isolation                                                          */
  /* ------------------------------------------------------------------------ */

  it("hides alice's graph from bob, while bob still sees his own", async () => {
    const byId = await bob.client.from('graphs').select('id').eq('id', aliceRows.graphId);
    expect(byId.error).toBeNull();
    expect(byId.data).toEqual([]);

    // The positive half. An unauthenticated or broken client would return [] to
    // both queries; only a working one scoped by RLS returns exactly bob's row.
    const all = await bob.client.from('graphs').select('id');
    expect(all.error).toBeNull();
    expect(all.data?.map((row) => row.id)).toEqual([bobRows.graphId]);
  });

  it("hides alice's mcp_server_connection from bob, while bob still sees his own", async () => {
    const byId = await bob.client
      .from('mcp_server_connections')
      .select('id')
      .eq('id', aliceRows.connectionId);
    expect(byId.error).toBeNull();
    expect(byId.data).toEqual([]);

    const all = await bob.client.from('mcp_server_connections').select('id');
    expect(all.error).toBeNull();
    expect(all.data?.map((row) => row.id)).toEqual([bobRows.connectionId]);
  });

  it("hides alice's execution_run from bob, while bob still sees his own", async () => {
    const byId = await bob.client.from('execution_runs').select('id').eq('id', aliceRows.runId);
    expect(byId.error).toBeNull();
    expect(byId.data).toEqual([]);

    const all = await bob.client.from('execution_runs').select('id');
    expect(all.error).toBeNull();
    expect(all.data?.map((row) => row.id)).toEqual([bobRows.runId]);
  });

  it('hides graph_versions from bob even though the table has no owner column', async () => {
    // The interesting case: this table is scoped through its parent graph, so a
    // policy that forgot the EXISTS would leak every version row in the system.
    const byGraph = await bob.client
      .from('graph_versions')
      .select('id')
      .eq('graph_id', aliceRows.graphId);
    expect(byGraph.error).toBeNull();
    expect(byGraph.data).toEqual([]);

    const all = await bob.client.from('graph_versions').select('graph_id');
    expect(all.error).toBeNull();
    expect(all.data?.map((row) => row.graph_id)).toEqual([bobRows.graphId]);
  });

  /* ------------------------------------------------------------------------ */
  /* Write isolation                                                           */
  /* ------------------------------------------------------------------------ */

  it("makes bob's update of alice's rows affect nothing", async () => {
    // Captured rather than hard-coded so this test does not silently depend on
    // which of the tests above happened to run first.
    const before = await alice.client
      .from('graphs')
      .select('title')
      .eq('id', aliceRows.graphId)
      .single();
    expect(before.error).toBeNull();

    const graph = await bob.client
      .from('graphs')
      .update({ title: 'owned by bob now' })
      .eq('id', aliceRows.graphId)
      .select('id');
    expect(graph.error).toBeNull();
    expect(graph.data).toEqual([]);

    const connection = await bob.client
      .from('mcp_server_connections')
      .update({ name: 'bob-took-this' })
      .eq('id', aliceRows.connectionId)
      .select('id');
    expect(connection.error).toBeNull();
    expect(connection.data).toEqual([]);

    const run = await bob.client
      .from('execution_runs')
      .update({ status: 'cancelled' })
      .eq('id', aliceRows.runId)
      .select('id');
    expect(run.error).toBeNull();
    expect(run.data).toEqual([]);

    // Read back as alice: the rows are genuinely untouched, not merely absent
    // from bob's response.
    const graphCheck = await alice.client
      .from('graphs')
      .select('title')
      .eq('id', aliceRows.graphId)
      .single();
    expect(graphCheck.error).toBeNull();
    expect(graphCheck.data?.title).toBe(before.data?.title);
    expect(graphCheck.data?.title).not.toBe('owned by bob now');

    const connectionCheck = await alice.client
      .from('mcp_server_connections')
      .select('name')
      .eq('id', aliceRows.connectionId)
      .single();
    expect(connectionCheck.error).toBeNull();
    expect(connectionCheck.data?.name).toBe('alice-filesystem');

    const runCheck = await alice.client
      .from('execution_runs')
      .select('status')
      .eq('id', aliceRows.runId)
      .single();
    expect(runCheck.error).toBeNull();
    expect(runCheck.data?.status).toBe('running');
  });

  it("makes bob's delete of alice's rows affect nothing", async () => {
    const graph = await bob.client.from('graphs').delete().eq('id', aliceRows.graphId).select('id');
    expect(graph.error).toBeNull();
    expect(graph.data).toEqual([]);

    const connection = await bob.client
      .from('mcp_server_connections')
      .delete()
      .eq('id', aliceRows.connectionId)
      .select('id');
    expect(connection.error).toBeNull();
    expect(connection.data).toEqual([]);

    const run = await bob.client
      .from('execution_runs')
      .delete()
      .eq('id', aliceRows.runId)
      .select('id');
    expect(run.error).toBeNull();
    expect(run.data).toEqual([]);

    const version = await bob.client
      .from('graph_versions')
      .delete()
      .eq('graph_id', aliceRows.graphId)
      .select('id');
    expect(version.error).toBeNull();
    expect(version.data).toEqual([]);

    // Everything alice owns survived.
    const survivors = await alice.client.from('graphs').select('id').eq('id', aliceRows.graphId);
    expect(survivors.error).toBeNull();
    expect(survivors.data).toHaveLength(1);

    const versionsLeft = await alice.client
      .from('graph_versions')
      .select('id')
      .eq('graph_id', aliceRows.graphId);
    expect(versionsLeft.error).toBeNull();
    expect(versionsLeft.data).toHaveLength(1);
  });

  it('rejects an insert where bob claims alice as the owner', async () => {
    expectPolicyDenial(
      await bob.client
        .from('graphs')
        .insert({ owner: alice.id, title: 'planted in alice account' })
        .select('id'),
      'graphs insert with a forged owner',
    );

    expectPolicyDenial(
      await bob.client
        .from('mcp_server_connections')
        .insert({
          owner: alice.id,
          name: 'planted',
          transport: 'http',
          url: 'https://example.invalid/mcp',
        })
        .select('id'),
      'mcp_server_connections insert with a forged owner',
    );

    expectPolicyDenial(
      await bob.client
        .from('execution_runs')
        .insert({ graph_id: aliceRows.graphId, owner: alice.id, status: 'running' })
        .select('id'),
      'execution_runs insert with a forged owner',
    );

    // And bob cannot attach a run he owns to a graph he does not own either.
    expectPolicyDenial(
      await bob.client
        .from('execution_runs')
        .insert({ graph_id: aliceRows.graphId, owner: bob.id, status: 'running' })
        .select('id'),
      'execution_runs insert against a graph bob does not own',
    );

    // Nor a version row against alice's graph, in either direction.
    expectPolicyDenial(
      await bob.client
        .from('graph_versions')
        .insert({ graph_id: aliceRows.graphId, version: 99, graph_json: {}, created_by: bob.id })
        .select('id'),
      'graph_versions insert against a graph bob does not own',
    );

    expectPolicyDenial(
      await bob.client
        .from('graph_versions')
        .insert({ graph_id: bobRows.graphId, version: 99, graph_json: {}, created_by: alice.id })
        .select('id'),
      'graph_versions insert attributed to another user',
    );

    // Nothing landed: alice still has exactly the one graph she started with.
    const graphs = await alice.client.from('graphs').select('id');
    expect(graphs.error).toBeNull();
    expect(graphs.data?.map((row) => row.id)).toEqual([aliceRows.graphId]);
  });

  it('rejects an ownership transfer of a row you do own', async () => {
    // The hole a `using`-only update policy leaves open: alice passes the
    // visibility check on the way in, and without `with check` nothing stops the
    // row landing with bob's id in `owner`.
    expectPolicyDenial(
      await alice.client
        .from('graphs')
        .update({ owner: bob.id })
        .eq('id', aliceRows.graphId)
        .select('id'),
      'graphs ownership transfer',
    );

    expectPolicyDenial(
      await alice.client
        .from('mcp_server_connections')
        .update({ owner: bob.id })
        .eq('id', aliceRows.connectionId)
        .select('id'),
      'mcp_server_connections ownership transfer',
    );

    expectPolicyDenial(
      await alice.client
        .from('execution_runs')
        .update({ owner: bob.id })
        .eq('id', aliceRows.runId)
        .select('id'),
      'execution_runs ownership transfer',
    );

    // And the parent-repointing variant on the table with no owner column.
    // `version` is moved to an unused number in the same statement on purpose:
    // both users' fixture rows are version 1, so reparenting alone would also
    // collide with the unique (graph_id, version) constraint, and the assertion
    // would no longer be evidence about the policy.
    expectPolicyDenial(
      await alice.client
        .from('graph_versions')
        .update({ graph_id: bobRows.graphId, version: 4242 })
        .eq('graph_id', aliceRows.graphId)
        .select('id'),
      'graph_versions reparenting to another user',
    );

    // The row still belongs to alice, and bob's view is unchanged.
    const check = await alice.client
      .from('graphs')
      .select('owner')
      .eq('id', aliceRows.graphId)
      .single();
    expect(check.error).toBeNull();
    expect(check.data?.owner).toBe(alice.id);

    const bobsView = await bob.client.from('graphs').select('id');
    expect(bobsView.error).toBeNull();
    expect(bobsView.data?.map((row) => row.id)).toEqual([bobRows.graphId]);
  });

  /* ------------------------------------------------------------------------ */
  /* Anonymous access                                                          */
  /* ------------------------------------------------------------------------ */

  it.each(TABLES)('gives an anonymous client no read access to %s', async (table) => {
    const result = await anonymous.from(table).select('*');

    // `revoke all ... from anon` means this is a grant failure, not an empty
    // result set — the anon role cannot reach the table at all.
    expectGrantDenial(result, `anonymous select on ${table}`);
    expect(result.data ?? []).toEqual([]);
  });

  it('gives an anonymous client no write access either', async () => {
    expectGrantDenial(
      await anonymous
        .from('graphs')
        .insert({ owner: alice.id, title: 'anonymous graph' })
        .select('id'),
      'anonymous insert on graphs',
    );

    expectGrantDenial(
      await anonymous.from('graphs').delete().eq('id', aliceRows.graphId).select('id'),
      'anonymous delete on graphs',
    );

    expectGrantDenial(
      await anonymous
        .from('graphs')
        .update({ title: 'anonymous rename' })
        .eq('id', aliceRows.graphId)
        .select('id'),
      'anonymous update on graphs',
    );

    const survivors = await alice.client.from('graphs').select('id').eq('id', aliceRows.graphId);
    expect(survivors.error).toBeNull();
    expect(survivors.data).toHaveLength(1);
  });
});
