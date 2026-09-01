/**
 * OAuth and email-confirmation landing route.
 *
 * Supabase redirects here with a one-time `code`, which is exchanged for a
 * session. The exchange must happen server-side so the resulting tokens land in
 * httpOnly cookies rather than anywhere JavaScript can read them.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Only same-origin relative paths are honoured as a post-login destination.
 *
 * Without this check, `?next=https://evil.example` would turn the callback into
 * an open redirect that borrows the site's credibility.
 */
function safeRedirectPath(raw: string | null): string {
  if (!raw) return '/graphs';
  // Must be a single-slash absolute path. `//host` is protocol-relative and
  // would leave the site.
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/graphs';
  if (raw.includes('\\')) return '/graphs';
  return raw;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);

  const code = searchParams.get('code');
  const next = safeRedirectPath(searchParams.get('next'));

  // Supabase reports a refusal here rather than at the provider.
  const oauthError = searchParams.get('error_description') ?? searchParams.get('error');
  if (oauthError) {
    const url = new URL('/login', origin);
    url.searchParams.set('error', oauthError.slice(0, 200));
    return NextResponse.redirect(url);
  }

  if (!code) {
    const url = new URL('/login', origin);
    url.searchParams.set('error', 'That sign-in link is missing its code.');
    return NextResponse.redirect(url);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const url = new URL('/login', origin);
    url.searchParams.set('error', 'That sign-in link has expired or was already used.');
    return NextResponse.redirect(url);
  }

  return NextResponse.redirect(new URL(next, origin));
}
