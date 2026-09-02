import type { MetadataRoute } from 'next';

import { publicEnv } from '@/lib/public-env';

/**
 * robots.txt.
 *
 * Generated rather than written as a static file so the sitemap URL and the
 * host follow `NEXT_PUBLIC_SITE_URL` — a hard-coded domain here is how a
 * preview deployment ends up telling Google to index itself, or how a rename
 * leaves a sitemap pointing at a domain that no longer resolves.
 *
 * The disallow list is defence in depth, not the mechanism. Every private route
 * also emits `robots: noindex` from its own metadata, because robots.txt asks a
 * crawler not to FETCH a path while noindex tells it not to LIST one — and a
 * URL that is only disallowed can still appear in results if something links to
 * it. Both are needed, and the noindex is the one that actually matters.
 */
export default function robots(): MetadataRoute.Robots {
  const base = publicEnv.siteUrl.replace(/\/$/, '');

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          // Everything behind a session. None of it is useful to a searcher and
          // all of it is somebody's private infrastructure.
          '/graphs',
          '/graphs/',
          '/connections',
          '/connections/',
          '/runs',
          '/usage',
          '/settings',
          '/settings/',
          '/billing',
          // Machine endpoints. A crawler following these achieves nothing but
          // spending someone's rate limit.
          '/api/',
          '/auth/',
          '/monitoring',
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
