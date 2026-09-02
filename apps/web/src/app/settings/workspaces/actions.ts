'use server';

/**
 * Workspace mutations.
 *
 * Every authorization decision here is made by Postgres, and that is worth
 * being explicit about because it is easy to read this file as if the checks
 * were missing:
 *
 *   * creating   — the insert policy pins `owner` to auth.uid(), and a trigger
 *                  adds the owner's membership row.
 *   * inviting   — the insert policy requires can_administer_workspace().
 *   * accepting  — accept_workspace_invitation() checks the invite is addressed
 *                  to the caller's own verified email, read from auth.users.
 *   * role change— the update policy requires admin AND refuses the owner row.
 *   * removal    — the delete policy allows admins, or the member themselves.
 *   * transfer   — transfer_workspace_ownership() requires the current owner.
 *
 * A failed write therefore comes back as "no rows affected" or a Postgres
 * error, and the messages below turn that into something a person can act on.
 * None of them is the boundary.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createClient } from '@/lib/supabase/server';
import { guardAction } from '@/lib/actions-guard';
import { sendWorkspaceInviteEmail } from '@/lib/email';
import { publicEnv } from '@/lib/public-env';

export interface WorkspaceResult {
  ok: boolean;
  error?: string;
  notice?: string;
  id?: string;
}

const uuid = z.string().uuid('That is not a valid id.');

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Give the workspace a name.')
  .max(120, 'That name is too long.');

/**
 * Turn a name into a slug the `workspaces_slug_check` constraint accepts:
 * lowercase, alphanumeric and hyphens, 3–60 characters, no leading or trailing
 * hyphen. A random suffix keeps two workspaces called "Platform" from
 * colliding on the unique index — the alternative is a retry loop, and a name
 * clash is not worth one.
 */
function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  const suffix = Math.random().toString(36).slice(2, 8);
  const stem = base.length >= 2 ? base : 'workspace';
  return `${stem}-${suffix}`;
}

export async function createWorkspace(formData: FormData): Promise<WorkspaceResult> {
  const guard = await guardAction('connectionWrite');
  if (!guard.ok) return { ok: false, error: guard.error };

  const parsed = nameSchema.safeParse(formData.get('name') ?? '');
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('workspaces')
    .insert({ owner: guard.user.id, name: parsed.data, slug: slugify(parsed.data) })
    .select('id')
    .single();

  if (error || !data) return { ok: false, error: 'That workspace could not be created.' };

  revalidatePath('/settings/workspaces');
  return { ok: true, id: String(data.id), notice: 'Workspace created.' };
}

export async function renameWorkspace(id: string, name: string): Promise<WorkspaceResult> {
  const guard = await guardAction('connectionWrite');
  if (!guard.ok) return { ok: false, error: guard.error };

  const parsedId = uuid.safeParse(id);
  if (!parsedId.success) return { ok: false, error: parsedId.error.issues[0]?.message };
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('workspaces')
    .update({ name: parsed.data })
    .eq('id', parsedId.data)
    .select('id');

  if (error) return { ok: false, error: 'That workspace could not be renamed.' };
  // RLS filters an unauthorised update to zero rows rather than raising, so an
  // empty result is the denial and has to be checked for explicitly.
  if (!data || data.length === 0) {
    return { ok: false, error: 'Only an admin can rename this workspace.' };
  }

  revalidatePath('/settings/workspaces');
  return { ok: true, notice: 'Saved.' };
}

const inviteSchema = z.object({
  workspaceId: uuid,
  // Lowercased to match the `email = lower(email)` constraint, so the same
  // address invited twice in different cases collides on the unique index
  // instead of creating a second invitation.
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(254),
  role: z.enum(['admin', 'member']),
});

export async function inviteMember(formData: FormData): Promise<WorkspaceResult> {
  // The `invite` policy, not `connectionWrite`: this puts mail in a third
  // party's inbox with our name on it, so the limit protects them, not us.
  const guard = await guardAction('invite');
  if (!guard.ok) return { ok: false, error: guard.error };

  const parsed = inviteSchema.safeParse({
    workspaceId: formData.get('workspaceId'),
    email: formData.get('email'),
    role: formData.get('role') ?? 'member',
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase.from('workspace_invitations').insert({
    workspace_id: parsed.data.workspaceId,
    email: parsed.data.email,
    role: parsed.data.role,
    invited_by: guard.user.id,
  });

  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: 'That address has already been invited.' };
    }
    // 42501 here means the insert policy refused: the caller is not an admin.
    return {
      ok: false,
      error:
        error.code === '42501'
          ? 'Only an admin can invite people to this workspace.'
          : 'That invitation could not be sent.',
    };
  }

  // The row is the invitation; the email is a notification about it. A mail
  // failure must not roll back an invite that already exists and is already
  // acceptable from the invitee's own settings page.
  const workspace = await supabase
    .from('workspaces')
    .select('name')
    .eq('id', parsed.data.workspaceId)
    .maybeSingle();

  void sendWorkspaceInviteEmail(
    parsed.data.email,
    String(workspace.data?.name ?? 'a Toolgraph workspace'),
    `${publicEnv.siteUrl}/settings/workspaces`,
  ).catch(() => {});

  revalidatePath('/settings/workspaces');
  return { ok: true, notice: `Invited ${parsed.data.email}.` };
}

export async function revokeInvitation(id: string): Promise<WorkspaceResult> {
  const guard = await guardAction('connectionWrite');
  if (!guard.ok) return { ok: false, error: guard.error };

  const parsedId = uuid.safeParse(id);
  if (!parsedId.success) return { ok: false, error: parsedId.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase.from('workspace_invitations').delete().eq('id', parsedId.data);
  if (error) return { ok: false, error: 'That invitation could not be withdrawn.' };

  revalidatePath('/settings/workspaces');
  return { ok: true, notice: 'Invitation withdrawn.' };
}

export async function acceptInvitation(workspaceId: string): Promise<WorkspaceResult> {
  const guard = await guardAction('connectionWrite');
  if (!guard.ok) return { ok: false, error: guard.error };

  const parsedId = uuid.safeParse(workspaceId);
  if (!parsedId.success) return { ok: false, error: parsedId.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase.rpc('accept_workspace_invitation', { target: parsedId.data });

  if (error) {
    // P0002 is the function's own "no open invitation for this account", which
    // is also what a caller trying to join somebody else's workspace gets.
    return {
      ok: false,
      error: error.message.includes('no open invitation')
        ? 'That invitation is no longer open. Ask an admin to send it again.'
        : 'That invitation could not be accepted.',
    };
  }

  revalidatePath('/settings/workspaces');
  revalidatePath('/graphs');
  return { ok: true, notice: 'You are in.' };
}

const roleSchema = z.enum(['admin', 'member']);

export async function changeMemberRole(
  workspaceId: string,
  userId: string,
  role: string,
): Promise<WorkspaceResult> {
  const guard = await guardAction('connectionWrite');
  if (!guard.ok) return { ok: false, error: guard.error };

  const parsedWorkspace = uuid.safeParse(workspaceId);
  const parsedUser = uuid.safeParse(userId);
  const parsedRole = roleSchema.safeParse(role);
  if (!parsedWorkspace.success || !parsedUser.success || !parsedRole.success) {
    return { ok: false, error: 'That change could not be made.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('workspace_members')
    .update({ role: parsedRole.data })
    .eq('workspace_id', parsedWorkspace.data)
    .eq('user_id', parsedUser.data)
    .select('id');

  if (error) return { ok: false, error: 'That role could not be changed.' };
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: "Only an admin can change roles, and the owner's role cannot be changed here.",
    };
  }

  revalidatePath('/settings/workspaces');
  return { ok: true, notice: 'Role updated.' };
}

export async function removeMember(workspaceId: string, userId: string): Promise<WorkspaceResult> {
  const guard = await guardAction('connectionWrite');
  if (!guard.ok) return { ok: false, error: guard.error };

  const parsedWorkspace = uuid.safeParse(workspaceId);
  const parsedUser = uuid.safeParse(userId);
  if (!parsedWorkspace.success || !parsedUser.success) {
    return { ok: false, error: 'That member could not be removed.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('workspace_members')
    .delete()
    .eq('workspace_id', parsedWorkspace.data)
    .eq('user_id', parsedUser.data)
    .select('id');

  if (error) return { ok: false, error: 'That member could not be removed.' };
  if (!data || data.length === 0) {
    return {
      ok: false,
      error:
        'That member could not be removed. The owner cannot be removed — transfer the workspace first.',
    };
  }

  revalidatePath('/settings/workspaces');
  return { ok: true, notice: 'Member removed.' };
}

export async function transferOwnership(
  workspaceId: string,
  newOwnerId: string,
): Promise<WorkspaceResult> {
  const guard = await guardAction('destructive');
  if (!guard.ok) return { ok: false, error: guard.error };

  const parsedWorkspace = uuid.safeParse(workspaceId);
  const parsedUser = uuid.safeParse(newOwnerId);
  if (!parsedWorkspace.success || !parsedUser.success) {
    return { ok: false, error: 'That transfer could not be made.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('transfer_workspace_ownership', {
    target: parsedWorkspace.data,
    new_owner: parsedUser.data,
  });

  if (error) {
    return {
      ok: false,
      error: error.message.includes('already a member')
        ? 'The new owner has to be a member of the workspace already.'
        : 'Only the current owner can transfer a workspace.',
    };
  }

  revalidatePath('/settings/workspaces');
  return { ok: true, notice: 'Ownership transferred. You are now an admin.' };
}

export async function leaveWorkspace(workspaceId: string): Promise<WorkspaceResult> {
  const guard = await guardAction('connectionWrite');
  if (!guard.ok) return { ok: false, error: guard.error };

  const parsedId = uuid.safeParse(workspaceId);
  if (!parsedId.success) return { ok: false, error: parsedId.error.issues[0]?.message };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('workspace_members')
    .delete()
    .eq('workspace_id', parsedId.data)
    .eq('user_id', guard.user.id)
    .select('id');

  if (error) return { ok: false, error: 'You could not be removed from that workspace.' };
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: 'The owner cannot leave. Transfer the workspace to someone else, or delete it.',
    };
  }

  revalidatePath('/settings/workspaces');
  revalidatePath('/graphs');
  return { ok: true, notice: 'You have left the workspace.' };
}

export async function deleteWorkspace(workspaceId: string): Promise<WorkspaceResult> {
  const guard = await guardAction('destructive');
  if (!guard.ok) return { ok: false, error: guard.error };

  const parsedId = uuid.safeParse(workspaceId);
  if (!parsedId.success) return { ok: false, error: parsedId.error.issues[0]?.message };

  const supabase = await createClient();
  // Cascades to members, invitations, shared graphs and shared connections.
  // Only the owner's delete policy allows this at all.
  const { data, error } = await supabase
    .from('workspaces')
    .delete()
    .eq('id', parsedId.data)
    .select('id');

  if (error) return { ok: false, error: 'That workspace could not be deleted.' };
  if (!data || data.length === 0) {
    return { ok: false, error: 'Only the owner can delete a workspace.' };
  }

  revalidatePath('/settings/workspaces');
  revalidatePath('/graphs');
  revalidatePath('/connections');
  return { ok: true, notice: 'Workspace deleted.' };
}
