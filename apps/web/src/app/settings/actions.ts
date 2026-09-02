'use server';

/**
 * Account settings mutations.
 *
 * Everything here goes through `guardAction`, which is origin + session + rate
 * limit in that order. The two destructive operations — changing a password and
 * deleting the account — additionally require the CURRENT password, verified
 * against Supabase, so a stolen session cookie on its own is not enough to take
 * an account or destroy one.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { guardAction } from '@/lib/actions-guard';
import { checkRateLimit } from '@/lib/rate-limit';
import { deleteAccount, previewDeletion, type DeletionBlocker } from '@/lib/account/delete';

export interface SettingsResult {
  ok: boolean;
  error?: string;
  notice?: string;
}

/* -------------------------------------------------------------------------- */
/* Profile                                                                     */
/* -------------------------------------------------------------------------- */

const displayNameSchema = z
  .string()
  .trim()
  .max(80, 'That name is too long.')
  // An empty string clears the name rather than failing, which is what somebody
  // who deletes the contents of the field and saves is asking for.
  .transform((value) => (value === '' ? null : value));

export async function updateDisplayName(formData: FormData): Promise<SettingsResult> {
  const guard = await guardAction('connectionWrite');
  if (!guard.ok) return { ok: false, error: guard.error };

  const parsed = displayNameSchema.safeParse(formData.get('displayName') ?? '');
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  // `profiles.id` is the auth user id and the insert policy pins it to
  // auth.uid(), so an upsert cannot write somebody else's row even though the
  // id is supplied here.
  const { error } = await supabase
    .from('profiles')
    .upsert({ id: guard.user.id, display_name: parsed.data }, { onConflict: 'id' });

  if (error) return { ok: false, error: 'That name could not be saved.' };

  revalidatePath('/settings');
  return { ok: true, notice: 'Saved.' };
}

/* -------------------------------------------------------------------------- */
/* Password                                                                    */
/* -------------------------------------------------------------------------- */

const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters.')
  .max(128, 'That password is too long.');

/**
 * Prove the person at the keyboard knows the current password.
 *
 * `signInWithPassword` is used rather than a bespoke check because it is the
 * same code path that guards the front door — including its lockout behaviour —
 * and reimplementing verification is how the two end up disagreeing.
 *
 * Returns a boolean, and the caller must not distinguish "wrong password" from
 * "no password set" in what it shows: both are the same refusal.
 */
async function reauthenticate(email: string, password: string): Promise<boolean> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error === null;
}

export async function changePassword(formData: FormData): Promise<SettingsResult> {
  // The `destructive` policy, not `auth`: this is a password oracle if it can
  // be hammered, and five an hour is enough for anyone changing their own.
  const guard = await guardAction('destructive');
  if (!guard.ok) return { ok: false, error: guard.error };

  const email = guard.user.email;
  if (!email) {
    return {
      ok: false,
      error: 'This account has no email address, so a password cannot be set here.',
    };
  }

  const current = String(formData.get('currentPassword') ?? '');
  const parsed = passwordSchema.safeParse(String(formData.get('newPassword') ?? ''));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };

  if (parsed.data === current) {
    return { ok: false, error: 'That is the password you already have.' };
  }

  if (!(await reauthenticate(email, current))) {
    return { ok: false, error: 'That current password is not correct.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data });
  if (error) return { ok: false, error: error.message };

  return { ok: true, notice: 'Your password has been changed.' };
}

/* -------------------------------------------------------------------------- */
/* Account deletion                                                            */
/* -------------------------------------------------------------------------- */

export interface DeleteAccountResult extends SettingsResult {
  blockers?: DeletionBlocker[];
}

/**
 * Delete the account and everything in it.
 *
 * Three gates, and all three are required:
 *
 *   1. The `destructive` rate limit, so the password check below cannot be used
 *      as an oracle.
 *   2. The current password, verified. A session cookie alone must not be
 *      enough to destroy an account — that is the difference between a stolen
 *      laptop and a catastrophe.
 *   3. The literal word DELETE, typed. Not a checkbox: this is unrecoverable,
 *      and a click is too cheap for it.
 *
 * An account with no password (GitHub-only) skips (2) and gets a stronger (3):
 * the email address, typed out. There is nothing else that person knows which
 * an attacker holding their session would not.
 */
export async function deleteAccountAction(formData: FormData): Promise<DeleteAccountResult> {
  const guard = await guardAction('destructive');
  if (!guard.ok) return { ok: false, error: guard.error };

  const user = guard.user;
  const email = user.email ?? '';

  // Supabase records how a user signs in. Someone who only ever used GitHub has
  // no password to re-enter, and demanding one would lock them out of deleting
  // their own account.
  const hasPassword = Array.isArray(user.identities)
    ? user.identities.some((identity) => identity.provider === 'email')
    : false;

  const confirmation = String(formData.get('confirm') ?? '').trim();

  if (hasPassword) {
    if (confirmation !== 'DELETE') {
      return { ok: false, error: 'Type DELETE to confirm.' };
    }
    const password = String(formData.get('password') ?? '');
    if (!password) return { ok: false, error: 'Enter your password to confirm.' };
    if (!(await reauthenticate(email, password))) {
      return { ok: false, error: 'That password is not correct.' };
    }
  } else if (confirmation.toLowerCase() !== email.toLowerCase() || !email) {
    return {
      ok: false,
      error:
        'Type your email address exactly to confirm. This account signs in with GitHub, so there is no password to check.',
    };
  }

  const result = await deleteAccount(user.id);
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      ...(result.blockers ? { blockers: result.blockers } : {}),
    };
  }

  // The user row is gone, so the session's token no longer resolves to anyone.
  // Clearing the cookie explicitly means the browser is not left carrying a
  // credential for an account that does not exist.
  const supabase = await createClient();
  await supabase.auth.signOut();

  redirect('/?deleted=1');
}

/** What deletion would remove. Read-only; safe to call on page render. */
export async function getDeletionPreview() {
  const user = await getCurrentUser();
  if (!user) return null;
  return previewDeletion(user.id);
}

/* -------------------------------------------------------------------------- */
/* Sessions                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Sign out everywhere.
 *
 * `scope: 'global'` revokes every refresh token the account has, so a session
 * on a device the user no longer holds stops working. This is the honest
 * version of the "active sessions" list Toolgraph does not have: Supabase does
 * not expose per-session metadata to the client, so rather than draw a list
 * that cannot be accurate, there is one button that definitely works.
 */
export async function signOutEverywhere(): Promise<SettingsResult> {
  const guard = await guardAction('destructive');
  if (!guard.ok) return { ok: false, error: guard.error };

  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: 'global' });
  if (error) return { ok: false, error: 'Those sessions could not be revoked.' };

  redirect('/login?signedOutEverywhere=1');
}

/** Guards the data-export route's own limit from a server action. */
export async function checkExportAllowed(userId: string): Promise<boolean> {
  const verdict = await checkRateLimit('dataExport', `user:${userId}`);
  return verdict.allowed;
}
