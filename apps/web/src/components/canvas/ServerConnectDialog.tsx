'use client';

/**
 * Connecting an MCP server.
 *
 * Two things here are deliberate and worth not undoing:
 *
 * 1. The auth header the user types is held in component state, sent with the
 *    request, and then dropped. It is never written into the graph document and
 *    never persisted — the `mcp_server_connections` table has no column for it.
 * 2. The engine sleeps on Render's free plan, so a first connection can take
 *    the better part of a minute. Without saying so, that reads as broken.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  McpServerConnection,
  McpToolDescriptor,
  McpTransportType,
} from '@toolgraph/schema-core';
import { Alert, Button, Input, Modal, Select, Spinner } from '@toolgraph/ui';

import { publicEnv } from '@/lib/public-env';
import { createClient } from '@/lib/supabase/client';
import type { GraphEditorState } from '@/hooks/useGraphEditor';

/** After this long with no response, assume the engine is cold and say so. */
const COLD_START_HINT_MS = 3_000;

export interface ServerConnectDialogProps {
  editor: GraphEditorState;
  open: boolean;
  onClose: () => void;
}

function makeServerId(): string {
  return `srv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ServerConnectDialog({ editor, open, onClose }: ServerConnectDialogProps) {
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<McpTransportType>('http');
  const [url, setUrl] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [authHeader, setAuthHeader] = useState('');

  const [busy, setBusy] = useState(false);
  const [cold, setCold] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const coldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) {
      setError(null);
      setBusy(false);
      setCold(false);
    }
  }, [open]);

  useEffect(
    () => () => {
      if (coldTimer.current) clearTimeout(coldTimer.current);
    },
    [],
  );

  const submit = useCallback(async () => {
    setError(null);
    setBusy(true);
    setCold(false);

    coldTimer.current = setTimeout(() => setCold(true), COLD_START_HINT_MS);

    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      if (!token) {
        setError('Your session has expired. Reload the page and sign in again.');
        return;
      }

      const connection: McpServerConnection = {
        id: makeServerId(),
        name: name.trim() || url.trim() || command.trim() || 'MCP server',
        transport,
        ...(transport === 'stdio'
          ? {
              command: command.trim(),
              args: args
                .split(/\s+/)
                .map((part) => part.trim())
                .filter(Boolean),
            }
          : { url: url.trim() }),
      };

      const response = await fetch(`${publicEnv.engineUrl}/introspect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          connection,
          // Sent, used for this request, and then gone.
          ...(authHeader.trim()
            ? { secrets: { headers: { Authorization: authHeader.trim() } } }
            : {}),
        }),
      });

      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const message =
          body && typeof body === 'object' && 'message' in body
            ? String((body as { message: unknown }).message)
            : `The engine responded ${response.status}.`;
        setError(message);
        return;
      }

      const tools =
        body && typeof body === 'object' && 'tools' in body
          ? ((body as { tools: McpToolDescriptor[] }).tools ?? [])
          : [];

      if (tools.length === 0) {
        setError('That server connected but advertises no tools.');
        return;
      }

      editor.addServer(connection, tools);

      setName('');
      setUrl('');
      setCommand('');
      setArgs('');
      setAuthHeader('');
      onClose();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? `Could not reach the engine: ${caught.message}`
          : 'Could not reach the engine.',
      );
    } finally {
      if (coldTimer.current) clearTimeout(coldTimer.current);
      setBusy(false);
      setCold(false);
    }
  }, [args, authHeader, command, editor, name, onClose, transport, url]);

  const canSubmit = transport === 'stdio' ? command.trim().length > 0 : url.trim().length > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Connect an MCP server"
      description="toolgraph reads the server's tools and their real JSON Schemas."
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            loading={busy}
            disabled={!canSubmit}
          >
            Connect
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {error ? (
          <Alert variant="error" title="Could not connect">
            {error}
          </Alert>
        ) : null}

        {busy && cold ? (
          <div className="flex items-start gap-3 rounded-[var(--tg-radius-md)] border border-border p-3">
            <Spinner size="sm" />
            <div>
              <p className="text-sm font-medium text-fg">Waking up the execution engine</p>
              <p className="mt-0.5 text-xs text-fg-muted">
                The engine runs on a free plan that sleeps after fifteen minutes of inactivity. The
                first request takes about a minute; later ones are fast.
              </p>
            </div>
          </div>
        ) : null}

        <Input
          label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="My server"
          maxLength={120}
        />

        <Select
          label="Transport"
          value={transport}
          onChange={(event) => setTransport(event.target.value as McpTransportType)}
        >
          <option value="http">Streamable HTTP</option>
          <option value="sse">Server-sent events</option>
          <option value="stdio">stdio (local development only)</option>
        </Select>

        {transport === 'stdio' ? (
          <>
            <Input
              label="Command"
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              placeholder="npx"
            />
            <Input
              label="Arguments"
              value={args}
              onChange={(event) => setArgs(event.target.value)}
              placeholder="-y @modelcontextprotocol/server-filesystem /tmp"
              hint="Separated by spaces."
            />
            <Alert variant="info" title="stdio needs a local engine">
              A hosted engine refuses stdio servers, because it would mean spawning arbitrary
              processes on a shared machine. Run the engine locally to use this transport.
            </Alert>
          </>
        ) : (
          <Input
            label="Server URL"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com/mcp"
            hint="Must be reachable over the public internet."
          />
        )}

        <Input
          label="Authorization header"
          value={authHeader}
          onChange={(event) => setAuthHeader(event.target.value)}
          placeholder="Bearer ..."
          type="password"
          autoComplete="off"
          hint="Used for this connection only. It is never saved with the graph or stored in the database."
        />
      </div>
    </Modal>
  );
}
