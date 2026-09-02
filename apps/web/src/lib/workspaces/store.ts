import 'server-only';

/**
 * Workspace reads.
 *
 * Every query here goes through the RLS-scoped client, and none of them carries
 * a `.eq('user_id', ...)` or an `owner` filter. Membership is decided by the
 * policies in 20260201000000_workspaces.sql; a filter here would be a second,
 * weaker copy of that logic that could disagree with it.
 *
 * Three reads go through database FUNCTIONS rather than tables, and each for a
 * specific reason spelled out at the call site: the member list needs
 * auth.users, the pending-invite list needs a workspace name the caller cannot
 * yet see, and the seat count is the single definition of Team entitlement.
 */

import { createClient } from '@/lib/supabase/server';

export type WorkspaceRole = 'owner' | 'admin' | 'member';

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  /** The caller's role in this workspace. Always present — they are a member. */
  role: WorkspaceRole;
  createdAt: string;
}

export interface WorkspaceMember {
  userId: string;
  email: string;
  displayName: string | null;
  role: WorkspaceRole;
  joinedAt: string;
}

export interface PendingInvitation {
  invitationId: string;
  workspaceId: string;
  workspaceName: string;
  role: 'admin' | 'member';
  expiresAt: string;
}

export interface SentInvitation {
  id: string;
  email: string;
  role: 'admin' | 'member';
  createdAt: string;
  expiresAt: string;
}

function isRole(value: unknown): value is WorkspaceRole {
  return value === 'owner' || value === 'admin' || value === 'member';
}

/** Every workspace the caller belongs to, with their role in each. */
export async function listWorkspaces(): Promise<Workspace[]> {
  const supabase = await createClient();

  // One round trip rather than two: the membership row carries the role and the
  // embedded workspace carries the rest. RLS applies to both sides of the join.
  const { data, error } = await supabase
    .from('workspace_members')
    .select('role, workspace:workspaces!inner(id, name, slug, owner, created_at)')
    .order('created_at', { ascending: true })
    .limit(50);

  if (error || !data) return [];

  const rows = data as unknown as Array<{
    role: string;
    workspace: { id: string; name: string; slug: string; owner: string; created_at: string } | null;
  }>;

  return rows.flatMap((row) => {
    if (!row.workspace || !isRole(row.role)) return [];
    return [
      {
        id: row.workspace.id,
        name: row.workspace.name,
        slug: row.workspace.slug,
        ownerId: row.workspace.owner,
        role: row.role,
        createdAt: row.workspace.created_at,
      },
    ];
  });
}

export async function getWorkspace(id: string): Promise<Workspace | null> {
  const all = await listWorkspaces();
  return all.find((workspace) => workspace.id === id) ?? null;
}

/**
 * The members of one workspace.
 *
 * Goes through `public.workspace_member_list()` because an email address lives
 * in auth.users, which `authenticated` cannot read and should not be able to.
 * That function is `security definer` and checks membership before it returns
 * anything, so it cannot be used to look up an address outside a workspace the
 * caller is in.
 */
export async function listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('workspace_member_list', { target: workspaceId });

  if (error || !Array.isArray(data)) return [];

  return (data as Array<Record<string, unknown>>).flatMap((row) => {
    if (!isRole(row.role)) return [];
    return [
      {
        userId: String(row.user_id),
        email: String(row.email ?? ''),
        displayName: typeof row.display_name === 'string' ? row.display_name : null,
        role: row.role,
        joinedAt: String(row.joined_at),
      },
    ];
  });
}

/** Invitations sent from this workspace and not yet accepted. */
export async function listSentInvitations(workspaceId: string): Promise<SentInvitation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('workspace_invitations')
    .select('id, email, role, created_at, expires_at')
    .eq('workspace_id', workspaceId)
    .is('accepted_at', null)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error || !data) return [];

  return data.map((row) => ({
    id: String(row.id),
    email: String(row.email),
    role: row.role === 'admin' ? 'admin' : 'member',
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at),
  }));
}

/**
 * Invitations addressed to the caller and still open.
 *
 * Goes through `public.pending_invitations()` rather than selecting the table,
 * because the invitee is not yet a member and so cannot read the workspace's
 * NAME — and widening the workspaces policy to invitees would make every
 * workspace name readable by anyone who can get an invite row created for them.
 */
export async function listPendingInvitations(): Promise<PendingInvitation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('pending_invitations');

  if (error || !Array.isArray(data)) return [];

  return (data as Array<Record<string, unknown>>).map((row) => ({
    invitationId: String(row.invitation_id),
    workspaceId: String(row.workspace_id),
    workspaceName: String(row.workspace_name),
    role: row.role === 'admin' ? 'admin' : 'member',
    expiresAt: String(row.expires_at),
  }));
}

/**
 * Seats this workspace has actually paid for, or 0.
 *
 * `public.workspace_paid_seats()` is the single definition of Team entitlement
 * in the system. Reimplementing the "status = active AND period not expired"
 * test here would give the product two answers to the same question, and the
 * one that drifts is always the one used for the check that matters.
 */
export async function paidSeats(workspaceId: string): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('workspace_paid_seats', { target: workspaceId });
  if (error || typeof data !== 'number') return 0;
  return data;
}
