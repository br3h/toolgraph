import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AppShell } from '@/components/AppShell';
import { BillingPanel } from '@/components/billing';
import { PlanChooser } from '@/components/billing/PlanChooser';
import type { PaymentQuote } from '@/components/billing/types';
import { getCurrentUser } from '@/lib/supabase/server';
import {
  PAYMENT_ADDRESSES,
  PLANS,
  intervalDays,
  priceUsd,
  type BillingInterval,
  type CryptoCurrency,
  type PlanId,
} from '@/lib/billing/plan';
import { getCryptoAmountForUsd } from '@/lib/billing/price';
import { getSubscriptionState, type SubscriptionState } from '@/lib/billing/subscription';
import { listWorkspaces } from '@/lib/workspaces/store';

export const dynamic = 'force-dynamic';

// Nothing behind a session belongs in a search index, and a billing page in
// particular must never be crawled.
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Quotes are taken here rather than in the browser: the price feed is a
 * third-party API, and calling it from the client would put its host in the CSP
 * and its rate limit at the mercy of anyone with the page open.
 *
 * A failed lookup is a null, never an error — the panel then says "the
 * equivalent of $X" instead of an amount, which is still enough to pay with.
 */
async function quoteFor(
  currency: CryptoCurrency,
  usd: number,
): Promise<[CryptoCurrency, PaymentQuote | null]> {
  try {
    const quote = await getCryptoAmountForUsd(currency, usd);
    if (!quote) return [currency, null];
    return [
      currency,
      { amount: quote.amount, rateUsd: quote.rateUsd, quotedAt: new Date().toISOString() },
    ];
  } catch {
    return [currency, null];
  }
}

/**
 * The selection lives in the URL rather than in component state.
 *
 * That is what lets the quote be computed on the SERVER for the exact plan
 * being submitted. A client-side selector would have to either recompute the
 * amount in the browser — which means shipping the price table and trusting it
 * — or show a figure for a different plan than the one the form will post.
 * Both are how somebody sends the wrong amount of money.
 */
function readSelection(params: Record<string, string | string[] | undefined>): {
  plan: Exclude<PlanId, 'free'>;
  interval: BillingInterval;
  seats: number;
} {
  const first = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const plan = first('plan') === 'team' ? 'team' : 'pro';
  const interval: BillingInterval = first('interval') === 'annual' ? 'annual' : 'monthly';

  const definition = PLANS[plan];
  const requested = Number.parseInt(first('seats') ?? '', 10);
  const seats = Number.isInteger(requested)
    ? Math.min(Math.max(requested, definition.minSeats), definition.maxSeats)
    : definition.minSeats;

  return { plan, interval, seats };
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const params = await searchParams;
  const { plan, interval, seats } = readSelection(params);

  // "Unknown" and "none" are different answers, and a page about somebody's
  // money must not print the second when it means the first.
  let state: SubscriptionState | null = null;
  try {
    state = await getSubscriptionState(user.id);
  } catch {
    state = null;
  }

  // A Team purchase pays for a workspace, so there has to be one to pay for.
  // Workspaces the caller merely belongs to are filtered out: paying for a
  // workspace you do not administer is not something the database will accept
  // (payment_submissions_insert_own), so offering it would be a dead end.
  const workspaces = (await listWorkspaces()).filter(
    (workspace) => workspace.role === 'owner' || workspace.role === 'admin',
  );

  const requestedWorkspace = Array.isArray(params.workspace)
    ? params.workspace[0]
    : params.workspace;
  const workspaceId =
    plan === 'team'
      ? (workspaces.find((w) => w.id === requestedWorkspace)?.id ?? workspaces[0]?.id ?? null)
      : null;

  // `priceUsd` returns null only for a combination that cannot be bought, and
  // `readSelection` has already clamped seats into range — so this is total in
  // practice. The fallback exists so a future plan change cannot make the page
  // throw on somebody mid-payment.
  const total = priceUsd(plan, interval, seats) ?? PLANS[plan].monthlyUsd * seats;

  const quotes: Partial<Record<CryptoCurrency, PaymentQuote | null>> = {};
  const settled = await Promise.all(
    PAYMENT_ADDRESSES.map((entry) => quoteFor(entry.currency, total)),
  );
  for (const [currency, quote] of settled) quotes[currency] = quote;

  const canBuyTeam = workspaces.length > 0;

  return (
    <AppShell email={user.email} active="billing">
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Billing</h1>
            <p className="mt-1 text-sm text-fg-muted">
              Paid in cryptocurrency. Each payment adds {intervalDays(interval)} days — nothing
              renews on its own, and there is nothing to cancel.
            </p>
          </div>
          <Link
            href="/pricing"
            className="text-xs font-medium text-fg-muted transition-colors hover:text-fg"
          >
            What is in each plan
          </Link>
        </div>

        <div className="mt-8 space-y-5">
          <PlanChooser
            plan={plan}
            interval={interval}
            seats={seats}
            workspaceId={workspaceId}
            workspaces={workspaces.map((w) => ({ id: w.id, name: w.name }))}
            totalUsd={total}
          />

          {plan === 'team' && !canBuyTeam ? (
            <div className="rounded-[var(--tg-radius-lg)] border border-border-strong bg-bg-raised p-5">
              <p className="text-sm font-medium">You need a workspace first.</p>
              <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">
                A Team subscription pays for seats on a specific workspace, so there has to be one
                before it can be bought. Create one in settings, then come back — the payment form
                appears once a workspace exists.
              </p>
              <Link
                href="/settings/workspaces"
                className="mt-4 inline-flex items-center rounded-[var(--tg-radius-md)] bg-accent px-4 py-2 text-sm font-semibold text-fg-on-accent transition-opacity hover:opacity-90"
              >
                Create a workspace
              </Link>
            </div>
          ) : (
            <BillingPanel
              initialState={state}
              addresses={PAYMENT_ADDRESSES}
              quotes={quotes}
              priceUsd={total}
              intervalDays={intervalDays(interval)}
              plan={plan}
              billingInterval={interval}
              seats={seats}
              workspaceId={workspaceId}
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}
