// @ts-check

/**
 * Security headers.
 *
 * Note on where CSP lives: a Content-Security-Policy that uses a per-request
 * nonce cannot be expressed here, because `headers()` is evaluated once at build
 * time and a nonce must be unique per response. The nonce-based CSP is therefore
 * emitted from `src/middleware.ts`, which runs per request. Everything that is
 * genuinely static lives here. The two are complementary, not duplicated — do
 * not also emit a CSP from this file, or the browser would enforce the
 * intersection of two policies and break the app in ways that are hard to debug.
 */
const securityHeaders = [
  {
    // Two years, subdomains included, and preload-eligible. Vercel terminates
    // TLS and never serves this app over plain HTTP.
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    // The canvas is never meant to be embedded. `frame-ancestors 'none'` in the
    // middleware CSP is the modern equivalent; this covers older browsers.
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    // toolgraph needs none of these. Denying them shrinks the attack surface a
    // compromised dependency could reach for.
    key: 'Permissions-Policy',
    value: [
      'accelerometer=()',
      'autoplay=()',
      'camera=()',
      'display-capture=()',
      'encrypted-media=()',
      'fullscreen=(self)',
      'geolocation=()',
      'gyroscope=()',
      'magnetometer=()',
      'microphone=()',
      'midi=()',
      'payment=()',
      'usb=()',
      'xr-spatial-tracking=()',
    ].join(', '),
  },
  {
    key: 'X-DNS-Prefetch-Control',
    value: 'off',
  },
  {
    // Keeps this origin out of other origins' process, so a cross-origin
    // Spectre-style read cannot reach it.
    key: 'Cross-Origin-Opener-Policy',
    value: 'same-origin',
  },
  {
    key: 'Cross-Origin-Resource-Policy',
    value: 'same-origin',
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // The shared packages are published as TypeScript source rather than built
  // artifacts, so Next has to compile them itself.
  transpilePackages: ['@toolgraph/ui', '@toolgraph/schema-core', '@toolgraph/codegen'],

  eslint: {
    // Linting is a separate CI step over the whole monorepo with one shared
    // config; running it again here would use a different resolution root.
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Typechecking is likewise its own CI step (`pnpm typecheck`). Never set
    // this to `true` — a type error must fail the build somewhere.
    ignoreBuildErrors: false,
  },

  // Source maps are generated so Sentry can symbolicate, but they are not served
  // to browsers in production.
  productionBrowserSourceMaps: false,

  outputFileTracingRoot: require('path').join(__dirname, '../../'),

  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
      {
        // Health check must never be cached — it is what deploy verification
        // polls to confirm which commit is actually live.
        source: '/api/health',
        headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }],
      },
    ];
  },
};

/**
 * Sentry wrapping is conditional on `SENTRY_AUTH_TOKEN` being present.
 *
 * This is deliberate, and required: CI builds with zero secrets by design, and a
 * contributor cloning the repo has no Sentry account. Without the token the app
 * still builds and still reports errors at runtime via the public DSN — it just
 * skips source-map upload, so stack traces are minified.
 */
let exported = nextConfig;

if (process.env.SENTRY_AUTH_TOKEN) {
  // Required lazily so the package is not resolved at all when unused.
  const { withSentryConfig } = require('@sentry/nextjs');
  exported = withSentryConfig(nextConfig, {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    silent: true,
    // Upload maps, then delete them from the deployed bundle so they are never
    // publicly fetchable.
    sourcemaps: { deleteSourcemapsAfterUpload: true },
    // Route Sentry's browser requests through this origin so an ad blocker
    // cannot silently drop error reports.
    tunnelRoute: '/monitoring',
    disableLogger: true,
    telemetry: false,
  });
}

module.exports = exported;
