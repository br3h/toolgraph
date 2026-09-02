/**
 * The shape of a saved connection, shared between server and client.
 *
 * Deliberately free of `server-only`: the list view is a client component and
 * needs these types. Nothing here can carry a secret — `hasCredential` is a
 * boolean and there is no field a ciphertext or a token could occupy, which is
 * the property that makes it safe to send this object to a browser.
 */

import type {
  McpServerConnection,
  McpToolDescriptor,
  McpTransportType,
} from '@toolgraph/schema-core';

/** Which template produced this connection. */
export type ConnectionProvider = 'mcp' | 'openapi';

/**
 * Health, as observed — never as hoped.
 *
 * `untested` is a real state and is NOT rendered as working. A connection that
 * has never been reached must not display a green dot, because the whole point
 * of the status is to answer "will this work when I run the graph".
 */
export type ConnectionStatus = 'untested' | 'connected' | 'failing';

export interface SavedConnection {
  id: string;
  name: string;
  provider: ConnectionProvider;
  transport: McpTransportType;
  url: string | null;
  command: string | null;
  args: string[];
  /** Null for a personal connection; set when it is shared with a workspace. */
  workspaceId: string | null;
  status: ConnectionStatus;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  /** Already sanitised server-side. Safe to render. */
  lastError: string | null;
  toolCount: number;
  /** Whether a credential is stored. Never the credential itself. */
  hasCredential: boolean;
  createdAt: string;
  updatedAt: string;
}

/** What the tool palette needs, without re-introspecting. */
export interface ConnectionWithTools extends SavedConnection {
  tools: McpToolDescriptor[];
}

/**
 * The subset the engine needs to dial the server.
 *
 * Converting explicitly rather than passing the row through is what guarantees
 * no health field, workspace id or credential flag is ever sent to the engine
 * or written into a graph document.
 */
export function toServerConnection(connection: SavedConnection): McpServerConnection {
  return {
    id: connection.id,
    name: connection.name,
    transport: connection.transport,
    ...(connection.url ? { url: connection.url } : {}),
    ...(connection.command ? { command: connection.command } : {}),
    ...(connection.args.length ? { args: connection.args } : {}),
  };
}

/** How a status reads to a person, and the one word next to the dot. */
export const STATUS_LABEL: Record<ConnectionStatus, string> = {
  untested: 'Never tested',
  connected: 'Connected',
  failing: 'Needs attention',
};

export const PROVIDER_LABEL: Record<ConnectionProvider, string> = {
  mcp: 'MCP server',
  openapi: 'OpenAPI',
};

export const TRANSPORT_LABEL: Record<McpTransportType, string> = {
  http: 'Streamable HTTP',
  sse: 'Server-sent events',
  stdio: 'stdio (local engine only)',
};
