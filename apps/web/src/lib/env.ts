/**
 * Environment access, split by where each value is allowed to be read.
 *
 * The split is the point. `publicEnv` is inlined into the browser bundle by
 * Next; `serverEnv` must only ever be evaluated in a server component, a route
 * handler or a server action. Keeping them in separate exports with a runtime
 * guard makes an accidental client import fail loudly in development instead of
 * silently shipping a secret.
 */

import 'server-only';

/**
 * Server-only configuration.
 *
 * Note the `server-only` import above: if any module that reaches a client
 * bundle imports this file, the build fails with a clear error rather than
 * inlining these values into JavaScript the browser downloads.
 */
export const serverEnv = {
  supabaseSecretKey: process.env.SUPABASE_SECRET_KEY ?? '',
  resendApiKey: process.env.RESEND_API_KEY ?? '',
  resendFromEmail: process.env.RESEND_FROM_EMAIL ?? '',
  upstashUrl: process.env.UPSTASH_REDIS_REST_URL ?? '',
  upstashToken: process.env.UPSTASH_REDIS_REST_TOKEN ?? '',
} as const;

export function hasResend(): boolean {
  return Boolean(serverEnv.resendApiKey && serverEnv.resendFromEmail);
}

export function hasUpstash(): boolean {
  return Boolean(serverEnv.upstashUrl && serverEnv.upstashToken);
}

export function hasServiceRole(): boolean {
  return Boolean(serverEnv.supabaseSecretKey);
}
