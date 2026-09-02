import 'server-only';

/**
 * Rate limiting for the web app.
 *
 * Every surface an attacker or a runaway script can reach gets its OWN policy,
 * because the surfaces differ in what abuse costs. Signing in wrongly costs a
 * bcrypt round; importing an OpenAPI document costs a fetch to somewhere else
 * plus a parse; exporting a graph costs a synchronous TypeScript compile. One
 * global number would have to be set for the most expensive of those and would
 * then be useless against credential stuffing.
 *
 * The policies are declared in one table (`POLICIES`) so the whole abuse
 * surface is readable at a glance, and so adding an endpoint without deciding
 * its limit is an obvious omission rather than an invisible one.
 *
 * Backed by Upstash Redis when it is configured. When it is not — a contributor
 * running from `.env.example`, or CI — it falls back to an in-process limiter
 * that is per-instance and forgets on restart. That fallback exists so the app
 * is usable without an Upstash account, not to protect a deployment.
 */

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

import { hasUpstash, serverEnv } from './env';

/* -------------------------------------------------------------------------- */
/* The policy table                                                            */
/* -------------------------------------------------------------------------- */

export interface RateLimitPolicy {
  /** Requests allowed inside `windowSeconds`. */
  limit: number;
  windowSeconds: number;
  /** Why this number, in one line. Read by whoever changes it next. */
  reason: string;
}

/**
 * Keys are surfaces, not routes: two routes that cost the same and are abused
 * the same way share one.
 */
export const POLICIES = {
  /** Sign-in, sign-up, password reset. The credential-stuffing surface. */
  auth: {
    limit: 8,
    windowSeconds: 60,
    reason: 'A human signs in once. Eight a minute leaves room for typos and nothing else.',
  },

  /** Starting an OAuth flow. Cheap for us, but a redirect generator is a phishing lure. */
  oauthStart: {
    limit: 12,
    windowSeconds: 60,
    reason: 'Higher than auth because a legitimate retry after a provider error is common.',
  },

  /**
   * Reaching out to a user-supplied server to see what it advertises. Costs a
   * DNS resolution, a TLS handshake and a request to a third party, so this is
   * also the surface that could be used to make Toolgraph scan someone else.
   * The SSRF guard stops it reaching private space; this stops it being a
   * high-volume public scanner.
   */
  connectionTest: {
    limit: 10,
    windowSeconds: 60,
    reason: 'Each attempt is an outbound request to a third party on the user’s behalf.',
  },

  /** Writing a connection, and the credential attached to it. */
  connectionWrite: {
    limit: 30,
    windowSeconds: 60,
    reason: 'Ordinary CRUD, but it writes ciphertext, so it is not left unmetered.',
  },

  /**
   * Code generation. Synchronous, CPU-bound, and proportional to the size of
   * the schemas in the graph — the most expensive thing an authenticated user
   * can ask a web dyno to do. This one had no limit at all before.
   */
  export: {
    limit: 12,
    windowSeconds: 60,
    reason: 'A synchronous TypeScript/Python compile. CPU-bound and unbounded without this.',
  },

  /** Filing a payment claim. Each one hits a chain RPC. */
  billingSubmit: {
    limit: 6,
    windowSeconds: 60,
    reason: 'Each claim costs a chain RPC call, and legitimate use is a handful a year.',
  },

  /**
   * Sending an invitation puts mail in somebody else's inbox with our name on
   * it, so the limit protects a third party rather than us. Windowed over an
   * hour: the burst shape that matters is "one workspace mailing a list", not
   * "three invites in one minute".
   */
  invite: {
    limit: 20,
    windowSeconds: 3600,
    reason: 'Sending mail in our name to a third party. Hour-long window catches list-mailing.',
  },

  /** Assembling every graph a user owns into one download. */
  dataExport: {
    limit: 3,
    windowSeconds: 3600,
    reason:
      'Reads and serialises the whole account. Nobody needs it more than a few times an hour.',
  },

  /**
   * Deleting an account, and the re-authentication in front of it. The
   * re-auth prompt is a password oracle if it can be hammered, so it is the
   * tightest policy here.
   */
  destructive: {
    limit: 5,
    windowSeconds: 3600,
    reason: 'Irreversible, and its re-auth step is a password oracle if it can be hammered.',
  },
} as const satisfies Record<string, RateLimitPolicy>;

export type RateLimitSurface = keyof typeof POLICIES;

/* -------------------------------------------------------------------------- */
/* Verdicts                                                                    */
/* -------------------------------------------------------------------------- */

export interface LimitVerdict {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window resets. 0 when the request was allowed. */
  retryAfterSeconds: number;
}

/** Kept as a named export because `auth/actions.ts` renders it in a message. */
export const AUTH_ATTEMPTS_PER_MINUTE = POLICIES.auth.limit;

/* -------------------------------------------------------------------------- */
/* Redis-backed limiters                                                       */
/* -------------------------------------------------------------------------- */

let redis: Redis | null = null;
const limiters = new Map<RateLimitSurface, Ratelimit>();

function getLimiter(surface: RateLimitSurface): Ratelimit | null {
  if (!hasUpstash()) return null;

  redis ??= new Redis({ url: serverEnv.upstashUrl, token: serverEnv.upstashToken });

  const existing = limiters.get(surface);
  if (existing) return existing;

  const policy = POLICIES[surface];
  const limiter = new Ratelimit({
    redis,
    // Sliding rather than fixed: a fixed window lets a caller spend a full
    // quota at the end of one window and again at the start of the next.
    limiter: Ratelimit.slidingWindow(policy.limit, `${policy.windowSeconds} s`),
    // Namespaced per surface so one surface's traffic cannot exhaust another's.
    prefix: `toolgraph:${surface}`,
    analytics: false,
  });
  limiters.set(surface, limiter);
  return limiter;
}

/* -------------------------------------------------------------------------- */
/* In-process fallback                                                         */
/* -------------------------------------------------------------------------- */

const memoryHits = new Map<string, number[]>();

function checkInMemory(surface: RateLimitSurface, key: string): LimitVerdict {
  const policy = POLICIES[surface];
  const windowMs = policy.windowSeconds * 1000;
  const now = Date.now();
  const bucket = `${surface}:${key}`;

  const recent = (memoryHits.get(bucket) ?? []).filter((at) => at > now - windowMs);

  // Bound the map so a flood of distinct keys cannot grow it without limit.
  if (memoryHits.size > 10_000) memoryHits.clear();

  if (recent.length >= policy.limit) {
    const oldest = recent[0] ?? now;
    return {
      allowed: false,
      limit: policy.limit,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
    };
  }

  recent.push(now);
  memoryHits.set(bucket, recent);
  return {
    allowed: true,
    limit: policy.limit,
    remaining: policy.limit - recent.length,
    retryAfterSeconds: 0,
  };
}

/** Test seam. Never called from application code. */
export function __resetInMemoryLimits(): void {
  memoryHits.clear();
}

/* -------------------------------------------------------------------------- */
/* The one entry point                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Consume one token for `identifier` on `surface`.
 *
 * `identifier` should be the narrowest stable thing available, in this order of
 * preference: a user id, a workspace id, then an IP. Prefixing it (`user:`,
 * `ip:`) is the caller's job and matters — an unprefixed uuid and an unprefixed
 * address could collide in principle, and more importantly the prefix is what
 * makes a Redis key readable when someone is debugging a 429.
 */
export async function checkRateLimit(
  surface: RateLimitSurface,
  identifier: string,
): Promise<LimitVerdict> {
  const limiter = getLimiter(surface);
  if (!limiter) return checkInMemory(surface, identifier);

  const policy = POLICIES[surface];

  try {
    const result = await limiter.limit(identifier);
    return {
      allowed: result.success,
      limit: result.limit,
      remaining: result.remaining,
      retryAfterSeconds: result.success
        ? 0
        : Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)),
    };
  } catch {
    /*
     * Redis being unreachable must not lock everyone out of the product.
     *
     * Failing open is the right trade for every surface here: the worst case is
     * briefly unmetered traffic during a Redis outage, against the certainty of
     * a total outage of signing in, exporting and paying if it failed closed.
     * The destructive surfaces are not protected by this limiter alone — account
     * deletion additionally requires a fresh password, and payment claims are
     * bounded by the on-chain replay constraint in the database — so an open
     * failure here does not by itself make anything dangerous reachable.
     */
    return { allowed: true, limit: policy.limit, remaining: policy.limit, retryAfterSeconds: 0 };
  }
}

/**
 * Back-compat wrapper for the auth actions, which predate the policy table.
 * New callers should use `checkRateLimit('auth', ...)` directly.
 */
export async function limitAuthAttempt(identifier: string): Promise<LimitVerdict> {
  return checkRateLimit('auth', identifier);
}

/**
 * A 429 body and headers, so every route refuses the same way.
 *
 * `Retry-After` is the header clients and crawlers actually honour; the
 * `X-RateLimit-*` trio is what a developer reads while debugging their own
 * integration.
 */
export function rateLimitResponse(verdict: LimitVerdict, message: string): Response {
  return new Response(JSON.stringify({ error: 'rate_limited', message }), {
    status: 429,
    headers: {
      'content-type': 'application/json',
      'retry-after': String(Math.max(1, verdict.retryAfterSeconds)),
      'x-ratelimit-limit': String(verdict.limit),
      'x-ratelimit-remaining': String(verdict.remaining),
      'cache-control': 'no-store',
    },
  });
}

/**
 * Best-effort client address.
 *
 * Vercel sets `x-forwarded-for`; the leftmost entry is the client. This is
 * spoofable in general, which is why an IP is only ever the fallback key —
 * anything reachable by a signed-in user is limited by user id first.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return headers.get('x-real-ip') ?? 'unknown';
}
