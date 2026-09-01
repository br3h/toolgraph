'use client';

/**
 * The inline mismatch explanation.
 *
 * This is the moment the product exists for. Every other tool in this category
 * tells you "connection failed" and leaves you to work out why at runtime. Here
 * the user is told the field, the type it needs, and the type it was offered,
 * at the instant they drew the connection.
 *
 * So: never a generic message. Everything shown comes straight from the
 * compatibility issue the checker produced.
 */

import { useEffect } from 'react';
import { Alert, Button } from '@toolgraph/ui';

import type { GraphEditorState } from '@/hooks/useGraphEditor';

/** Long enough to read a couple of issues, short enough not to sit in the way. */
const AUTO_DISMISS_MS = 12_000;

export interface ConnectionIssuePanelProps {
  editor: GraphEditorState;
}

/** `/user/address/city` reads better as `user.address.city`. */
function readablePath(path: string): string {
  if (!path) return '';
  return path.replace(/^\//, '').split('/').join('.');
}

export function ConnectionIssuePanel({ editor }: ConnectionIssuePanelProps) {
  const rejection = editor.lastRejection;
  const { clearRejection } = editor;

  useEffect(() => {
    if (!rejection) return;
    const timer = setTimeout(clearRejection, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [rejection, clearRejection]);

  if (!rejection) return null;

  const errors = rejection.result.issues.filter((issue) => issue.severity === 'error');
  const warnings = rejection.result.issues.filter((issue) => issue.severity === 'warning');

  return (
    <div role="alert" aria-live="assertive" data-testid="connection-issue">
      <Alert
        variant="error"
        title={
          errors.length === 1
            ? 'That connection would not type-check'
            : `That connection has ${errors.length} type errors`
        }
        action={
          <Button size="sm" variant="ghost" onClick={clearRejection}>
            Dismiss
          </Button>
        }
      >
        <ul className="space-y-2">
          {errors.map((issue, index) => (
            <li key={`${issue.code}-${issue.path}-${index}`} className="text-sm leading-relaxed">
              <span className="text-fg">{issue.message}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-fg-muted">
                {issue.path ? (
                  <span>
                    at <code className="font-mono">{readablePath(issue.path)}</code>
                  </span>
                ) : null}
                <span>
                  expects <code className="font-mono text-fg">{issue.expected}</code>
                </span>
                <span>
                  got <code className="font-mono text-fg">{issue.actual}</code>
                </span>
              </span>
            </li>
          ))}
        </ul>

        {warnings.length > 0 ? (
          <div className="mt-3 border-t border-border-subtle pt-2">
            <p className="text-xs font-medium text-fg-muted">
              {warnings.length} thing{warnings.length === 1 ? '' : 's'} that could not be verified
            </p>
            <ul className="mt-1 space-y-1">
              {warnings.slice(0, 3).map((issue, index) => (
                <li key={`${issue.code}-${index}`} className="text-xs text-fg-muted">
                  {issue.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Alert>
    </div>
  );
}
