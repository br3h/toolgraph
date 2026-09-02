/**
 * Rate limiting.
 *
 * The in-process limiter is what these exercise, because that is what CI and a
 * contributor's machine actually run — Upstash is not configured in either. The
 * behaviour under test is the same either way: the policy table decides the
 * numbers, surfaces do not share buckets, and a refusal carries something the
 * caller can act on.
 *
 * The `failing open` behaviour of the Redis path is deliberately NOT tested by
 * stubbing Redis to throw, because that would test the stub. It is asserted in
 * the module's own comment and would be caught by the integration environment.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  POLICIES,
  __resetInMemoryLimits,
  checkRateLimit,
  clientIp,
  limitAuthAttempt,
  rateLimitResponse,
  type RateLimitSurface,
} from './rate-limit';

beforeEach(() => {
  __resetInMemoryLimits();
  vi.useRealTimers();
});

describe('the policy table', () => {
  it('gives every surface a positive limit, a window and a stated reason', () => {
    for (const [name, policy] of Object.entries(POLICIES)) {
      expect(policy.limit, `${name}.limit`).toBeGreaterThan(0);
      expect(policy.windowSeconds, `${name}.windowSeconds`).toBeGreaterThan(0);
      // The reason field exists so the next person to change a number knows why
      // it is what it is. An empty one defeats the point of having it.
      expect(policy.reason.length, `${name}.reason`).toBeGreaterThan(20);
    }
  });

  it('does not give every surface the same number', () => {
    // The specific failure this guards against is somebody "simplifying" the
    // table into one global limit, which would have to be set for the most
    // expensive surface and would then be useless against credential stuffing.
    const limits = new Set(Object.values(POLICIES).map((policy) => policy.limit));
    expect(limits.size).toBeGreaterThan(3);
  });

  it('keeps destructive and export surfaces tighter than ordinary writes', () => {
    expect(POLICIES.destructive.limit).toBeLessThan(POLICIES.connectionWrite.limit);
    expect(POLICIES.dataExport.limit).toBeLessThan(POLICIES.export.limit);
    // An hour-long window on the surfaces where a burst is the wrong shape to
    // look for.
    expect(POLICIES.destructive.windowSeconds).toBeGreaterThanOrEqual(3600);
    expect(POLICIES.invite.windowSeconds).toBeGreaterThanOrEqual(3600);
  });
});

describe('checkRateLimit', () => {
  it('allows exactly the policy limit and then refuses', async () => {
    const surface: RateLimitSurface = 'export';
    const limit = POLICIES[surface].limit;

    for (let attempt = 1; attempt <= limit; attempt += 1) {
      const verdict = await checkRateLimit(surface, 'user:a');
      expect(verdict.allowed, `attempt ${attempt} of ${limit}`).toBe(true);
      expect(verdict.remaining).toBe(limit - attempt);
    }

    const refused = await checkRateLimit(surface, 'user:a');
    expect(refused.allowed).toBe(false);
    expect(refused.remaining).toBe(0);
  });

  it('gives a refusal a retry-after a caller can act on', async () => {
    const surface: RateLimitSurface = 'billingSubmit';
    for (let i = 0; i < POLICIES[surface].limit; i += 1) {
      await checkRateLimit(surface, 'user:b');
    }

    const refused = await checkRateLimit(surface, 'user:b');
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(POLICIES[surface].windowSeconds);
  });

  it('keeps identifiers apart', async () => {
    const surface: RateLimitSurface = 'export';
    for (let i = 0; i < POLICIES[surface].limit; i += 1) {
      await checkRateLimit(surface, 'user:one');
    }

    expect((await checkRateLimit(surface, 'user:one')).allowed).toBe(false);
    // One account exhausting its quota must not lock out everybody else.
    expect((await checkRateLimit(surface, 'user:two')).allowed).toBe(true);
  });

  it('keeps surfaces apart', async () => {
    const surface: RateLimitSurface = 'billingSubmit';
    for (let i = 0; i < POLICIES[surface].limit; i += 1) {
      await checkRateLimit(surface, 'user:c');
    }

    expect((await checkRateLimit(surface, 'user:c')).allowed).toBe(false);
    // The whole point of a per-surface table: spending the payment quota must
    // not stop the same user signing in or exporting.
    expect((await checkRateLimit('export', 'user:c')).allowed).toBe(true);
    expect((await checkRateLimit('auth', 'user:c')).allowed).toBe(true);
  });

  it('lets a caller through again once the window has passed', async () => {
    vi.useFakeTimers();
    const surface: RateLimitSurface = 'auth';

    for (let i = 0; i < POLICIES[surface].limit; i += 1) {
      await checkRateLimit(surface, 'user:d');
    }
    expect((await checkRateLimit(surface, 'user:d')).allowed).toBe(false);

    vi.advanceTimersByTime(POLICIES[surface].windowSeconds * 1000 + 1000);

    // A limiter that never forgets is a ban, not a rate limit.
    expect((await checkRateLimit(surface, 'user:d')).allowed).toBe(true);
    vi.useRealTimers();
  });

  it('bounds its own memory rather than growing without limit', async () => {
    // A flood of distinct keys — an unauthenticated surface keyed by spoofed
    // address — must not be able to grow the map until the process dies.
    for (let i = 0; i < 10_050; i += 1) {
      await checkRateLimit('auth', `ip:10.0.0.${i}`);
    }
    // Still answering, and still enforcing for a fresh key.
    expect((await checkRateLimit('auth', 'ip:fresh')).allowed).toBe(true);
  });
});

describe('limitAuthAttempt', () => {
  it('is the auth surface, so the two share a bucket', async () => {
    for (let i = 0; i < POLICIES.auth.limit; i += 1) {
      await limitAuthAttempt('email:someone@example.com');
    }
    // The wrapper predates the policy table; it must not be a second, separate
    // allowance that doubles the real limit.
    const refused = await checkRateLimit('auth', 'email:someone@example.com');
    expect(refused.allowed).toBe(false);
  });
});

describe('rateLimitResponse', () => {
  it('carries Retry-After and the rate-limit headers, and is not cached', async () => {
    const response = rateLimitResponse(
      { allowed: false, limit: 5, remaining: 0, retryAfterSeconds: 42 },
      'Slow down.',
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('42');
    expect(response.headers.get('x-ratelimit-limit')).toBe('5');
    expect(response.headers.get('x-ratelimit-remaining')).toBe('0');
    // A cached 429 would keep refusing after the window had passed.
    expect(response.headers.get('cache-control')).toContain('no-store');

    const body = (await response.json()) as { error: string; message: string };
    expect(body.error).toBe('rate_limited');
    expect(body.message).toBe('Slow down.');
  });

  it('never emits a Retry-After of zero', () => {
    // Zero means "retry now", which sends a client straight back into the wall.
    const response = rateLimitResponse(
      { allowed: false, limit: 5, remaining: 0, retryAfterSeconds: 0 },
      'Slow down.',
    );
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('clientIp', () => {
  it('takes the leftmost x-forwarded-for entry', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.9, 70.41.3.18, 150.172.238.178' });
    expect(clientIp(headers)).toBe('203.0.113.9');
  });

  it('falls back to x-real-ip, then to a constant', () => {
    expect(clientIp(new Headers({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4');
    // Never undefined: an unkeyed limiter is no limiter.
    expect(clientIp(new Headers())).toBe('unknown');
  });
});
