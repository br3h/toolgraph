/**
 * Next's server instrumentation hook.
 *
 * Loads the right Sentry config for whichever runtime is booting. Both are
 * no-ops without a DSN.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export { captureRequestError as onRequestError } from '@sentry/nextjs';
