'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import { Button } from '@toolgraph/ui';

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md text-center">
        <h1 className="text-lg font-semibold tracking-tight">Something went wrong</h1>
        <p className="mt-2 text-sm leading-relaxed text-fg-muted">
          This page hit an error it could not recover from on its own. Trying again often works; if
          it does not, the problem is on our side and has been reported.
        </p>

        {/* The digest is what makes a report traceable. The stack is not shown:
            it can name internal paths and is no use to the person reading it. */}
        {error.digest ? (
          <p className="mt-4 font-mono text-xs text-fg-subtle">Reference: {error.digest}</p>
        ) : null}

        <div className="mt-6 flex justify-center gap-2">
          <Button variant="primary" onClick={reset}>
            Try again
          </Button>
          <Button variant="secondary" onClick={() => window.location.assign('/graphs')}>
            Back to your graphs
          </Button>
        </div>
      </div>
    </div>
  );
}
