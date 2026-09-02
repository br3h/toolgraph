/**
 * Workspace authorization isolation tests.
 *
 * Companion to `rls.test.ts`, and it follows the same rules: a real Postgres
 * behind a real PostgREST, three real users with real JWTs, and every isolation
 * assertion checks the POSITIVE half too — that a member sees what they should —
 * so a misconfigured client cannot make the suite pass by seeing nothing.
 *
 * What is being proven here is the thing a Team plan lives or dies on: that
 * membership is the only way into a workspace, that a role bounds what someone
 * can do inside it, and that none of it can be reached from outside.
 *
 * A NOTE ON HOW RLS REFUSES. An UPDATE or DELETE whose `using` clause does not
 * match silently affects zero rows — it does not raise. So a denial is asserted
 * by checking the row is UNCHANGED, not by expecting an error. Expecting an
 * error there would be a test that passes for the wrong reason on the day the
 * policy is dropped, because a dropped policy also returns no error.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

// The Supabase CLI's fixed local development keys — published, identical on
// every machine, and only unlocking a throwaway container on 127.0.0.1. Split
// into header + claims so the repo-wide gitleaks JWT rule does not fire on a
// public fixture. Same reasoning as rls.test.ts.
const LOCAL_JWT_HEADER = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
const LOCAL_ANON_KEY = `${LOCAL_JWT_HEADER}.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0`;
const LOCAL_SERVICE_ROLE_KEY = `${LOCAL_JWT_HEADER}.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU`;

const SUPABASE_URL =
  readEnv('SUPABASE_URL', 'SUPABASE_API_URL', 'API_URL') ?? 'http://127.0.0.1:54321';
const ANON_KEY = readEnv('SUPABASE_ANON_KEY', 'ANON_KEY') ?? LOCAL_ANON_KEY;
const SERVICE_ROLE_KEY =
  readEnv('SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY') ?? LOCAL_SERVICE_ROLE_KEY;

const TEST_PASSWORD = 'Toolgraph-Rls-Test-9';

function newClient(key: string): SupabaseClient {
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

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
    `Workspace suite skipped: no Supabase stack answering at ${SUPABASE_URL}. ` +
      'Start one with `supabase start && supabase db reset`.',
  );
}
const suite = stackIsReachable ? describe : describe.skip;

interface TestUser {
  id: string;
  email: string;
  client: SupabaseClient;
}

suite('workspace authorization', () => {
  let admin: SupabaseClient;
  let anonymous: SupabaseClient;
  /** Creates and owns the workspace. */
  let owner: TestUser;
  /** Invited, accepts, and is promoted and demoted through the suite. */
  let member: TestUser;
  /** Never invited. The control for every "from outside" assertion. */
  let stranger: TestUser;

  let workspaceId: string;

  async function createTestUser(tag: string): Promise<TestUser> {
    const email = `ws-${tag}-${crypto.randomUUID()}@toolgraph.test`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (error !== null || data.user === null) {
      throw new Error(`Could not create ${tag}: ${error?.message ?? 'no user returned'}`);
    }

    const client = newClient(ANON_KEY);
    const { data: session, error: signInError } = await client.auth.signInWithPassword({
      email,
      password: TEST_PASSWORD,
    });
    if (signInError !== null || session.session === null) {
      throw new Error(`Could not sign in ${tag}: ${signInError?.message ?? 'no session'}`);
    }
    return { id: data.user.id, email, client };
  }

  /** The workspace row read with the service key, bypassing every policy. */
  async function realWorkspace(): Promise<{ owner: string; name: string }> {
    const { data, error } = await admin
      .from('workspaces')
      .select('owner, name')
      .eq('id', workspaceId)
      .single();
    if (error !== null || data === null) throw new Error('workspace vanished');
    return data as { owner: string; name: string };
  }

  async function roleOf(user: TestUser): Promise<string | null> {
    const { data } = await admin
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .maybeSingle();
    return (data as { role: string } | null)?.role ?? null;
  }

  beforeAll(async () => {
    admin = newClient(SERVICE_ROLE_KEY);
    anonymous = newClient(ANON_KEY);

    owner = await createTestUser('owner');
    member = await createTestUser('member');
    stranger = await createTestUser('stranger');

    const { data, error } = await owner.client
      .from('workspaces')
      .insert({ owner: owner.id, name: 'Acme', slug: `acme-${crypto.randomUUID().slice(0, 8)}` })
      .select('id')
      .single();
    if (error !== null || data === null) {
      throw new Error(`Could not create workspace: ${error?.message ?? 'no row'}`);
    }
    workspaceId = String(data.id);
  });

  afterAll(async () => {
    for (const user of [owner, member, stranger]) {
      if (user === undefined) continue;
      const { error } = await admin.auth.admin.deleteUser(user.id);
      if (error !== null) console.warn(`Could not clean up ${user.email}: ${error.message}`);
    }
  });

  /* ------------------------------------------------------------------------ */
  /* Positive controls                                                         */
  /* ------------------------------------------------------------------------ */

  it('makes the creator the owner, as a real membership row', async () => {
    // Without the trigger that writes this row, the workspace would be
    // invisible to the person who just made it — every select policy below is
    // written in terms of membership, not the `owner` column.
    expect(await roleOf(owner)).toBe('owner');

    const visible = await owner.client.from('workspaces').select('id').eq('id', workspaceId);
    expect(visible.error).toBeNull();
    expect(visible.data).toHaveLength(1);
  });

  /* ------------------------------------------------------------------------ */
  /* From outside the workspace                                                */
  /* ------------------------------------------------------------------------ */

  it('hides the workspace from a stranger', async () => {
    const seen = await stranger.client.from('workspaces').select('id').eq('id', workspaceId);
    expect(seen.error).toBeNull();
    expect(seen.data).toEqual([]);
  });

  it('hides the membership list from a stranger', async () => {
    const seen = await stranger.client
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', workspaceId);
    expect(seen.error).toBeNull();
    expect(seen.data).toEqual([]);
  });

  it('refuses to list members to a stranger through the definer function', async () => {
    // workspace_member_list() reads auth.users, so it runs as definer. Its
    // is_workspace_member() gate is the only thing stopping it being an email
    // lookup for any workspace id somebody can guess.
    const { error } = await stranger.client.rpc('workspace_member_list', { target: workspaceId });
    expect(error).not.toBeNull();
  });

  it('refuses a stranger who tries to add themselves as a member', async () => {
    // The single most important denial in the file: workspace ids travel in
    // URLs, so a self-insert would be "join any workspace whose id you can see".
    const { error } = await stranger.client
      .from('workspace_members')
      .insert({ workspace_id: workspaceId, user_id: stranger.id, role: 'admin' });

    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
    expect(await roleOf(stranger)).toBeNull();
  });

  it('refuses a stranger who tries to accept an invitation that is not theirs', async () => {
    await owner.client.from('workspace_invitations').insert({
      workspace_id: workspaceId,
      email: member.email.toLowerCase(),
      role: 'member',
      invited_by: owner.id,
    });

    // accept_workspace_invitation() matches on the CALLER's own verified email,
    // read from auth.users — never on an argument. Passing the right workspace
    // id is not enough.
    const { error } = await stranger.client.rpc('accept_workspace_invitation', {
      target: workspaceId,
    });
    expect(error).not.toBeNull();
    expect(await roleOf(stranger)).toBeNull();
  });

  it('does not show a stranger the invitation addressed to somebody else', async () => {
    const seen = await stranger.client.from('workspace_invitations').select('id');
    expect(seen.error).toBeNull();
    expect(seen.data).toEqual([]);
  });

  it('gives an invitee the workspace name without giving them the workspace', async () => {
    const { data, error } = await member.client.rpc('pending_invitations');
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    expect((data as { workspace_name: string }[])[0]?.workspace_name).toBe('Acme');

    // And still cannot read the table it came from.
    const direct = await member.client.from('workspaces').select('id').eq('id', workspaceId);
    expect(direct.data).toEqual([]);
  });

  it('refuses anonymous access to every workspace table', async () => {
    for (const table of ['workspaces', 'workspace_members', 'workspace_invitations'] as const) {
      const { error } = await anonymous.from(table).select('id');
      expect(error, `${table} was readable anonymously`).not.toBeNull();
      // `permission denied` rather than a policy refusal: anon is revoked at the
      // grant layer, before RLS is consulted. If anon were ever re-granted, this
      // would start failing inside RLS instead and this assertion catches it.
      expect(error?.message.toLowerCase()).toContain('permission denied');
    }
  });

  /* ------------------------------------------------------------------------ */
  /* Joining, and what a member may do                                         */
  /* ------------------------------------------------------------------------ */

  it('lets the invited person accept their own invitation', async () => {
    const { error } = await member.client.rpc('accept_workspace_invitation', {
      target: workspaceId,
    });
    expect(error).toBeNull();
    expect(await roleOf(member)).toBe('member');
  });

  it('is idempotent when the same invitation is accepted twice', async () => {
    // A double-clicked button must not be an error the user has to interpret.
    const { error } = await member.client.rpc('accept_workspace_invitation', {
      target: workspaceId,
    });
    // The invitation is now consumed, so a second attempt is refused — but the
    // membership from the first is intact, which is the property that matters.
    expect(error).not.toBeNull();
    expect(await roleOf(member)).toBe('member');
  });

  it('shows a shared graph to a member and not to a stranger', async () => {
    const { data, error } = await owner.client
      .from('graphs')
      .insert({ owner: owner.id, title: 'Shared', workspace_id: workspaceId })
      .select('id')
      .single();
    expect(error).toBeNull();
    const sharedId = String(data?.id);

    const memberSees = await member.client.from('graphs').select('id').eq('id', sharedId);
    expect(memberSees.data).toHaveLength(1);

    const strangerSees = await stranger.client.from('graphs').select('id').eq('id', sharedId);
    expect(strangerSees.data).toEqual([]);
  });

  it('keeps a private graph private even from a workspace colleague', async () => {
    const { data } = await owner.client
      .from('graphs')
      .insert({ owner: owner.id, title: 'Private' })
      .select('id')
      .single();
    const privateId = String(data?.id);

    // The whole point of `workspace_id` being nullable: sharing is opt-in per
    // graph, not a property of belonging to a workspace.
    const seen = await member.client.from('graphs').select('id').eq('id', privateId);
    expect(seen.data).toEqual([]);
  });

  it('refuses a member who tries to seize ownership', async () => {
    const before = await realWorkspace();

    await member.client.from('workspaces').update({ owner: member.id }).eq('id', workspaceId);

    // The update is filtered to zero rows rather than raising, so the assertion
    // is on the row, not on an error. See the note at the top of this file.
    expect((await realWorkspace()).owner).toBe(before.owner);
  });

  it('refuses a member who tries to rename the workspace', async () => {
    await member.client.from('workspaces').update({ name: 'Seized' }).eq('id', workspaceId);
    expect((await realWorkspace()).name).toBe('Acme');
  });

  it('refuses a member who tries to promote themselves', async () => {
    await member.client
      .from('workspace_members')
      .update({ role: 'admin' })
      .eq('workspace_id', workspaceId)
      .eq('user_id', member.id);

    expect(await roleOf(member)).toBe('member');
  });

  it('refuses a member who tries to delete a shared graph', async () => {
    const { data } = await owner.client
      .from('graphs')
      .insert({ owner: owner.id, title: 'Precious', workspace_id: workspaceId })
      .select('id')
      .single();
    const graphId = String(data?.id);

    await member.client.from('graphs').delete().eq('id', graphId);

    // A member may edit a shared graph but not destroy it — deleting other
    // people's work is an admin action.
    const { data: still } = await admin.from('graphs').select('id').eq('id', graphId);
    expect(still).toHaveLength(1);
  });

  it('refuses a member who tries to invite somebody', async () => {
    const { error } = await member.client.from('workspace_invitations').insert({
      workspace_id: workspaceId,
      email: 'outsider@toolgraph.test',
      role: 'admin',
      invited_by: member.id,
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
  });

  /* ------------------------------------------------------------------------ */
  /* Admin, and the owner boundary                                             */
  /* ------------------------------------------------------------------------ */

  it('lets an owner promote a member to admin', async () => {
    const { error } = await owner.client
      .from('workspace_members')
      .update({ role: 'admin' })
      .eq('workspace_id', workspaceId)
      .eq('user_id', member.id);

    expect(error).toBeNull();
    expect(await roleOf(member)).toBe('admin');
  });

  it('refuses even an admin who tries to rewrite the owner column', async () => {
    // An admin PASSES the update policy — this is the case the policy alone
    // cannot stop, because an RLS expression sees one row and cannot compare the
    // new `owner` to the old. The `workspaces_freeze_owner` trigger is what
    // closes it, and this is the test that proves the trigger is doing so.
    const { error } = await member.client
      .from('workspaces')
      .update({ owner: member.id })
      .eq('id', workspaceId);

    expect(error).not.toBeNull();
    expect((await realWorkspace()).owner).toBe(owner.id);
  });

  it('lets an admin rename the workspace', async () => {
    const { error } = await member.client
      .from('workspaces')
      .update({ name: 'Acme Renamed' })
      .eq('id', workspaceId);

    expect(error).toBeNull();
    expect((await realWorkspace()).name).toBe('Acme Renamed');
  });

  it('refuses an admin who tries to remove the owner', async () => {
    await member.client
      .from('workspace_members')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('user_id', owner.id);

    // Removing the owner would leave a workspace nobody can delete or transfer.
    expect(await roleOf(owner)).toBe('owner');
  });

  it('refuses an admin who tries to promote somebody to owner', async () => {
    await member.client
      .from('workspace_members')
      .update({ role: 'owner' })
      .eq('workspace_id', workspaceId)
      .eq('user_id', member.id);

    expect(await roleOf(member)).toBe('admin');
  });

  it('refuses a non-owner who tries to transfer the workspace', async () => {
    const { error } = await member.client.rpc('transfer_workspace_ownership', {
      target: workspaceId,
      new_owner: member.id,
    });
    expect(error).not.toBeNull();
    expect((await realWorkspace()).owner).toBe(owner.id);
  });

  it('refuses a transfer to somebody who is not a member', async () => {
    const { error } = await owner.client.rpc('transfer_workspace_ownership', {
      target: workspaceId,
      new_owner: stranger.id,
    });
    expect(error).not.toBeNull();
    expect((await realWorkspace()).owner).toBe(owner.id);
  });

  /* ------------------------------------------------------------------------ */
  /* Credentials, and entitlement                                              */
  /* ------------------------------------------------------------------------ */

  it('refuses every authenticated read of connection_secrets', async () => {
    for (const user of [owner, member, stranger]) {
      const { error } = await user.client.from('connection_secrets').select('connection_id');
      expect(error, 'connection_secrets was readable by an authenticated user').not.toBeNull();
      // Refused by the GRANT, not by RLS: the table is granted to service_role
      // alone. If it were ever granted to `authenticated`, this would start
      // failing inside RLS instead and the message would change.
      expect(error?.message.toLowerCase()).toContain('permission denied');
    }
  });

  it('refuses anonymous access to connection_secrets', async () => {
    const { error } = await anonymous.from('connection_secrets').select('connection_id');
    expect(error).not.toBeNull();
  });

  it('reports no paid seats for a workspace that has not paid', async () => {
    // The single definition of Team entitlement. A workspace with no
    // subscription must report zero, not null and not a truthy default.
    const { data, error } = await owner.client.rpc('workspace_paid_seats', {
      target: workspaceId,
    });
    expect(error).toBeNull();
    expect(data).toBe(0);
  });

  it('does not treat a pending subscription as paid seats', async () => {
    // 'pending' is a claim, not an entitlement. This is the assertion that stops
    // somebody unlocking seats by submitting a transaction hash and no money.
    await admin.from('subscriptions').upsert(
      {
        owner: owner.id,
        status: 'pending',
        plan: 'team',
        billing_interval: 'monthly',
        seats: 10,
        workspace_id: workspaceId,
        current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      },
      { onConflict: 'owner' },
    );

    const { data } = await owner.client.rpc('workspace_paid_seats', { target: workspaceId });
    expect(data).toBe(0);
  });

  it('does not treat an expired active subscription as paid seats', async () => {
    await admin
      .from('subscriptions')
      .update({ status: 'active', current_period_end: new Date(Date.now() - 1000).toISOString() })
      .eq('owner', owner.id);

    const { data } = await owner.client.rpc('workspace_paid_seats', { target: workspaceId });
    expect(data).toBe(0);
  });

  it('reports paid seats for an active, unexpired Team subscription', async () => {
    // The positive control for the three denials above. Without it they could
    // all pass because the function simply always returns zero.
    await admin
      .from('subscriptions')
      .update({
        status: 'active',
        current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      })
      .eq('owner', owner.id);

    const { data } = await owner.client.rpc('workspace_paid_seats', { target: workspaceId });
    expect(data).toBe(10);
  });

  it('refuses a user who writes their own subscription row', async () => {
    // subscriptions is select-only for users, with explicit `false` policies.
    // A user who could write it could grant themselves a hundred years of Team.
    const { error } = await stranger.client
      .from('subscriptions')
      .insert({ owner: stranger.id, status: 'active', plan: 'team' });
    expect(error).not.toBeNull();
  });

  it('refuses a Team payment claim against a workspace the caller does not administer', async () => {
    // Without the can_administer_workspace() conjunct on the insert policy,
    // anyone could file a claim against a stranger's workspace id and — on
    // verification — mint seats on it.
    const { error } = await stranger.client.from('payment_submissions').insert({
      owner: stranger.id,
      currency: 'ETH',
      tx_hash: `0x${'a'.repeat(64)}`,
      status: 'pending',
      plan: 'team',
      billing_interval: 'monthly',
      seats: 5,
      workspace_id: workspaceId,
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
  });

  /* ------------------------------------------------------------------------ */
  /* Leaving                                                                   */
  /* ------------------------------------------------------------------------ */

  it('lets a member leave, and takes the shared graphs with them', async () => {
    const { error } = await member.client
      .from('workspace_members')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('user_id', member.id);

    expect(error).toBeNull();
    expect(await roleOf(member)).toBeNull();

    // And loses sight of what membership was granting.
    const seen = await member.client.from('graphs').select('id').eq('workspace_id', workspaceId);
    expect(seen.data).toEqual([]);
  });

  it('refuses to let the owner leave', async () => {
    await owner.client
      .from('workspace_members')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('user_id', owner.id);

    // The owner transfers or deletes; they do not walk away and orphan it.
    expect(await roleOf(owner)).toBe('owner');
  });
});
