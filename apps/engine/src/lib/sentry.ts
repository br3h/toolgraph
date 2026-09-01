/**
 * Sentry, initialised only when a DSN is present.
 *
 * The engine must run with no observability configured — that is what lets a
 * contributor start it from `.env.example` and what lets CI build it with zero
 * secrets. Everything here degrades to a no-op.
 */

import * as Sentry from '@sentry/node';

import type { EngineConfig } from '../config';

let initialised = false;

export function initSentry(config: EngineConfig): boolean {
  if (initialised || !config.sentryDsn) return false;

  Sentry.init({
    dsn: config.sentryDsn,
    environment: config.nodeEnv,
    release: config.commit !== 'unknown' ? config.commit : undefined,
    // The free plan sleeps constantly, so a high trace rate would mostly sample
    // cold starts. Errors are what matter here.
    tracesSampleRate: config.nodeEnv === 'production' ? 0.1 : 0,
    sendDefaultPii: false,

    /**
     * Last line of defence against a credential reaching an error report. The
     * request body carries per-server headers and env, which is exactly the
     * material that must never leave this process.
     */
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        if (event.request.headers) {
          for (const header of ['authorization', 'cookie', 'apikey', 'x-api-key']) {
            delete event.request.headers[header];
          }
        }
      }
      return event;
    },
  });

  initialised = true;
  return true;
}

export function captureError(error: unknown, context?: Record<string, unknown>): void {
  if (!initialised) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}
