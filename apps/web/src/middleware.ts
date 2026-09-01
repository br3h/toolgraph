/**
 * Two jobs, both of which have to happen on every request:
 *
 *   1. Emit a Content-Security-Policy carrying a fresh per-request nonce. This
 *      cannot live in `next.config.js`, whose `headers()` is evaluated once at
 *      build time — a nonce that is the same on every response is not a nonce.
 *   2. Refresh the Supabase session cookie. Without this, a user's access token
 *      silently expires mid-session and server components start seeing them as
 *      signed out.
 */

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/** Origins the browser is permitted to talk to. Everything else is blocked. */
function connectSources(): string[] {
  const sources = new Set<string>(["'self'"]);

  const add = (value: string | undefined) => {
    if (!value) return;
    try {
      sources.add(new URL(value).origin);
    } catch {
      // A malformed URL simply contributes nothing rather than breaking the CSP.
    }
  };

  add(process.env.NEXT_PUBLIC_SUPABASE_URL);
  add(process.env.NEXT_PUBLIC_ENGINE_URL);
  add(process.env.NEXT_PUBLIC_POSTHOG_HOST);

  // Supabase Realtime and Auth use the same origin over WebSocket.
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (supabase) {
    try {
      sources.add(new URL(supabase).origin.replace(/^https:/, 'wss:'));
    } catch {
      /* ignored, as above */
    }
  }

  // Sentry's DSN host is where the browser SDK posts events. The DSN is public,
  // but only its origin belongs in a CSP.
  add(process.env.NEXT_PUBLIC_SENTRY_DSN);

  return [...sources];
}

function buildCsp(nonce: string, isDev: boolean): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],

    // `strict-dynamic` lets a nonced script load the chunks it needs without
    // every chunk carrying its own nonce, which is what makes a nonce-based CSP
    // workable with a bundler at all. Browsers that do not understand it fall
    // back to the host allowlist that follows.
    'script-src': [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      'https:',
      // Next's dev overlay and Fast Refresh are compiled at runtime, which
      // genuinely needs eval. It is never present in a production response.
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],

    // Styles are the one place a nonce does not work cleanly: Next injects
    // inline <style> tags for critical CSS without a hook to nonce them, and
    // reactflow sets inline transforms on every node as the user pans. The
    // narrower risk here — style injection cannot execute script — is why this
    // is the single relaxation, and it is scoped to styles alone.
    'style-src': ["'self'", "'unsafe-inline'"],

    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': connectSources(),
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    'frame-src': ["'none'"],
  };

  if (!isDev) {
    directives['upgrade-insecure-requests'] = [];
  }

  return Object.entries(directives)
    .map(([key, values]) => (values.length ? `${key} ${values.join(' ')}` : key))
    .join('; ');
}

export async function middleware(request: NextRequest) {
  const isDev = process.env.NODE_ENV === 'development';

  // 128 bits of randomness, base64. Web Crypto is what the edge runtime offers.
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');
  const csp = buildCsp(nonce, isDev);

  // Forward the nonce so the root layout can stamp it onto its inline scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  // --- Supabase session refresh ------------------------------------------
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (supabaseUrl && supabaseKey) {
    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request: { headers: requestHeaders } });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, {
              ...options,
              httpOnly: true,
              secure: process.env.NODE_ENV === 'production',
              sameSite: 'lax',
              path: '/',
            });
          }
        },
      },
    });

    // Calling getUser() is what actually performs the refresh. Its result is
    // deliberately unused here; pages re-read it themselves.
    await supabase.auth.getUser();
  }

  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('x-nonce', nonce);

  return response;
}

export const config = {
  matcher: [
    /**
     * Every path except static assets and the image optimiser. Those are served
     * straight from the CDN and carry no session, so running middleware on them
     * would only add latency.
     *
     * `/monitoring` is Sentry's tunnel route and must keep its own handling.
     */
    {
      source:
        '/((?!_next/static|_next/image|favicon.ico|monitoring|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff2?)$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
