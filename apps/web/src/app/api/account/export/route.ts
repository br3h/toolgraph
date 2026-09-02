/**
 * `GET /api/account/export` — the caller's own data, as one JSON file.
 *
 * A GET rather than a POST because it is a download and browsers save those
 * properly. That makes it worth stating why it is nonetheless safe against
 * cross-site abuse: it is same-origin-checked below, it is rate limited, and —
 * decisively — it returns `application/json` with `Content-Disposition:
 * attachment` and no JSONP or callback parameter, so there is no shape in which
 * another origin could read the response even if it managed to issue the
 * request.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { getCurrentUser } from '@/lib/supabase/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { publicEnv } from '@/lib/public-env';
import { buildAccountExport } from '@/lib/account/export';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A top-level navigation (clicking a link) sends `Sec-Fetch-Site: same-origin`
 * and usually no `Origin`, so an Origin check alone would refuse the normal
 * case. Both headers are consulted, and a cross-site value from either is a
 * refusal.
 */
function sameOrigin(request: NextRequest): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return false;

  const origin = request.headers.get('origin');
  if (!origin) return true;

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

export async function GET(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json(
      { error: 'forbidden', message: 'This request could not be verified.' },
      { status: 403, headers: { 'cache-control': 'no-store' } },
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: 'unauthenticated', message: 'Sign in to export your data.' },
      { status: 401, headers: { 'cache-control': 'no-store' } },
    );
  }

  // Reads and serialises the whole account, so it is metered tightly.
  const verdict = await checkRateLimit('dataExport', `user:${user.id}`);
  if (!verdict.allowed) {
    return rateLimitResponse(
      verdict,
      'You have exported your data a few times in the last hour. Try again shortly.',
    );
  }

  const bundle = await buildAccountExport({
    id: user.id,
    email: user.email,
    created_at: user.created_at,
  });

  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(JSON.stringify(bundle, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="toolgraph-account-${stamp}.json"`,
      // A file containing somebody's whole account must not sit in a shared
      // cache, a CDN, or the browser's disk cache.
      'cache-control': 'no-store, max-age=0, must-revalidate',
      'x-content-type-options': 'nosniff',
    },
  });
}
