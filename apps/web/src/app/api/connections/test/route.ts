/**
 * `POST /api/connections/test` — test a connection whose credential is stored.
 *
 * Why this exists at all, when the browser can already call the engine itself:
 * a stored credential is decrypted on the server and must never reach a
 * browser. So a connection that has one is tested HERE, with the plaintext
 * going straight from `getCredentialForRequest` into the engine request body
 * and nowhere else. A connection with no stored credential is tested directly
 * from the browser instead, which avoids this function's execution limit
 * entirely.
 *
 * That split is the whole design, and the trade it makes is explicit: the
 * proxied path is bounded by `maxDuration` below, and the engine sleeps on
 * Render's free plan and can take most of a minute to wake. A timeout is
 * therefore a real outcome, and it is reported as one — "the engine did not
 * wake in time, try again" — rather than as a failure of the user's server.
 *
 * This route forwards to the ENGINE rather than introspecting in-process, and
 * that is deliberate. The engine owns the SSRF guard, the transport timeouts
 * and the stdio refusal, and it is the only component that has ever opened a
 * socket to a user-supplied host. Reimplementing that here — even by importing
 * the same package — would create a second network egress path to keep in sync
 * with the first, and the one that falls behind is the one with the hole. The
 * credential travels the same way a browser-typed one already does: over TLS,
 * in the request body, to a service that never writes it down.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { publicEnv } from '@/lib/public-env';
import { getConnection, getCredentialForRequest, recordHealth } from '@/lib/connections/store';
import { toServerConnection } from '@/lib/connections/model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The engine's cold start is the reason for this number. Vercel allows up to 60
 * seconds on the plans this project runs on, and a sleeping Render instance
 * usually answers inside that.
 */
export const maxDuration = 60;

const bodySchema = z.object({ connectionId: z.string().uuid() });

const NO_STORE = { 'cache-control': 'no-store, max-age=0' } as const;

function fail(error: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error, message }, { status, headers: NO_STORE });
}

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return process.env.NODE_ENV !== 'production';

  const allowed = new Set<string>();
  try {
    allowed.add(new URL(publicEnv.siteUrl).origin);
  } catch {
    /* a malformed configured URL contributes nothing */
  }
  const host = request.headers.get('host');
  if (host) {
    allowed.add(`https://${host}`);
    if (process.env.NODE_ENV !== 'production') allowed.add(`http://${host}`);
  }
  if (process.env.VERCEL_URL) allowed.add(`https://${process.env.VERCEL_URL}`);
  return allowed.has(origin);
}

/** Collapse a sprawling upstream error into one line, with any markup stripped. */
function summarise(message: string): string {
  const firstLine = message.split('\n')[0] ?? message;
  const withoutMarkup = firstLine
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return withoutMarkup.length > 300 ? `${withoutMarkup.slice(0, 300)}…` : withoutMarkup;
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return fail('forbidden', 'This request could not be verified.', 403);
  }

  const user = await getCurrentUser();
  if (!user) return fail('unauthenticated', 'Sign in to test a connection.', 401);

  // Before anything that opens a socket to a third party.
  const verdict = await checkRateLimit('connectionTest', `user:${user.id}`);
  if (!verdict.allowed) {
    return rateLimitResponse(
      verdict,
      'You have tested a lot of connections in the last minute. Try again shortly.',
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail('invalid_request', 'That is not a connection id.', 400);

  // Through the RLS-scoped client. A connection the caller cannot see is simply
  // not found, which is also the answer for one that does not exist — there is
  // no id oracle here.
  const connection = await getConnection(parsed.data.connectionId);
  if (!connection) return fail('not_found', 'That connection could not be found.', 404);

  const credential = await getCredentialForRequest(connection.id);

  // The engine authenticates the caller with their own Supabase access token,
  // so a proxied test is still attributed to the user and still subject to the
  // engine's per-user limit. The web app deliberately does not hold a
  // privileged engine credential of its own — there is no key here that could
  // be used to make the engine act as somebody else.
  const supabase = await createClient();
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) {
    return fail('unauthenticated', 'Your session has expired. Sign in again.', 401);
  }

  // Bounded a little under `maxDuration`, so a slow engine produces our own
  // readable timeout rather than the platform killing the function mid-write.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), (maxDuration - 5) * 1000);

  try {
    const response = await fetch(`${publicEnv.engineUrl}/introspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        connection: toServerConnection(connection),
        // The decrypted credential's only destination. It is not logged here,
        // not returned below, and not included in any error path.
        ...(credential?.kind === 'headers'
          ? { secrets: { headers: { Authorization: credential.value } } }
          : {}),
      }),
      signal: controller.signal,
      cache: 'no-store',
    });

    const body: unknown = await response.json().catch(() => null);
    const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;

    if (!response.ok) {
      const message =
        typeof record?.message === 'string'
          ? summarise(record.message)
          : `The engine responded ${response.status}.`;
      await recordHealth(connection.id, { ok: false, error: message });
      // The engine's own 400 (a refused host) stays a 400; anything else it
      // could not do becomes a 502, so the two are distinguishable by a caller.
      return NextResponse.json(
        { ok: false, message },
        { status: response.status === 400 ? 400 : 502, headers: NO_STORE },
      );
    }

    const tools = Array.isArray(record?.tools) ? record.tools : [];
    await recordHealth(connection.id, { ok: true, tools: tools as never });

    // The tool COUNT goes back, never the schemas: the browser does not need
    // them here, and a response is one more place a large payload could be
    // logged or cached.
    return NextResponse.json(
      { ok: true, toolCount: tools.length },
      { status: 200, headers: NO_STORE },
    );
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    const message = aborted
      ? 'The execution engine did not wake in time. It sleeps after fifteen minutes of inactivity — try again in a moment and it will be warm.'
      : summarise(error instanceof Error ? error.message : 'Could not reach the execution engine.');

    await recordHealth(connection.id, { ok: false, error: message });
    return NextResponse.json({ ok: false, message }, { status: 502, headers: NO_STORE });
  } finally {
    clearTimeout(timer);
  }
}
