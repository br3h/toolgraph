#!/usr/bin/env node
/**
 * Asserts that the host Toolgraph declares as canonical is the host that
 * actually serves the site.
 *
 * This exists because of a real, silent misconfiguration found during the
 * 2026-02 release: `NEXT_PUBLIC_SITE_URL` was the apex domain while Vercel
 * 308-redirected the apex to `www`. Nothing was broken from a browser — the
 * redirect worked — but every `<link rel="canonical">`, every `<loc>` in the
 * sitemap and the `og:image` URL pointed at a host that immediately redirects.
 * A canonical that redirects is a contradictory signal: it tells a crawler "the
 * real address is X" while X says "no, it is Y".
 *
 * Nothing in a build or a unit test can catch this, because it depends on the
 * live DNS and the provider's domain settings, not on the code. So it is checked
 * here, at deploy time, against the real internet.
 *
 * Usage:
 *   node scripts/verify-canonical.mjs --site https://www.toolgraph.dev
 */

function arg(flag, fallback = undefined) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const site = (arg('--site') ?? process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '');

if (!site) {
  console.error('--site (or NEXT_PUBLIC_SITE_URL) is required');
  process.exit(1);
}

/** Follows nothing: the point is to observe the first response, not the last. */
async function head(url) {
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'user-agent': 'toolgraph-canonical-verify' },
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    });
    return { status: res.status, location: res.headers.get('location') };
  } catch (error) {
    return { status: 0, location: null, error: String(error?.message ?? error) };
  }
}

const failures = [];

// 1. The declared site URL must answer directly, not redirect.
const root = await head(`${site}/`);
if (root.status === 0) {
  failures.push(`${site}/ could not be reached: ${root.error}`);
} else if (root.status >= 300 && root.status < 400) {
  failures.push(
    `${site}/ answers ${root.status} and redirects to ${root.location}.\n` +
      `  NEXT_PUBLIC_SITE_URL names the host every canonical URL, sitemap entry and\n` +
      `  og:image points at, so it must be the host that SERVES the site — not one\n` +
      `  that bounces to it. Either make ${new URL(site).host} the primary domain in\n` +
      `  Vercel, or set NEXT_PUBLIC_SITE_URL to ${root.location} and redeploy.`,
  );
} else if (root.status !== 200) {
  failures.push(`${site}/ answered ${root.status}, expected 200.`);
}

// 2. The canonical tag, if present, must name that same origin.
if (root.status === 200) {
  const html = await fetch(`${site}/`, { cache: 'no-store' }).then((r) => r.text());
  const canonical = /<link[^>]+rel="canonical"[^>]+href="([^"]+)"/.exec(html)?.[1];

  if (!canonical) {
    failures.push('The homepage declares no <link rel="canonical">.');
  } else if (new URL(canonical).origin !== new URL(site).origin) {
    failures.push(
      `The homepage's canonical is ${canonical}, whose origin is not ${new URL(site).origin}.`,
    );
  }
}

// 3. The sitemap must list URLs on that origin, for the same reason.
const sitemapUrl = `${site}/sitemap.xml`;
const sitemap = await fetch(sitemapUrl, { cache: 'no-store' })
  .then((r) => (r.ok ? r.text() : null))
  .catch(() => null);

if (!sitemap) {
  failures.push(`${sitemapUrl} could not be fetched.`);
} else {
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  if (locs.length === 0) failures.push('The sitemap lists no URLs.');
  const wrong = locs.filter((loc) => new URL(loc).origin !== new URL(site).origin);
  if (wrong.length > 0) {
    failures.push(`The sitemap lists ${wrong.length} URL(s) on another origin, e.g. ${wrong[0]}.`);
  }
}

if (failures.length > 0) {
  console.error(`\nFAILED: the canonical host is not the host that serves the site.\n`);
  for (const failure of failures) console.error(`  - ${failure}\n`);
  process.exit(1);
}

console.log(`OK: ${site} serves directly, and its canonical and sitemap agree with it.`);
