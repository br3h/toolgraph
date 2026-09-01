/**
 * `GET /api/health`
 *
 * Unauthenticated and never cached. `deploy.yml` polls it after a merge to
 * confirm the commit that merged is the commit actually serving traffic, and it
 * is safe to point a free uptime monitor at.
 *
 * It reports which integrations are configured but never a value from any of
 * them.
 */

import { NextResponse } from 'next/server';

// Node rather than edge: reading process.env for build metadata is simpler and
// this route is not latency-sensitive.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const startedAt = Date.now();

export function GET() {
  const commit =
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.GIT_COMMIT ??
    process.env.RENDER_GIT_COMMIT ??
    'unknown';

  return NextResponse.json(
    {
      status: 'ok',
      service: 'toolgraph-web',
      commit,
      version: process.env.npm_package_version ?? '0.1.0',
      buildTime: process.env.BUILD_TIME ?? null,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
      integrations: {
        supabase: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
        engine: Boolean(process.env.NEXT_PUBLIC_ENGINE_URL),
        sentry: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
        posthog: Boolean(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN),
      },
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, max-age=0, must-revalidate',
        'Content-Type': 'application/json',
      },
    },
  );
}
