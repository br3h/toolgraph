/**
 * `GET /api/billing/status` — the caller's own subscription state.
 *
 * The billing panel polls this after a submission that came back pending, so
 * the answer must never be cached: a stale "pending" would be indistinguishable
 * from a real one, and a stale "active" would be a lie.
 *
 * There is no same-origin check here on purpose. This route changes nothing and
 * spends nothing, and the session cookie is `SameSite=lax`, so a cross-site
 * fetch carries no session and sees an unauthenticated caller regardless.
 */

import { NextResponse } from 'next/server';

import { getCurrentUser } from '@/lib/supabase/server';
import { getSubscriptionState } from '@/lib/billing/subscription';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' } as const;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: 'unauthenticated', message: 'Sign in to see your subscription.' },
      { status: 401, headers: NO_STORE },
    );
  }

  try {
    const state = await getSubscriptionState(user.id);
    return NextResponse.json(state, { status: 200, headers: NO_STORE });
  } catch (error) {
    console.error(
      `billing: subscription state could not be read: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
    return NextResponse.json(
      { error: 'server_error', message: 'Your subscription status could not be loaded.' },
      { status: 500, headers: NO_STORE },
    );
  }
}
