import type { MetadataRoute } from 'next';

import { publicEnv } from '@/lib/public-env';

/**
 * sitemap.xml.
 *
 * Public pages only, and that list is written out by hand rather than
 * discovered. Enumerating the route tree would eventually sweep in an
 * authenticated page — the failure mode being a sitemap that hands a crawler
 * the URL of somebody's settings screen — so a new entry here is a deliberate
 * act.
 *
 * `lastModified` is the build time rather than a per-page date. Toolgraph has
 * no CMS, so the pages change when the app is deployed; inventing a date per
 * route would be a fabricated signal, and a stale one is worse than none.
 */
const BUILD_TIME = new Date();

export default function sitemap(): MetadataRoute.Sitemap {
  const base = publicEnv.siteUrl.replace(/\/$/, '');

  return [
    { url: `${base}/`, lastModified: BUILD_TIME, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/pricing`, lastModified: BUILD_TIME, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/docs`, lastModified: BUILD_TIME, changeFrequency: 'weekly', priority: 0.7 },
    {
      url: `${base}/security`,
      lastModified: BUILD_TIME,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    { url: `${base}/privacy`, lastModified: BUILD_TIME, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/terms`, lastModified: BUILD_TIME, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
