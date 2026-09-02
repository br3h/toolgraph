'use client';

/**
 * Creating and editing a saved connection.
 *
 * Two things here are deliberate and worth not undoing:
 *
 * 1. The credential is a separate field, sent as a separate argument, written
 *    to a separate table by a separate client. There is no object in this file
 *    that holds both the connection and its secret, so there is no spread that
 *    could put one into the other.
 *
 * 2. When credential storage is not configured, the field is not shown as
 *    disabled — it is replaced by a sentence explaining that this deployment
 *    does not store credentials and that the header is typed per test instead.
 *    A greyed-out input reads as "coming soon"; this is a deployment fact.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { McpTransportType } from '@toolgraph/schema-core';
import { Alert, Button, Input, Modal, Select } from '@toolgraph/ui';

import { createConnection, updateConnection } from '@/app/connections/actions';
import type { SavedConnection } from '@/lib/connections/model';

export interface ConnectionDialogProps {
  open: boolean;
  onClose: () => void;
  /** Absent when creating. */
  connection?: SavedConnection | undefined;
  workspaces: readonly { id: string; name: string }[];
  credentialStorage: boolean;
}

export function ConnectionDialog({
  open,
  onClose,
  connection,
  workspaces,
  credentialStorage,
}: ConnectionDialogProps) {
  const router = useRouter();
  const editing = Boolean(connection);

  const [name, setName] = useState(connection?.name ?? '');
  const [transport, setTransport] = useState<McpTransportType>(connection?.transport ?? 'http');
  const [url, setUrl] = useState(connection?.url ?? '');
  const [command, setCommand] = useState(connection?.command ?? '');
  const [args, setArgs] = useState((connection?.args ?? []).join(' '));
  const [workspaceId, setWorkspaceId] = useState(connection?.workspaceId ?? '');
  const [credential, setCredential] = useState('');
  const [removeCredential, setRemoveCredential] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  // Reopening the dialog on a different row must not show the previous row's
  // values, and must never carry a typed credential across.
  useEffect(() => {
    if (!open) return;
    setName(connection?.name ?? '');
    setTransport(connection?.transport ?? 'http');
    setUrl(connection?.url ?? '');
    setCommand(connection?.command ?? '');
    setArgs((connection?.args ?? []).join(' '));
    setWorkspaceId(connection?.workspaceId ?? '');
    setCredential('');
    setRemoveCredential(false);
    setError(null);
    setWarning(null);
  }, [open, connection]);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    setWarning(null);

    const input = {
      name: name.trim(),
      transport,
      url: url.trim(),
      command: command.trim(),
      args: args
        .split(/\s+/)
        .map((part) => part.trim())
        .filter(Boolean),
      workspaceId: workspaceId || null,
    };

    try {
      const result = connection
        ? await updateConnection(connection.id, input, credential, removeCredential)
        : await createConnection(input, credential);

      if (!result.ok) {
        setError(result.error ?? 'That could not be saved.');
        return;
      }
      if (result.warning) {
        // Saved, but not entirely. Keep the dialog open so the message is read
        // rather than flashing past on the way to the list.
        setWarning(result.warning);
        router.refresh();
        return;
      }

      router.refresh();
      onClose();
    } finally {
      setBusy(false);
    }
  }, [
    args,
    command,
    connection,
    credential,
    name,
    onClose,
    removeCredential,
    router,
    transport,
    url,
    workspaceId,
  ]);

  const canSubmit =
    name.trim().length > 0 &&
    (transport === 'stdio' ? command.trim().length > 0 : url.trim().length > 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit connection' : 'Add a connection'}
      description="Toolgraph reads the server's tools and their real JSON Schemas when you test it."
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {warning ? 'Close' : 'Cancel'}
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            loading={busy}
            disabled={!canSubmit}
          >
            {editing ? 'Save' : 'Add connection'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {error ? (
          <Alert variant="error" title="Could not save">
            {error}
          </Alert>
        ) : null}
        {warning ? (
          <Alert variant="warning" title="Saved, with a caveat">
            {warning}
          </Alert>
        ) : null}

        <Input
          label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Production filesystem"
          maxLength={120}
          required
        />

        <Select
          label="Transport"
          value={transport}
          onChange={(event) => setTransport(event.target.value as McpTransportType)}
        >
          <option value="http">Streamable HTTP</option>
          <option value="sse">Server-sent events</option>
          <option value="stdio">stdio (local engine only)</option>
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

        {workspaces.length > 0 ? (
          <Select
            label="Shared with"
            value={workspaceId}
            onChange={(event) => setWorkspaceId(event.target.value)}
            hint={
              workspaceId
                ? 'Every member can use this connection. They never see its credential.'
                : 'Only you can see this connection.'
            }
          >
            <option value="">Just me</option>
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </Select>
        ) : null}

        {credentialStorage ? (
          <>
            <Input
              label="Authorization header"
              value={credential}
              onChange={(event) => setCredential(event.target.value)}
              placeholder={connection?.hasCredential ? 'Stored — type to replace' : 'Bearer ...'}
              type="password"
              autoComplete="off"
              disabled={removeCredential}
              hint="Encrypted before it is stored, and never sent back to a browser. Leave empty to keep the one already saved."
            />
            {connection?.hasCredential ? (
              <label className="flex items-center gap-2 text-sm text-fg-muted">
                <input
                  type="checkbox"
                  checked={removeCredential}
                  onChange={(event) => setRemoveCredential(event.target.checked)}
                  className="h-4 w-4"
                />
                Remove the stored credential
              </label>
            ) : null}
          </>
        ) : (
          <Alert variant="info" title="Credentials are not stored on this deployment">
            No encryption key is configured, so Toolgraph will not keep an authorization header. The
            connection still works — you type the header when you test it, it is used for that
            request, and it is dropped.
          </Alert>
        )}
      </div>
    </Modal>
  );
}
