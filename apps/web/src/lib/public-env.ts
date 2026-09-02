/**
 * Configuration that is safe in a browser bundle.
 *
 * Every value here is public by design: a Supabase publishable key is protected
 * by Row Level Security, a Sentry DSN only accepts events, and a PostHog
 * project token only accepts events. None of them grant read access to anything.
 *
 * `process.env.NEXT_PUBLIC_*` must be referenced as a full static expression for
 * Next to inline it, which is why each one is written out rather than looked up
 * from a variable.
 */

export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  supabasePublishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  engineUrl: process.env.NEXT_PUBLIC_ENGINE_URL ?? 'http://localhost:8787',
  sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN ?? '',
  posthogKey: process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN ?? '',
  posthogHost: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? '',
  /**
   * The landing page demo recording. Defaults to a file served from `public/`.
   * Point it at a CDN or a signed URL instead by setting the variable; if
   * nothing resolves, the landing page falls back to its static diagram rather
   * than showing a broken player.
   */
  demoVideoUrl: process.env.NEXT_PUBLIC_DEMO_VIDEO_URL ?? '/demo.mp4',
  demoVideoPoster: process.env.NEXT_PUBLIC_DEMO_VIDEO_POSTER ?? '/demo-poster.png',
} as const;

/** The app cannot function at all without these; everything else is optional. */
export function assertSupabaseConfigured(): void {
  if (!publicEnv.supabaseUrl || !publicEnv.supabasePublishableKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set. ' +
        'Copy .env.example to .env.local and fill them in.',
    );
  }
}

export function isSupabaseConfigured(): boolean {
  return Boolean(publicEnv.supabaseUrl && publicEnv.supabasePublishableKey);
}
