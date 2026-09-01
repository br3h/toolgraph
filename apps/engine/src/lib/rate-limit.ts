/**
 * Rate limiting, backed by Upstash Redis when it is configured.
 *
 * When it is not — a contributor running from `.env.example`, or CI — the engine
 * falls back to an in-process limiter. That is deliberately weaker: it is
 * per-instance and forgets everything on restart. It exists so the app is
 * usable without an Upstash account, not to protect a deployment. A deployed
 * engine always has Upstash configured, and `usingRedis` reports which is live
 * so `/health` can surface it.
 */

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

import type { EngineConfig } from '../config';
import { hasUpstash } from '../config';

export interface RateLimitVerdict {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Unix ms when the window resets. */
  reset: number;
}

export interface RateLimiter {
  check(key: string): Promise<RateLimitVerdict>;
  readonly usingRedis: boolean;
}

/** Introspection hits a third-party server, so it is the more expensive one. */
export const INTROSPECT_LIMIT = { tokens: 20, window: '1 m' } as const;
export const RUN_LIMIT = { tokens: 10, window: '1 m' } as const;

export function createRateLimiter(
  config: EngineConfig,
  name: string,
  limit: { tokens: number; window: string },
): RateLimiter {
  if (hasUpstash(config)) {
    const redis = new Redis({
      url: config.upstashUrl as string,
      token: config.upstashToken as string,
    });

    const limiter = new Ratelimit({
      redis,
      // Sliding window rather than fixed: a fixed window lets a caller spend a
      // full quota at the end of one window and again at the start of the next.
      limiter: Ratelimit.slidingWindow(limit.tokens, limit.window as `${number} m`),
      prefix: `toolgraph:${name}`,
      analytics: false,
    });

    return {
      usingRedis: true,
      async check(key: string): Promise<RateLimitVerdict> {
        try {
          const result = await limiter.limit(key);
          return {
            allowed: result.success,
            limit: result.limit,
            remaining: result.remaining,
            reset: result.reset,
          };
        } catch {
          // If Redis is unreachable, fail OPEN. The alternative locks every user
          // out of the product because a rate limiter had a bad minute, which is
          // a worse outcome than briefly unmetered traffic on a free tier.
          return { allowed: true, limit: limit.tokens, remaining: limit.tokens, reset: Date.now() };
        }
      },
    };
  }

  return createInMemoryLimiter(limit);
}

function parseWindowMs(window: string): number {
  const match = /^(\d+)\s*([smhd])$/.exec(window.trim());
  if (!match) return 60_000;
  const amount = Number(match[1]);
  switch (match[2]) {
    case 's':
      return amount * 1_000;
    case 'm':
      return amount * 60_000;
    case 'h':
      return amount * 3_600_000;
    case 'd':
      return amount * 86_400_000;
    default:
      return 60_000;
  }
}

function createInMemoryLimiter(limit: { tokens: number; window: string }): RateLimiter {
  const windowMs = parseWindowMs(limit.window);
  const hits = new Map<string, number[]>();

  return {
    usingRedis: false,
    async check(key: string): Promise<RateLimitVerdict> {
      const now = Date.now();
      const cutoff = now - windowMs;

      const recent = (hits.get(key) ?? []).filter((at) => at > cutoff);

      // Bound the map so a flood of distinct keys cannot grow it without limit.
      if (hits.size > 10_000) hits.clear();

      if (recent.length >= limit.tokens) {
        return {
          allowed: false,
          limit: limit.tokens,
          remaining: 0,
          reset: (recent[0] ?? now) + windowMs,
        };
      }

      recent.push(now);
      hits.set(key, recent);

      return {
        allowed: true,
        limit: limit.tokens,
        remaining: limit.tokens - recent.length,
        reset: now + windowMs,
      };
    },
  };
}
