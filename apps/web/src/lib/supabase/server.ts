import 'server-only';

/**
 * Supabase clients for server components, route handlers and server actions.
 *
 * Two of them, and the difference matters:
 *
 *   `createClient()`      — acts as the signed-in user. RLS applies. Use this
 *                           for everything the user is doing.
 *   `createAdminClient()` — uses the secret key and BYPASSES RLS entirely. Use
 *                           it only where there is no user to act as, and never
 *                           with a user-supplied filter.
 */

import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

import { publicEnv } from '../public-env';
import { serverEnv } from '../env';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, {
              ...options,
              httpOnly: true,
              secure: process.env.NODE_ENV === 'production',
              sameSite: 'lax',
              path: '/',
            });
          }
        } catch {
          // Called from a server component, where cookies are read-only. The
          // middleware refreshes the session instead, so this is safe to ignore.
        }
      },
    },
  });
}

/**
 * Service-role client. Bypasses RLS — treat every call as if it were raw SQL.
 *
 * Deliberately does not read cookies: it has no user context by design, and
 * accidentally combining an admin key with a user session is how privilege
 * escalation bugs happen.
 */
export function createAdminClient() {
  if (!serverEnv.supabaseSecretKey) {
    throw new Error('SUPABASE_SECRET_KEY is not set, so admin operations are unavailable.');
  }

  return createSupabaseClient(publicEnv.supabaseUrl, serverEnv.supabaseSecretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** The signed-in user, or null. Never throws — callers redirect instead. */
export async function getCurrentUser() {
  try {
    const supabase = await createClient();
    // getUser() revalidates against Supabase; getSession() would trust a cookie
    // the client could have tampered with.
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data.user;
  } catch {
    return null;
  }
}
