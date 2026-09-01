'use client';

/**
 * PostHog, initialised only when a project token is configured.
 *
 * Every storage access is wrapped: a private window, blocked site data, or a
 * browser with cookies disabled must not break the app. Analytics is the least
 * important thing on the page and should behave like it.
 */

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import posthog from 'posthog-js';

import { publicEnv } from '@/lib/public-env';

let started = false;

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (started || !publicEnv.posthogKey) return;

    try {
      posthog.init(publicEnv.posthogKey, {
        api_host: publicEnv.posthogHost || 'https://us.i.posthog.com',
        // Only create a person profile once someone identifies, so anonymous
        // visitors leave no persistent record.
        person_profiles: 'identified_only',
        // The App Router does not fire a page load per navigation, so pageviews
        // are captured manually below.
        capture_pageview: false,
        capture_pageleave: true,
        // Autocapture would hoover up DOM text, which on the canvas means tool
        // names and field names. Off deliberately.
        autocapture: false,
        disable_session_recording: true,
        persistence: 'localStorage+cookie',
      });
      started = true;
    } catch {
      // Blocked storage, an ad blocker, anything: not worth a broken page.
    }
  }, []);

  useEffect(() => {
    if (!started || !pathname) return;
    try {
      // The path only. A query string here could carry a redirect target or an
      // error message, neither of which belongs in analytics.
      posthog.capture('$pageview', { $current_url: pathname });
    } catch {
      /* see above */
    }
  }, [pathname, searchParams]);

  return <>{children}</>;
}
