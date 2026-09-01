/**
 * Sentry on the edge runtime (middleware).
 *
 * Guarded on the DSN so the app runs unchanged with no observability
 * configured — which is what lets CI build with zero secrets and a contributor
 * clone with none.
 */

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0,
    sendDefaultPii: false,
    /**
     * A toolgraph request body can carry MCP server credentials and the shape of
     * a user's private infrastructure. None of it belongs in an error report.
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
}
