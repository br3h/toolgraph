import 'server-only';

/**
 * The three checks every mutating server action performs, in one place.
 *
 * They were previously copy-pasted into `auth/actions.ts` and `graphs/actions.ts`,
 * which is fine for two files and stops being fine at ten: the copies drift, and
 * the one that drifts is the one nobody re-reads.
 *
 * Order matters and is not arbitrary:
 *
 *   1. Origin, first, because it is free and it is the CSRF boundary.
 *   2. Authentication, second, so an anonymous flood is turned away before it
 *      can consume a rate-limit token belonging to a real user id.
 *   3. Rate limit, last, keyed by user id where there is one.
 */

import { headers } from 'next/headers';
import type { User } from '@supabase/supabase-js';

import { publicEnv } from '@/lib/public-env';
import { getCurrentUser } from '@/lib/supabase/server';
import { checkRateLimit, clientIp, type RateLimitSurface } from '@/lib/rate-limit';

/**
 * Reject a mutation whose Origin is not this site.
 *
 * Next's server actions carry their own same-origin protection; this is
 * deliberate belt-and-braces, because that protection is a moving target across
 * versions and an auth or billing mutation is where a regression would hurt
 * most.
 */
export async function checkOrigin(): Promise<string | null> {
  const headerList = await headers();
  const origin = headerList.get('origin');

  // A same-origin form post from a browser always sends Origin. Its absence in
  // production means something other than a browser form is calling this.
  if (!origin) {
    return process.env.NODE_ENV === 'production' ? 'This request could not be verified.' : null;
  }

  const allowed = new Set<string>();
  try {
    allowed.add(new URL(publicEnv.siteUrl).origin);
  } catch {
    /* a malformed configured URL contributes nothing */
  }

  const host = headerList.get('host');
  if (host) {
    allowed.add(`https://${host}`);
    if (process.env.NODE_ENV !== 'production') allowed.add(`http://${host}`);
  }

  // Vercel preview deployments have a per-deploy hostname.
  if (process.env.VERCEL_URL) allowed.add(`https://${process.env.VERCEL_URL}`);

  return allowed.has(origin) ? null : 'This request could not be verified.';
}

export interface GuardFailure {
  ok: false;
  error: string;
}

export interface GuardSuccess {
  ok: true;
  user: User;
}

export type GuardResult = GuardFailure | GuardSuccess;

/**
 * Origin + authentication + rate limit, in that order.
 *
 * Returns a discriminated union rather than throwing so a server action can
 * render the message inline. A failed guard must look like a form error, not
 * like a crash.
 */
export async function guardAction(surface: RateLimitSurface): Promise<GuardResult> {
  const originError = await checkOrigin();
  if (originError) return { ok: false, error: originError };

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Your session has expired. Sign in again.' };

  const verdict = await checkRateLimit(surface, `user:${user.id}`);
  if (!verdict.allowed) {
    return {
      ok: false,
      error: `That is more than we allow in one go. Try again in ${formatRetry(verdict.retryAfterSeconds)}.`,
    };
  }

  return { ok: true, user };
}

/** The same guard for an unauthenticated surface, keyed by address. */
export async function guardAnonymous(surface: RateLimitSurface): Promise<string | null> {
  const originError = await checkOrigin();
  if (originError) return originError;

  const verdict = await checkRateLimit(surface, `ip:${clientIp(await headers())}`);
  if (!verdict.allowed) {
    return `Too many attempts. Try again in ${formatRetry(verdict.retryAfterSeconds)}.`;
  }
  return null;
}

/** "45 seconds" / "3 minutes" — a duration somebody can act on, not a number. */
export function formatRetry(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}
