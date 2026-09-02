'use client';

/**
 * The connections list, and the test-and-delete actions on each row.
 *
 * Testing runs from the BROWSER against the engine, not from the server. That
 * is not an accident of where the code ended up: the browser holds the user's
 * Supabase access token, which is what the engine authenticates against, and
 * the engine can take the better part of a minute to wake on its free plan —
 * which is a progress state a page render cannot show. The outcome is then
 * posted back to a server action to be recorded.
 *
 * The consequence worth stating: the recorded health is client-asserted. It can
 * only ever be asserted about a connection the caller can already see, and the
 * worst a lie achieves is a wrong dot on their own dashboard. Nothing
 * downstream trusts it — every run re-introspects the server for real.
 */

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { McpToolDescriptor } from '@toolgraph/schema-core';
import { Alert, Badge, Button, Spinner } from '@toolgraph/ui';

import { deleteConnection, recordConnectionTest } from '@/app/connections/actions';
import { publicEnv } from '@/lib/public-env';
import { createClient } from '@/lib/supabase/client';
import {
  PROVIDER_LABEL,
  TRANSPORT_LABEL,
  toServerConnection,
  type SavedConnection,
} from '@/lib/connections/model';
import { ConnectionDialog } from './ConnectionDialog';
import { StatusDot } from './StatusDot';

/** After this long with no response, assume the engine is cold and say so. */
const COLD_START_HINT_MS = 3_000;

export interface ConnectionListProps {
  connections: SavedConnection[];
  workspaces: readonly { id: string; name: string }[];
  credentialStorage: boolean;
}

const RELATIVE = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' });

/** "3 hours ago" reads better than a timestamp for a health check. */
function ago(iso: string | null): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;

  const seconds = Math.round((then - Date.now()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 30],
    ['month', 12],
  ];

  let value = seconds;
  for (const [unit, size] of units) {
    if (Math.abs(value) < size) return RELATIVE.format(value, unit);
    value = Math.round(value / size);
  }
  return RELATIVE.format(value, 'year');
}

export function ConnectionList({
  connections,
  workspaces,
  credentialStorage,
}: ConnectionListProps) {
  const router = useRouter();
  const [editing, setEditing] = useState<SavedConnection | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [coldId, setColdId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const coldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const test = useCallback(
    async (connection: SavedConnection) => {
      setError(null);
      setTestingId(connection.id);
      setColdId(null);
      coldTimer.current = setTimeout(() => setColdId(connection.id), COLD_START_HINT_MS);

      try {
        /*
         * Two paths, and which one runs depends on whether a credential is
         * stored — not on convenience.
         *
         * WITH a credential: the server does it. Decrypting has to happen on
         * the server, and the plaintext must never reach this component, so the
         * whole introspection moves there. The cost is that it runs inside a
         * serverless function's time limit, which a cold engine can exceed.
         *
         * WITHOUT one: the browser calls the engine directly, as it always has.
         * There is no secret to protect, and this path has no execution limit,
         * so a sixty-second cold start is merely slow rather than fatal.
         */
        if (connection.hasCredential) {
          const response = await fetch('/api/connections/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ connectionId: connection.id }),
          });
          const body: unknown = await response.json().catch(() => null);
          const record =
            body && typeof body === 'object' ? (body as Record<string, unknown>) : null;

          if (!response.ok || record?.ok !== true) {
            setError(
              typeof record?.message === 'string'
                ? record.message
                : `That connection could not be tested (${response.status}).`,
            );
          }
          // Health is recorded by the route itself, so there is nothing to post
          // back — only the page to refresh.
          router.refresh();
          return;
        }

        const supabase = createClient();
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;

        if (!token) {
          setError('Your session has expired. Reload the page and sign in again.');
          return;
        }

        const response = await fetch(`${publicEnv.engineUrl}/introspect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          // No `secrets` field: this branch runs only when nothing is stored.
          body: JSON.stringify({ connection: toServerConnection(connection) }),
        });

        const body: unknown = await response.json().catch(() => null);

        if (!response.ok) {
          const message =
            body && typeof body === 'object' && 'message' in body
              ? String((body as { message: unknown }).message)
              : `The engine responded ${response.status}.`;
          await recordConnectionTest(connection.id, { ok: false, error: message });
          setError(message);
          router.refresh();
          return;
        }

        const tools =
          body && typeof body === 'object' && 'tools' in body
            ? ((body as { tools: McpToolDescriptor[] }).tools ?? [])
            : [];

        await recordConnectionTest(connection.id, { ok: true, tools });
        router.refresh();
      } catch (caught) {
        const message =
          caught instanceof Error
            ? `Could not reach the engine: ${caught.message}`
            : 'Could not reach the engine.';
        await recordConnectionTest(connection.id, { ok: false, error: message });
        setError(message);
        router.refresh();
      } finally {
        if (coldTimer.current) clearTimeout(coldTimer.current);
        setTestingId(null);
        setColdId(null);
      }
    },
    [router],
  );

  return (
    <div className="space-y-3">
      {error ? (
        <Alert variant="error" title="That connection did not answer">
          {error}
        </Alert>
      ) : null}

      {connections.map((connection) => {
        const workspace = workspaces.find((w) => w.id === connection.workspaceId);
        const testing = testingId === connection.id;

        return (
          <article
            key={connection.id}
            className="rounded-[var(--tg-radius-lg)] border border-border-subtle bg-bg-raised p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-sm font-semibold tracking-tight">
                    {connection.name}
                  </h2>
                  {workspace ? <Badge variant="subtle">{workspace.name}</Badge> : null}
                  {connection.hasCredential ? (
                    <Badge variant="subtle" title="A credential is stored, encrypted">
                      Authenticated
                    </Badge>
                  ) : null}
                </div>

                <p className="mt-1 truncate font-mono text-xs text-fg-subtle">
                  {connection.transport === 'stdio'
                    ? [connection.command, ...connection.args].join(' ')
                    : connection.url}
                </p>

                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <StatusDot status={connection.status} />
                  <span className="text-xs text-fg-subtle">
                    {PROVIDER_LABEL[connection.provider]} · {TRANSPORT_LABEL[connection.transport]}
                  </span>
                  {connection.toolCount > 0 ? (
                    <span className="text-xs text-fg-subtle">
                      {connection.toolCount} {connection.toolCount === 1 ? 'tool' : 'tools'}
                    </span>
                  ) : null}
                  {connection.lastSuccessAt ? (
                    <span className="text-xs text-fg-subtle">
                      last worked {ago(connection.lastSuccessAt)}
                    </span>
                  ) : null}
                </div>

                {connection.status === 'failing' && connection.lastError ? (
                  <p className="mt-2 rounded-[var(--tg-radius-md)] border border-border px-2.5 py-1.5 text-xs leading-relaxed text-fg-muted">
                    {connection.lastError}
                  </p>
                ) : null}

                {testing && coldId === connection.id ? (
                  <div className="mt-2 flex items-start gap-2.5 rounded-[var(--tg-radius-md)] border border-border p-2.5">
                    <Spinner size="sm" />
                    <p className="text-xs leading-relaxed text-fg-muted">
                      Waking up the execution engine. It runs on a free plan that sleeps after
                      fifteen minutes; the first request takes about a minute, later ones are fast.
                    </p>
                  </div>
                ) : null}
              </div>

              <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  loading={testing}
                  onClick={() => void test(connection)}
                >
                  Test
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(connection)}>
                  Edit
                </Button>
                {confirmingDelete === connection.id ? (
                  <>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={async () => {
                        await deleteConnection(connection.id);
                        setConfirmingDelete(null);
                        router.refresh();
                      }}
                    >
                      Really remove
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(null)}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmingDelete(connection.id)}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
          </article>
        );
      })}

      <ConnectionDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        connection={editing ?? undefined}
        workspaces={workspaces}
        credentialStorage={credentialStorage}
      />
    </div>
  );
}
