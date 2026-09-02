/**
 * `POST /api/run` — run a graph whose servers have stored credentials.
 *
 * The mirror of `/api/connections/test`, and it exists for the same reason: a
 * stored credential is decrypted on the server and must never reach a browser,
 * so a run that needs one cannot be started from the browser directly.
 *
 * A graph with no stored credentials still goes straight from the browser to
 * the engine. That path has no execution limit, which matters because the
 * engine sleeps on a free plan and a cold start plus a long run can exceed what
 * a serverless function is allowed. The split is not a preference — it is the
 * smallest surface on which the secret has to travel through here at all.
 *
 * The response is the engine's SSE stream, piped through unchanged. Piping
 * rather than buffering is what keeps per-step results arriving as they finish;
 * buffering would turn a live run into a long wait followed by everything at
 * once, which is the entire user-visible value of streaming.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { publicEnv } from '@/lib/public-env';
import { graphDocumentSchema } from '@/lib/graph-document';
import { getConnection, getCredentialForRequest } from '@/lib/connections/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The ceiling this route imposes and the direct path does not. Sixty seconds is
 * the platform maximum on the plans this project runs on; a run that needs
 * longer must use a connection without a stored credential, or a self-hosted
 * deployment. The UI says so rather than letting it look like a hang.
 */
export const maxDuration = 60;

const bodySchema = z.object({
  graphId: z.string().uuid(),
  document: graphDocumentSchema,
  /**
   * Ids of servers on the canvas that came from saved connections. Only these
   * are looked up — a server the user configured ad hoc has no stored
   * credential by definition.
   */
  connectionIds: z.array(z.string().uuid()).max(20).default([]),
});

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

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return fail('forbidden', 'This request could not be verified.', 403);
  }

  const user = await getCurrentUser();
  if (!user) return fail('unauthenticated', 'Sign in to run a graph.', 401);

  // The engine has its own per-user run limit; this one protects THIS function,
  // which is a distinct and more expensive resource (it holds a connection open
  // for the length of a run).
  const verdict = await checkRateLimit('connectionTest', `user:${user.id}`);
  if (!verdict.allowed) {
    return rateLimitResponse(verdict, 'You have started a lot of runs. Try again shortly.');
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail('invalid_request', 'That run request was not valid.', 400);

  /*
   * Resolve every stored credential the run needs.
   *
   * `getConnection` goes through the RLS-scoped client, so an id belonging to
   * somebody else simply does not resolve and contributes nothing — a caller
   * cannot borrow another account's credential by naming its connection id.
   * The id used as the secrets key is the connection's own id, which is also
   * the server id on the canvas (see `toServerConnection`).
   */
  const secrets: Record<string, { headers?: Record<string, string> }> = {};
  for (const connectionId of parsed.data.connectionIds) {
    const connection = await getConnection(connectionId);
    if (!connection) continue;

    const credential = await getCredentialForRequest(connectionId);
    if (credential?.kind === 'headers') {
      secrets[connectionId] = { headers: { Authorization: credential.value } };
    }
  }

  const supabase = await createClient();
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) return fail('unauthenticated', 'Your session has expired. Sign in again.', 401);

  // Aborting the upstream when the browser goes away matters here: without it,
  // a cancelled run keeps the engine busy for its full duration.
  const upstream = new AbortController();
  request.signal.addEventListener('abort', () => upstream.abort());

  let response: Response;
  try {
    response = await fetch(`${publicEnv.engineUrl}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        graphId: parsed.data.graphId,
        document: parsed.data.document,
        ...(Object.keys(secrets).length > 0 ? { secrets } : {}),
      }),
      signal: upstream.signal,
      cache: 'no-store',
    });
  } catch {
    return fail(
      'engine_unreachable',
      'The execution engine could not be reached. It sleeps after fifteen minutes of inactivity — try again in a moment.',
      502,
    );
  }

  if (!response.ok || !response.body) {
    const body: unknown = await response.json().catch(() => null);
    const message =
      body && typeof body === 'object' && body !== null && 'message' in body
        ? String((body as { message: unknown }).message)
        : `The engine responded ${response.status}.`;
    return fail('run_failed', message, response.status >= 500 ? 502 : response.status);
  }

  // Piped straight through. Nothing in the stream is inspected or rewritten —
  // and in particular nothing is logged, because a step's output can contain
  // whatever the user's tools returned.
  return new NextResponse(response.body, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      // Nginx and similar buffer proxied responses by default, which would
      // defeat the streaming this route exists to preserve.
      'x-accel-buffering': 'no',
    },
  });
}
