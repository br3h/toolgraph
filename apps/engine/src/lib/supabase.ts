/**
 * Supabase access over plain `fetch`.
 *
 * The engine deliberately does not depend on `@supabase/supabase-js`. It needs
 * exactly two things — verify a bearer token, and append a row to
 * `execution_runs` — and both are single REST calls. Keeping the dependency out
 * shrinks the cold-start bundle, which matters on Render's free plan where a
 * sleeping service pays that cost on the next request.
 */

import type { EngineConfig } from '../config';

/** How long to wait on Supabase before giving up. Auth must not stall a run. */
const SUPABASE_TIMEOUT_MS = 8_000;

export interface AuthenticatedUser {
  id: string;
  email?: string;
}

async function supabaseFetch(
  config: EngineConfig,
  path: string,
  init: RequestInit & { token?: string },
): Promise<Response> {
  if (!config.supabaseUrl || !config.supabaseSecretKey) {
    throw new Error('Supabase is not configured on this engine.');
  }

  const { token, headers, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUPABASE_TIMEOUT_MS);

  try {
    return await fetch(`${config.supabaseUrl}${path}`, {
      ...rest,
      signal: controller.signal,
      headers: {
        apikey: config.supabaseSecretKey,
        Authorization: `Bearer ${token ?? config.supabaseSecretKey}`,
        'Content-Type': 'application/json',
        ...headers,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve a bearer token to a user, or null if it is not valid.
 *
 * This asks Supabase rather than verifying the JWT locally on purpose: local
 * verification would need the project's signing secret held here, and would
 * keep honouring a token that had already been revoked.
 */
export async function verifyAccessToken(
  config: EngineConfig,
  token: string,
): Promise<AuthenticatedUser | null> {
  if (!token) return null;

  try {
    const res = await supabaseFetch(config, '/auth/v1/user', { method: 'GET', token });
    if (!res.ok) return null;

    const body: unknown = await res.json();
    if (!body || typeof body !== 'object') return null;

    const id = (body as { id?: unknown }).id;
    if (typeof id !== 'string' || id.length === 0) return null;

    const email = (body as { email?: unknown }).email;
    return typeof email === 'string' ? { id, email } : { id };
  } catch {
    // A network failure must not be mistaken for a valid token.
    return null;
  }
}

export interface ExecutionRunRecord {
  graphId: string;
  owner: string;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  startedAt: string;
  finishedAt?: string;
  stepCount: number;
  errorSummary?: string;
}

/**
 * Append a run to `execution_runs`.
 *
 * Best-effort by design: a failure to log must never fail the run the user is
 * actually waiting on. The caller logs the problem and moves on.
 */
export async function recordExecutionRun(
  config: EngineConfig,
  record: ExecutionRunRecord,
): Promise<{ ok: boolean; error?: string }> {
  if (!config.supabaseUrl || !config.supabaseSecretKey) {
    return { ok: false, error: 'supabase not configured' };
  }

  try {
    const res = await supabaseFetch(config, '/rest/v1/execution_runs', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        graph_id: record.graphId,
        owner: record.owner,
        status: record.status,
        started_at: record.startedAt,
        finished_at: record.finishedAt ?? null,
        step_count: record.stepCount,
        // The column is capped at 2000 characters; truncate rather than 400.
        error_summary: record.errorSummary ? record.errorSummary.slice(0, 2000) : null,
      }),
    });

    if (!res.ok) {
      return { ok: false, error: `supabase responded ${res.status}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'unknown error' };
  }
}

/** Pull the bearer token out of an Authorization header, if there is one. */
export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}
