import 'server-only';

/**
 * Reading and writing the subscription entitlement.
 *
 * Every function here uses the service-role client, and that is not a
 * convenience — it is the design. `public.subscriptions` grants users SELECT
 * and nothing else, and carries three RLS policies that evaluate to false, so a
 * user cannot write their own status even with a valid session. The server is
 * the only thing that may assert someone has paid, and this module is where it
 * does it.
 *
 * The status vocabulary is honest by construction. 'pending' means a payment
 * has been claimed and not yet verified; it is not entitlement and nothing may
 * treat it as such. Only 'active' with a future period end means paid.
 */

import { createAdminClient } from '@/lib/supabase/server';

export interface SubscriptionState {
  status: 'none' | 'pending' | 'active' | 'expired';
  /** ISO 8601, or null when no period has ever been granted. */
  currentPeriodEnd: string | null;
  /** Whole days left, rounded up. Null unless the subscription is active. */
  daysRemaining: number | null;
}

const DAY_MS = 86_400_000;

const STATUSES: readonly SubscriptionState['status'][] = ['none', 'pending', 'active', 'expired'];

const NONE: SubscriptionState = { status: 'none', currentPeriodEnd: null, daysRemaining: null };

interface SubscriptionRow {
  status: string | null;
  current_period_end: string | null;
}

function isStatus(value: unknown): value is SubscriptionState['status'] {
  return typeof value === 'string' && STATUSES.includes(value as SubscriptionState['status']);
}

/**
 * The current state of an account's subscription.
 *
 * A stored 'active' whose period has already run out is reported as 'expired'.
 * The row is not corrected on the way past: a read must not have a write hiding
 * inside it, and the stored value is repaired by the same code path that grants
 * time. What the user is shown is the truth either way.
 *
 * Never throws. A database that is unreachable yields 'none', which withholds
 * access rather than granting it — the safe direction to fail.
 */
export async function getSubscriptionState(userId: string): Promise<SubscriptionState> {
  if (!userId) return NONE;

  let row: SubscriptionRow | null = null;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('subscriptions')
      .select('status, current_period_end')
      .eq('owner', userId)
      .maybeSingle();

    if (error || !data) return NONE;
    row = data as SubscriptionRow;
  } catch {
    // Includes the secret key being absent, which is a deployment fault and
    // must not be reported to the user as a subscription.
    return NONE;
  }

  const stored = isStatus(row.status) ? row.status : 'none';
  const currentPeriodEnd = row.current_period_end;

  const endsAt = currentPeriodEnd ? Date.parse(currentPeriodEnd) : Number.NaN;
  const msRemaining = Number.isNaN(endsAt) ? null : endsAt - Date.now();

  if (stored === 'active' && (msRemaining === null || msRemaining <= 0)) {
    return { status: 'expired', currentPeriodEnd, daysRemaining: 0 };
  }

  return {
    status: stored,
    currentPeriodEnd,
    daysRemaining:
      stored === 'active' && msRemaining !== null ? Math.ceil(msRemaining / DAY_MS) : null,
  };
}

/**
 * Grants `days` of paid access, and marks the subscription active.
 *
 * Time is added to the later of now and the existing period end, so paying
 * before the current month runs out extends it rather than throwing the
 * remainder away. Someone who renews on day 25 keeps their five days.
 *
 * Throws if the write fails. Deliberately: the caller has just verified a
 * payment on chain, and a silent failure here would take someone's money and
 * leave them without the subscription they bought. It has to be loud enough to
 * reach the logs and the user.
 */
export async function activateSubscription(userId: string, days: number): Promise<void> {
  if (!userId) throw new Error('activateSubscription requires a user id.');
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error('activateSubscription requires a positive number of days.');
  }

  const admin = createAdminClient();

  const { data, error: readError } = await admin
    .from('subscriptions')
    .select('current_period_end')
    .eq('owner', userId)
    .maybeSingle();

  if (readError) {
    throw new Error(`Could not read the existing subscription: ${readError.message}`);
  }

  const existing = (data as { current_period_end: string | null } | null)?.current_period_end;
  const existingEnd = existing ? Date.parse(existing) : Number.NaN;
  const now = Date.now();
  // An end date in the past is a lapsed subscription, and extending from it
  // would grant a period that has already elapsed.
  const base = Number.isNaN(existingEnd) ? now : Math.max(now, existingEnd);

  const { error } = await admin.from('subscriptions').upsert(
    {
      owner: userId,
      status: 'active',
      current_period_end: new Date(base + days * DAY_MS).toISOString(),
    },
    { onConflict: 'owner' },
  );

  if (error) throw new Error(`Could not activate the subscription: ${error.message}`);
}

/**
 * Sets the status without touching the paid period.
 *
 * Used to move an account to 'pending' when a payment is claimed, and to
 * 'expired' when a period lapses. `current_period_end` is deliberately absent
 * from the upsert so an existing period survives a status change — the upsert
 * writes only the columns named here.
 *
 * Granting paid access is `activateSubscription`'s job, because that is what
 * sets a period end. Writing 'active' through this function does not smuggle in
 * an entitlement: with no future `current_period_end`, `getSubscriptionState`
 * reports the account as 'expired'. The read is where honesty is enforced, so
 * no call into this function can make someone look paid when they are not.
 */
export async function setSubscriptionStatus(
  userId: string,
  status: SubscriptionState['status'],
): Promise<void> {
  if (!userId) throw new Error('setSubscriptionStatus requires a user id.');

  const admin = createAdminClient();
  const { error } = await admin
    .from('subscriptions')
    .upsert({ owner: userId, status }, { onConflict: 'owner' });

  if (error) throw new Error(`Could not update the subscription status: ${error.message}`);
}
