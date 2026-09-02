'use client';

/**
 * One workspace: its members, its open invitations, and the actions available
 * to whoever is looking at it.
 *
 * Which controls are rendered depends on the viewer's role, and that is a
 * usability decision, not a security one — every action calls a server action
 * whose write is refused by RLS regardless of what this component chose to
 * draw. Hiding a button a member cannot use is worth doing because offering one
 * that always fails is worse; it is not what stops them.
 */

import { useState, useTransition } from 'react';
import { Alert, Badge, Button, Input, Select } from '@toolgraph/ui';

import {
  changeMemberRole,
  deleteWorkspace,
  inviteMember,
  leaveWorkspace,
  removeMember,
  renameWorkspace,
  revokeInvitation,
  transferOwnership,
} from '@/app/settings/workspaces/actions';
import type { SentInvitation, Workspace, WorkspaceMember } from '@/lib/workspaces/store';
import { PLANS } from '@/lib/billing/plan';

export interface WorkspaceCardProps {
  workspace: Workspace;
  members: WorkspaceMember[];
  sent: SentInvitation[];
  /** From `public.workspace_paid_seats()`. 0 means no active Team plan. */
  paidSeats: number;
  currentUserId: string;
}

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};

export function WorkspaceCard({
  workspace,
  members,
  sent,
  paidSeats,
  currentUserId,
}: WorkspaceCardProps) {
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(workspace.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const isOwner = workspace.role === 'owner';
  const isAdmin = isOwner || workspace.role === 'admin';

  const run = (fn: () => Promise<{ ok: boolean; error?: string; notice?: string }>) => {
    setMessage(null);
    startTransition(async () => {
      const result = await fn();
      setMessage(
        result.ok
          ? { kind: 'ok', text: result.notice ?? 'Done.' }
          : { kind: 'error', text: result.error ?? 'That did not work.' },
      );
    });
  };

  // Seats used counts members, not invitations: an invitation is not a seat
  // until somebody accepts it. Saying otherwise would bill for an unanswered
  // email.
  const seatsUsed = members.length;
  const overSeats = paidSeats > 0 && seatsUsed > paidSeats;

  return (
    <section className="rounded-[var(--tg-radius-lg)] border border-border-subtle bg-bg-raised p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold tracking-tight">{workspace.name}</h2>
          <p className="mt-0.5 text-xs text-fg-subtle">
            You are {ROLE_LABEL[workspace.role]?.toLowerCase()} · {seatsUsed}{' '}
            {seatsUsed === 1 ? 'member' : 'members'}
            {paidSeats > 0 ? ` · ${paidSeats} paid ${paidSeats === 1 ? 'seat' : 'seats'}` : ''}
          </p>
        </div>
        <Badge variant={paidSeats > 0 ? 'strong' : 'subtle'}>
          {paidSeats > 0 ? 'Team plan' : 'No Team plan'}
        </Badge>
      </div>

      {message ? (
        <div className="mt-4">
          <Alert variant={message.kind === 'ok' ? 'success' : 'error'}>{message.text}</Alert>
        </div>
      ) : null}

      {/*
        The honest statement of what an unpaid workspace is. Sharing keeps
        working — the RLS policies do not consult billing, and switching them
        off would mean losing access to graphs somebody already made. What
        the plan buys is stated plainly instead of implied by a locked door.
      */}
      {paidSeats === 0 ? (
        <p className="mt-4 rounded-[var(--tg-radius-md)] border border-border px-3 py-2.5 text-xs leading-relaxed text-fg-muted">
          This workspace has no Team subscription. Sharing still works — nothing is locked — and the
          plan is what pays for the hosted runner at team volume, at ${PLANS.team.monthlyUsd} per
          seat per month or ${PLANS.team.annualUsd} per seat per year.
        </p>
      ) : null}

      {overSeats ? (
        <div className="mt-4">
          <Alert variant="warning" title="More members than paid seats">
            This workspace has {seatsUsed} members and {paidSeats} paid seats. Nothing is blocked —
            add seats when you next renew.
          </Alert>
        </div>
      ) : null}

      {/* --- Members ------------------------------------------------------ */}
      <h3 className="mt-5 text-xs font-medium uppercase tracking-[0.1em] text-fg-subtle">
        Members
      </h3>
      <ul className="mt-2 space-y-2">
        {members.map((member) => {
          const isSelf = member.userId === currentUserId;
          return (
            <li
              key={member.userId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--tg-radius-md)] border border-border px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm">
                  {member.displayName || member.email}
                  {isSelf ? <span className="ml-1.5 text-xs text-fg-subtle">(you)</span> : null}
                </p>
                {member.displayName ? (
                  <p className="truncate text-xs text-fg-subtle">{member.email}</p>
                ) : null}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {isAdmin && member.role !== 'owner' ? (
                  <Select
                    label={`Role for ${member.email}`}
                    labelHidden
                    value={member.role}
                    disabled={pending}
                    onChange={(event) =>
                      run(() => changeMemberRole(workspace.id, member.userId, event.target.value))
                    }
                    className="w-28"
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </Select>
                ) : (
                  <Badge variant="subtle">{ROLE_LABEL[member.role]}</Badge>
                )}

                {isOwner && !isSelf ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => run(() => transferOwnership(workspace.id, member.userId))}
                  >
                    Make owner
                  </Button>
                ) : null}

                {isAdmin && member.role !== 'owner' && !isSelf ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => run(() => removeMember(workspace.id, member.userId))}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {/* --- Invitations -------------------------------------------------- */}
      {isAdmin ? (
        <>
          <h3 className="mt-5 text-xs font-medium uppercase tracking-[0.1em] text-fg-subtle">
            Invite someone
          </h3>
          <form
            action={(formData) => run(() => inviteMember(formData))}
            className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end"
          >
            <input type="hidden" name="workspaceId" value={workspace.id} />
            <div className="flex-1">
              <Input
                name="email"
                type="email"
                label="Email address"
                placeholder="colleague@example.com"
                required
                maxLength={254}
              />
            </div>
            <Select name="role" label="Role" labelHidden defaultValue="member" className="sm:w-32">
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </Select>
            <Button type="submit" variant="secondary" loading={pending}>
              Invite
            </Button>
          </form>

          {sent.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {sent.map((invitation) => (
                <li
                  key={invitation.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--tg-radius-md)] border border-border-subtle px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-fg-muted">{invitation.email}</p>
                    <p className="text-xs text-fg-subtle">
                      Invited as {invitation.role} · not accepted yet
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => run(() => revokeInvitation(invitation.id))}
                  >
                    Withdraw
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      {/* --- Workspace-level actions -------------------------------------- */}
      <div className="mt-5 border-t border-border-subtle pt-4">
        {isAdmin ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Input
                label="Workspace name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={120}
              />
            </div>
            <Button
              variant="secondary"
              disabled={pending || name.trim() === workspace.name}
              onClick={() => run(() => renameWorkspace(workspace.id, name))}
            >
              Rename
            </Button>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          {!isOwner ? (
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => run(() => leaveWorkspace(workspace.id))}
            >
              Leave workspace
            </Button>
          ) : confirmingDelete ? (
            <>
              <Button
                variant="danger"
                loading={pending}
                onClick={() => run(() => deleteWorkspace(workspace.id))}
              >
                Delete “{workspace.name}” and everything in it
              </Button>
              <Button variant="ghost" disabled={pending} onClick={() => setConfirmingDelete(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setConfirmingDelete(true)}>
              Delete workspace
            </Button>
          )}
        </div>

        {isOwner && confirmingDelete ? (
          <p className="mt-2 text-xs leading-relaxed text-fg-subtle">
            This removes every shared graph and shared connection in the workspace, for everyone in
            it. Members&apos; own private graphs are untouched.
          </p>
        ) : null}
      </div>
    </section>
  );
}
