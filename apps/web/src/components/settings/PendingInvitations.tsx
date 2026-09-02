'use client';

import { useState, useTransition } from 'react';
import { Alert, Button } from '@toolgraph/ui';

import { acceptInvitation } from '@/app/settings/workspaces/actions';
import type { PendingInvitation } from '@/lib/workspaces/store';

/**
 * Invitations addressed to this account.
 *
 * The workspace NAME shown here comes from `public.pending_invitations()`, a
 * definer-rights function, because an invitee is not yet a member and so cannot
 * read `public.workspaces`. Without it this list could only offer a uuid.
 */
export function PendingInvitations({ invitations }: { invitations: PendingInvitation[] }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  return (
    <section className="rounded-[var(--tg-radius-lg)] border-2 border-border-strong bg-bg-raised p-5">
      <h2 className="text-sm font-semibold tracking-tight">
        {invitations.length === 1 ? 'You have an invitation' : 'You have invitations'}
      </h2>

      {error ? (
        <div className="mt-3">
          <Alert variant="error">{error}</Alert>
        </div>
      ) : null}

      <ul className="mt-4 space-y-2">
        {invitations.map((invitation) => (
          <li
            key={invitation.invitationId}
            className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--tg-radius-md)] border border-border px-3 py-2.5"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{invitation.workspaceName}</p>
              <p className="text-xs text-fg-subtle">
                As {invitation.role} · expires{' '}
                {new Date(invitation.expiresAt).toLocaleDateString('en-GB', { timeZone: 'UTC' })}
              </p>
            </div>
            <Button
              size="sm"
              variant="primary"
              loading={pending && busyId === invitation.invitationId}
              onClick={() => {
                setError(null);
                setBusyId(invitation.invitationId);
                startTransition(async () => {
                  const result = await acceptInvitation(invitation.workspaceId);
                  if (!result.ok) setError(result.error ?? 'That could not be accepted.');
                  setBusyId(null);
                });
              }}
            >
              Accept
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
