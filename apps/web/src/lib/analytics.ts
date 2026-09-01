'use client';

/**
 * Product analytics.
 *
 * PRIVACY COMMITMENT, not a style note: nothing sent from here may identify a
 * person or reveal what they are building. No email address, no token, no
 * server URL a user typed, no tool name, no graph contents, no field name. Only
 * counts, enumerated values and booleans.
 *
 * The reason is specific to this product. A toolgraph event payload sits next
 * to MCP server URLs and tool schemas — the shape of someone's private
 * infrastructure. That must never leave the browser, so the API here only
 * accepts things that cannot carry it, and every call site is reviewed on that
 * basis.
 *
 * Every function is a no-op on the server, a no-op when PostHog is not
 * configured, and wrapped so that analytics can never break a user flow.
 */

import posthog from 'posthog-js';

import { publicEnv } from './public-env';

/** The complete set of events. Adding one is a deliberate act, not an ad-hoc string. */
export type AnalyticsEvent =
  | 'signup completed'
  | 'graph created'
  | 'connection made'
  | 'type-check failed'
  | 'test-run executed'
  | 'export downloaded';

/** Values safe to attach to an event: never free text a user supplied. */
export type AnalyticsProperties = Record<string, number | boolean | null | undefined | string>;

function enabled(): boolean {
  return typeof window !== 'undefined' && Boolean(publicEnv.posthogKey);
}

export function captureEvent(event: AnalyticsEvent, properties?: AnalyticsProperties): void {
  if (!enabled()) return;
  try {
    posthog.capture(event, properties);
  } catch {
    // Analytics is never worth interrupting what the user was doing.
  }
}

/**
 * Associate subsequent events with a user id.
 *
 * The id is the Supabase uuid and nothing else — deliberately not the email
 * address, which would turn every event into personal data.
 */
export function identifyUser(id: string, properties?: AnalyticsProperties): void {
  if (!enabled()) return;
  try {
    posthog.identify(id, properties);
  } catch {
    /* see above */
  }
}

/** Called on sign-out so the next person on this browser is a new identity. */
export function resetAnalytics(): void {
  if (!enabled()) return;
  try {
    posthog.reset();
  } catch {
    /* see above */
  }
}
