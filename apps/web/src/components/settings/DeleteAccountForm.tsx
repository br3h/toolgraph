'use client';

/**
 * The account deletion confirmation.
 *
 * The design rule here is that nobody should be able to do this by accident and
 * nobody should be surprised by what it took. So: the counts are shown before
 * the form, the word DELETE has to be typed, the password has to be re-entered,
 * and if the account owns a workspace other people are in, the button is not
 * offered at all — it is replaced by what has to happen first.
 */

import { useState, useTransition } from 'react';
import { Alert, Button, Input } from '@toolgraph/ui';

import { deleteAccountAction } from '@/app/settings/actions';
import type { DeletionPreview } from '@/lib/account/delete';

export interface DeleteAccountFormProps {
  preview: DeletionPreview;
  hasPassword: boolean;
  email: string;
}

function Count({ n, one, many }: { n: number; one: string; many: string }) {
  return (
    <li className="text-sm text-fg-muted">
      <span className="font-medium text-fg">{n}</span> {n === 1 ? one : many}
    </li>
  );
}

export function DeleteAccountForm({ preview, hasPassword, email }: DeleteAccountFormProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const blocked = preview.blockers.length > 0;

  return (
    <div className="space-y-4">
      <ul className="space-y-1">
        <Count n={preview.graphs} one="graph" many="graphs" />
        <Count
          n={preview.connections}
          one="connection and its stored credential"
          many="connections and their stored credentials"
        />
        <Count n={preview.runs} one="run record" many="run records" />
        {preview.workspacesDeleted.length > 0 ? (
          <li className="text-sm text-fg-muted">
            <span className="font-medium text-fg">{preview.workspacesDeleted.length}</span>{' '}
            {preview.workspacesDeleted.length === 1 ? 'workspace' : 'workspaces'} you are the only
            member of ({preview.workspacesDeleted.map((w) => w.name).join(', ')})
          </li>
        ) : null}
        {preview.workspacesLeft.length > 0 ? (
          <li className="text-sm text-fg-muted">
            You would leave {preview.workspacesLeft.length}{' '}
            {preview.workspacesLeft.length === 1 ? 'workspace' : 'workspaces'} (
            {preview.workspacesLeft.map((w) => w.name).join(', ')}). Their shared graphs stay.
          </li>
        ) : null}
      </ul>

      {blocked ? (
        <Alert variant="warning" title="Transfer or empty these workspaces first">
          <p>
            Deleting this account would delete{' '}
            {preview.blockers.map((b) => `“${b.workspaceName}”`).join(', ')} and every shared graph
            in {preview.blockers.length === 1 ? 'it' : 'them'} — which other people are relying on.
          </p>
          <p className="mt-2">
            Transfer ownership to another member, or remove the members, and this becomes available.
          </p>
        </Alert>
      ) : null}

      {!open ? (
        <Button variant="danger" onClick={() => setOpen(true)} disabled={blocked}>
          Delete account
        </Button>
      ) : (
        <form
          action={(formData) => {
            setError(null);
            startTransition(async () => {
              const result = await deleteAccountAction(formData);
              // A success redirects and never returns.
              if (result && !result.ok) setError(result.error ?? 'That did not work.');
            });
          }}
          className="space-y-3 border-t border-border-subtle pt-4"
        >
          {error ? <Alert variant="error">{error}</Alert> : null}

          {hasPassword ? (
            <>
              <Input
                name="password"
                type="password"
                label="Your password"
                autoComplete="current-password"
                required
                hint="A session on its own is not enough to delete an account."
              />
              <Input
                name="confirm"
                label="Type DELETE to confirm"
                autoComplete="off"
                placeholder="DELETE"
                required
              />
            </>
          ) : (
            <Input
              name="confirm"
              label="Type your email address to confirm"
              autoComplete="off"
              placeholder={email}
              required
              hint="This account signs in with GitHub, so there is no password to check."
            />
          )}

          <div className="flex gap-2">
            <Button type="submit" variant="danger" loading={pending}>
              Permanently delete
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
