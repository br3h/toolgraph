import 'server-only';

/**
 * Per-IP rate limiting for the unauthenticated endpoints.
 *
 * Signup and login are the two routes an attacker can hit without an account,
 * which makes them the credential-stuffing surface. The per-user limits on
 * introspection and test-runs live in the engine; these blunt abuse before
 * there is a user to attribute it to.
 *
 * Falls back to an in-process limiter when Upstash is not configured, so a
 * contributor can run the app from `.env.example` alone. That fallback is
 * per-instance and forgets on restart — it exists for local development, not to
 * protect a deployment.
 */

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

import { hasUpstash, serverEnv } from './env';

export interface LimitVerdict {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

const WINDOW_MS = 60_000;

/** Deliberately tight: a human signing up does it once. */
export const AUTH_ATTEMPTS_PER_MINUTE = 8;

let redisLimiter: Ratelimit | null = null;

function getRedisLimiter(): Ratelimit | null {
  if (!hasUpstash()) return null;
  redisLimiter ??= new Ratelimit({
    redis: new Redis({ url: serverEnv.upstashUrl, token: serverEnv.upstashToken }),
    limiter: Ratelimit.slidingWindow(AUTH_ATTEMPTS_PER_MINUTE, '1 m'),
    prefix: 'toolgraph:auth',
    analytics: false,
  });
  return redisLimiter;
}

const memoryHits = new Map<string, number[]>();

function checkInMemory(key: string): LimitVerdict {
  const now = Date.now();
  const recent = (memoryHits.get(key) ?? []).filter((at) => at > now - WINDOW_MS);

  if (memoryHits.size > 10_000) memoryHits.clear();

  if (recent.length >= AUTH_ATTEMPTS_PER_MINUTE) {
    const oldest = recent[0] ?? now;
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000)),
    };
  }

  recent.push(now);
  memoryHits.set(key, recent);
  return {
    allowed: true,
    remaining: AUTH_ATTEMPTS_PER_MINUTE - recent.length,
    retryAfterSeconds: 0,
  };
}

export async function limitAuthAttempt(identifier: string): Promise<LimitVerdict> {
  const limiter = getRedisLimiter();
  if (!limiter) return checkInMemory(identifier);

  try {
    const result = await limiter.limit(identifier);
    return {
      allowed: result.success,
      remaining: result.remaining,
      retryAfterSeconds: Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)),
    };
  } catch {
    // Redis being down must not lock everyone out of signing in.
    return { allowed: true, remaining: AUTH_ATTEMPTS_PER_MINUTE, retryAfterSeconds: 0 };
  }
}

/**
 * Best-effort client address.
 *
 * Vercel sets `x-forwarded-for`; the leftmost entry is the client. This is
 * spoofable in general, which is why it is one control among several rather
 * than the only one.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return headers.get('x-real-ip') ?? 'unknown';
}
