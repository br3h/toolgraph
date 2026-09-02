'use client';

import { useState, useTransition } from 'react';
import { Alert, Button } from '@toolgraph/ui';

import { signOutEverywhere } from '@/app/settings/actions';

export function SignOutEverywhere() {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Two steps, because this signs the person out of the tab they are looking
  // at as well, and a single misplaced click doing that is annoying enough to
  // be worth one confirmation.
  if (!confirming) {
    return (
      <Button variant="secondary" onClick={() => setConfirming(true)}>
        Sign out everywhere
      </Button>
    );
  }

  return (
    <div className="space-y-3">
      {error ? <Alert variant="error">{error}</Alert> : null}
      <p className="text-sm text-fg-muted">
        This signs you out here too. You will need to sign in again.
      </p>
      <div className="flex gap-2">
        <Button
          variant="primary"
          loading={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await signOutEverywhere();
              // A successful call redirects and never returns; reaching here
              // means it failed.
              if (result && !result.ok) setError(result.error ?? 'That did not work.');
            })
          }
        >
          Yes, sign out everywhere
        </Button>
        <Button variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
