import 'server-only';

/**
 * Reading and writing saved connections.
 *
 * The split between the two Supabase clients here is the security boundary, and
 * it is worth stating plainly:
 *
 *   * Everything about the CONNECTION goes through the RLS-scoped client, so
 *     Postgres decides what the caller may see and change. There is no
 *     `.eq('owner', user.id)` anywhere below, because a filter that looks like a
 *     permission check is the thing that eventually gets forgotten.
 *
 *   * Everything about the CREDENTIAL goes through the admin client, because
 *     `connection_secrets` is granted to `service_role` alone. That client
 *     bypasses RLS, so every call to it in this file is preceded by an
 *     ownership check performed with the scoped client — never by a filter
 *     built from user input.
 *
 * The plaintext of a credential leaves this module in exactly one direction:
 * into an engine request. It is never returned to a caller that could render
 * it, and there is no exported function that would let one.
 */

import type { McpToolDescriptor } from '@toolgraph/schema-core';

import { createAdminClient, createClient } from '@/lib/supabase/server';
import { credentialStorageConfigured, decryptCredential, encryptCredential } from '@/lib/crypto';
import type { ConnectionProvider, ConnectionStatus, SavedConnection } from './model';

/* -------------------------------------------------------------------------- */
/* Row mapping                                                                 */
/* -------------------------------------------------------------------------- */

/** The columns every read selects. Never `*`: a new column must be opted into. */
const COLUMNS =
  'id, name, provider, transport, url, command, args, workspace_id, status, ' +
  'last_checked_at, last_success_at, last_error, tool_count, has_credential, created_at, updated_at';

interface ConnectionRow {
  id: string;
  name: string;
  provider: string;
  transport: string;
  url: string | null;
  command: string | null;
  args: string[] | null;
  workspace_id: string | null;
  status: string;
  last_checked_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  tool_count: number;
  has_credential: boolean;
  created_at: string;
  updated_at: string;
}

function isStatus(value: string): value is ConnectionStatus {
  return value === 'untested' || value === 'connected' || value === 'failing';
}

function isProvider(value: string): value is ConnectionProvider {
  return value === 'mcp' || value === 'openapi';
}

function toConnection(row: ConnectionRow): SavedConnection {
  return {
    id: row.id,
    name: row.name,
    // A value outside the union means the database has a row this build does
    // not understand — a rolled-back deploy, say. Degrading to the generic
    // provider keeps the page rendering instead of throwing on one bad row.
    provider: isProvider(row.provider) ? row.provider : 'mcp',
    transport: row.transport === 'stdio' || row.transport === 'sse' ? row.transport : 'http',
    url: row.url,
    command: row.command,
    args: row.args ?? [],
    workspaceId: row.workspace_id,
    status: isStatus(row.status) ? row.status : 'untested',
    lastCheckedAt: row.last_checked_at,
    lastSuccessAt: row.last_success_at,
    lastError: row.last_error,
    toolCount: row.tool_count,
    hasCredential: row.has_credential,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Every connection the caller can use: their own, plus every workspace they are
 * a member of. RLS produces that set; this function does not filter.
 */
export async function listConnections(): Promise<SavedConnection[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('mcp_server_connections')
    .select(COLUMNS)
    .order('updated_at', { ascending: false })
    .limit(200);

  if (error || !data) return [];
  return (data as unknown as ConnectionRow[]).map(toConnection);
}

export async function getConnection(id: string): Promise<SavedConnection | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('mcp_server_connections')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;
  return toConnection(data as unknown as ConnectionRow);
}

/**
 * The cached tool schemas for one connection.
 *
 * Read through the SCOPED client, so a caller who cannot see the connection
 * cannot see its tools either. Returns [] rather than throwing when the cache
 * is empty or stale-shaped — the palette shows "test this connection" in that
 * case, which is the honest state.
 */
export async function getCachedTools(id: string): Promise<McpToolDescriptor[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('mcp_server_connections')
    .select('tools_cache')
    .eq('id', id)
    .maybeSingle();

  if (error || !data?.tools_cache) return [];
  const cache = data.tools_cache;
  return Array.isArray(cache) ? (cache as McpToolDescriptor[]) : [];
}

/* -------------------------------------------------------------------------- */
/* Ownership                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Prove the caller may act on this connection, using RLS rather than a filter.
 *
 * Every admin-client call below is gated on this. It returns the row (not a
 * boolean) so a caller cannot accidentally proceed with an id it did not
 * actually resolve.
 */
async function assertCanUse(id: string): Promise<SavedConnection> {
  const connection = await getConnection(id);
  if (!connection) {
    // Deliberately the same message whether the row does not exist or belongs
    // to somebody else: distinguishing them turns this into an id oracle.
    throw new Error('That connection could not be found.');
  }
  return connection;
}

/* -------------------------------------------------------------------------- */
/* Credentials                                                                 */
/* -------------------------------------------------------------------------- */

export type CredentialKind = 'headers' | 'env';

/**
 * Store (or replace) a connection's credential.
 *
 * `value` is the raw header value, e.g. `Bearer sk-...`. It is encrypted before
 * it reaches the database and is not logged, not returned, and not echoed in an
 * error message.
 */
export async function setCredential(
  connectionId: string,
  kind: CredentialKind,
  value: string,
): Promise<void> {
  await assertCanUse(connectionId);

  if (!credentialStorageConfigured()) {
    throw new Error(
      'Credential storage is not configured on this deployment, so this value cannot be saved.',
    );
  }

  const ciphertext = encryptCredential(connectionId, value);
  const admin = createAdminClient();

  const { error } = await admin
    .from('connection_secrets')
    .upsert({ connection_id: connectionId, kind, ciphertext }, { onConflict: 'connection_id' });

  // The message is generic on purpose: a Postgres error string here could
  // contain the row it failed on.
  if (error) throw new Error('That credential could not be saved.');
}

export async function clearCredential(connectionId: string): Promise<void> {
  await assertCanUse(connectionId);
  const admin = createAdminClient();
  await admin.from('connection_secrets').delete().eq('connection_id', connectionId);
}

/**
 * The decrypted credential, for one outbound engine request.
 *
 * The ONLY function in the codebase that returns plaintext, and it is not
 * exported beyond the server. Callers must pass the result straight into a
 * request body and must never put it in a response, a log line or a thrown
 * error.
 */
export async function getCredentialForRequest(
  connectionId: string,
): Promise<{ kind: CredentialKind; value: string } | null> {
  await assertCanUse(connectionId);

  if (!credentialStorageConfigured()) return null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('connection_secrets')
    .select('kind, ciphertext')
    .eq('connection_id', connectionId)
    .maybeSingle();

  if (error || !data) return null;

  try {
    return {
      kind: data.kind === 'env' ? 'env' : 'headers',
      value: decryptCredential(connectionId, data.ciphertext as string),
    };
  } catch {
    // A row that will not decrypt means the key was rotated without a
    // migration. Treat it as absent: the user is told the connection needs
    // reconnecting, which is true and actionable.
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Health                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Record the outcome of a connection test.
 *
 * Written through the SCOPED client so a caller can only ever update health on
 * a connection they can already see — there is no path here that needs to
 * bypass RLS, so none is used.
 *
 * `tools` is cached for the palette. It is capped and the error is truncated
 * because both land in a row that the database bounds anyway; failing the write
 * on a 3000-character upstream error would lose the health update entirely.
 */
export async function recordHealth(
  connectionId: string,
  outcome: { ok: true; tools: McpToolDescriptor[] } | { ok: false; error: string },
): Promise<void> {
  const supabase = await createClient();
  const now = new Date().toISOString();

  const patch = outcome.ok
    ? {
        status: 'connected' as const,
        last_checked_at: now,
        last_success_at: now,
        last_error: null,
        tools_cache: outcome.tools,
        tool_count: outcome.tools.length,
      }
    : {
        status: 'failing' as const,
        last_checked_at: now,
        last_error: outcome.error.slice(0, 500),
      };

  await supabase.from('mcp_server_connections').update(patch).eq('id', connectionId);
}
