'use server';

/**
 * Authentication server actions.
 *
 * Next's server actions carry their own same-origin protection, but this file
 * adds an explicit Origin check on top of it. That is deliberate belt-and-braces:
 * the framework's protection is a moving target across versions, and an auth
 * mutation is exactly where a regression would hurt most.
 */

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { createClient } from '@/lib/supabase/server';
import { publicEnv } from '@/lib/public-env';
import { clientIp, limitAuthAttempt } from '@/lib/rate-limit';
import { sendWelcomeEmail } from '@/lib/email';

export interface AuthActionState {
  error?: string;
  notice?: string;
}

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(254),
  password: z.string().min(8, 'Use at least 8 characters.').max(128, 'That password is too long.'),
});

/**
 * Reject a mutation whose Origin is not this site.
 *
 * Returns an error string rather than throwing so the caller can render it
 * inline, which is also what keeps a failed check from looking like a crash.
 */
async function assertSameOrigin(): Promise<string | null> {
  const headerList = await headers();
  const origin = headerList.get('origin');

  // A same-origin form post from a browser always sends Origin. Its absence in
  // production means something other than a browser form is calling this.
  if (!origin) {
    return process.env.NODE_ENV === 'production' ? 'This request could not be verified.' : null;
  }

  const allowed = new Set<string>();
  try {
    allowed.add(new URL(publicEnv.siteUrl).origin);
  } catch {
    /* a malformed configured URL contributes nothing */
  }

  const host = headerList.get('host');
  if (host) {
    allowed.add(`https://${host}`);
    if (process.env.NODE_ENV !== 'production') allowed.add(`http://${host}`);
  }

  // Vercel preview deployments have a per-deploy hostname.
  if (process.env.VERCEL_URL) allowed.add(`https://${process.env.VERCEL_URL}`);

  return allowed.has(origin) ? null : 'This request could not be verified.';
}

/** Rate limit before touching Supabase, keyed by IP and by email. */
async function guardAttempt(email: string): Promise<string | null> {
  const headerList = await headers();
  const ip = clientIp(headerList);

  const [byIp, byEmail] = await Promise.all([
    limitAuthAttempt(`ip:${ip}`),
    limitAuthAttempt(`email:${email}`),
  ]);

  if (!byIp.allowed || !byEmail.allowed) {
    const retry = Math.max(byIp.retryAfterSeconds, byEmail.retryAfterSeconds);
    return `Too many attempts. Try again in ${retry} second${retry === 1 ? '' : 's'}.`;
  }
  return null;
}

export async function signUp(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const originError = await assertSameOrigin();
  if (originError) return { error: originError };

  const parsed = credentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check your details and try again.' };
  }

  const { email, password } = parsed.data;

  const limited = await guardAttempt(email);
  if (limited) return { error: limited };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${publicEnv.siteUrl}/auth/callback` },
  });

  if (error) {
    /*
     * One message is not safe to pass through. When Supabase's SMTP is
     * misconfigured it answers "Error sending confirmation email" with a 500,
     * which tells the person nothing they can act on and reads as though their
     * details were rejected. The account may even exist by then. Say what
     * actually happened instead, and surface it where it can be found.
     */
    if (/sending.*email/i.test(error.message) || error.status === 500) {
      console.error(`signup: confirmation email could not be sent — ${error.message}`);
      return {
        error:
          'Your account could not be created because the confirmation email could not be sent. ' +
          'This is a problem on our side, not with your details. Please try again shortly.',
      };
    }

    // Everything else is Supabase's own wording, which is reasonable and does
    // not leak whether an address is already registered.
    return { error: error.message };
  }

  // Sending mail must never fail a signup that already succeeded.
  if (data.user?.email) {
    void sendWelcomeEmail(data.user.email, publicEnv.siteUrl).catch(() => {});
  }

  // Email confirmation on means no session yet; tell the user to go and check.
  if (!data.session) {
    return { notice: 'Check your email to confirm your address, then sign in.' };
  }

  redirect('/graphs');
}

export async function signIn(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const originError = await assertSameOrigin();
  if (originError) return { error: originError };

  const parsed = credentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    // Never say which field was wrong on sign-in; that is a username oracle.
    return { error: 'That email or password is not correct.' };
  }

  const { email, password } = parsed.data;

  const limited = await guardAttempt(email);
  if (limited) return { error: limited };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: 'That email or password is not correct.' };
  }

  redirect('/graphs');
}

/**
 * Returns void because it is used directly as a `<form action>`, which React
 * requires to resolve to void. A failure therefore comes back as a redirect
 * carrying `?error=`, which the sign-in page renders.
 */
export async function signInWithGitHub(): Promise<void> {
  const originError = await assertSameOrigin();
  if (originError) {
    redirect(`/login?error=${encodeURIComponent(originError)}`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: {
      redirectTo: `${publicEnv.siteUrl}/auth/callback`,
      // Only what is needed to identify the user. toolgraph never reads repos.
      scopes: 'read:user user:email',
    },
  });

  if (error || !data.url) {
    redirect(
      `/login?error=${encodeURIComponent('Could not start GitHub sign-in. Try again in a moment.')}`,
    );
  }

  redirect(data.url);
}

export async function signOut(): Promise<void> {
  const originError = await assertSameOrigin();
  if (originError) return;

  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
