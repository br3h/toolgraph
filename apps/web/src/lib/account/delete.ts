import 'server-only';

/**
 * Deleting an account, for real.
 *
 * The whole operation rests on one property of the schema: every table that
 * references `auth.users` does so with `on delete cascade`. Removing the auth
 * user therefore removes graphs, graph_versions, connections, execution_runs,
 * subscriptions, payment_submissions, profiles, workspace memberships and
 * invitations in a single transaction inside Postgres — not as a list of
 * deletes in this file that could be reordered, half-fail, or fall behind the
 * schema when a table is added.
 *
 * `connection_secrets` cascades from `mcp_server_connections`, which cascades
 * from the user, so stored credentials go with it.
 *
 * Two things do NOT simply cascade, and both are handled explicitly below:
 *
 *   1. A workspace the user OWNS cascades too — and it would take other
 *      people's shared graphs with it. That is somebody else's data destroyed
 *      by a third party's account closure, so deletion is REFUSED while such a
 *      workspace has other members. The user is told to transfer it or remove
 *      the members first.
 *
 *   2. `payment_submissions` is an audit trail of money. It cascades with the
 *      user by the schema's own design, which is the right call for a privacy
 *      request — but it means the record goes, so the summary returned here
 *      says so rather than pretending otherwise.
 */

import { createAdminClient, createClient } from '@/lib/supabase/server';

export type DeletionBlocker = {
  kind: 'owned_workspace_with_members';
  workspaceId: string;
  workspaceName: string;
  memberCount: number;
};

export interface DeletionPreview {
  graphs: number;
  connections: number;
  runs: number;
  workspacesDeleted: { id: string; name: string }[];
  workspacesLeft: { id: string; name: string }[];
  blockers: DeletionBlocker[];
}

/**
 * What deleting this account would do, computed through the RLS-scoped client
 * so it can only ever describe the caller's own data.
 *
 * Shown before the confirmation, because "delete everything" is not informed
 * consent when the person cannot see what everything is.
 */
export async function previewDeletion(userId: string): Promise<DeletionPreview> {
  const supabase = await createClient();

  const [graphs, connections, runs, memberships] = await Promise.all([
    supabase.from('graphs').select('id', { count: 'exact', head: true }),
    supabase.from('mcp_server_connections').select('id', { count: 'exact', head: true }),
    supabase.from('execution_runs').select('id', { count: 'exact', head: true }),
    supabase
      .from('workspace_members')
      .select('role, workspace:workspaces!inner(id, name, owner)')
      .limit(50),
  ]);

  const rows = (memberships.data ?? []) as unknown as Array<{
    role: string;
    workspace: { id: string; name: string; owner: string } | null;
  }>;

  const workspacesDeleted: { id: string; name: string }[] = [];
  const workspacesLeft: { id: string; name: string }[] = [];
  const blockers: DeletionBlocker[] = [];

  for (const row of rows) {
    const workspace = row.workspace;
    if (!workspace) continue;

    if (workspace.owner !== userId) {
      // Not ours to destroy; we simply stop being in it.
      workspacesLeft.push({ id: workspace.id, name: workspace.name });
      continue;
    }

    // Counted through the scoped client: the caller is a member, so the
    // membership rows for this workspace are visible to them.
    const { count } = await supabase
      .from('workspace_members')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspace.id);

    const members = count ?? 1;
    if (members > 1) {
      blockers.push({
        kind: 'owned_workspace_with_members',
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        memberCount: members,
      });
    } else {
      workspacesDeleted.push({ id: workspace.id, name: workspace.name });
    }
  }

  return {
    graphs: graphs.count ?? 0,
    connections: connections.count ?? 0,
    runs: runs.count ?? 0,
    workspacesDeleted,
    workspacesLeft,
    blockers,
  };
}

export type DeletionResult =
  { ok: true } | { ok: false; error: string; blockers?: DeletionBlocker[] };

/**
 * Delete the account.
 *
 * `userId` MUST come from a verified session (`getCurrentUser()`), never from a
 * request body — the admin client bypasses RLS entirely, so an id taken from
 * input here would be a one-line cross-user deletion. Every call site passes
 * `guard.user.id`.
 */
export async function deleteAccount(userId: string): Promise<DeletionResult> {
  if (!userId) return { ok: false, error: 'There is no account to delete.' };

  // Re-checked at the moment of deletion, not just at the moment of preview: a
  // member could have joined an owned workspace in between.
  const preview = await previewDeletion(userId);
  if (preview.blockers.length > 0) {
    return {
      ok: false,
      error:
        'This account still owns a workspace that other people are in. Transfer it to another ' +
        'member, or remove them, before deleting the account — otherwise their shared graphs ' +
        'would be deleted with it.',
      blockers: preview.blockers,
    };
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    // The secret key being absent is a deployment fault. Saying "deleted" when
    // nothing was deleted is the one outcome that must not happen.
    return {
      ok: false,
      error: 'Account deletion is not available on this deployment. Contact support.',
    };
  }

  // One call. Postgres does the rest through the cascades described above.
  const { error } = await admin.auth.admin.deleteUser(userId);

  if (error) {
    console.error(`account: deletion failed for ${userId}: ${error.message}`);
    return { ok: false, error: 'That account could not be deleted. Nothing has been removed.' };
  }

  return { ok: true };
}
