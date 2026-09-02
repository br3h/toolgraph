import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AppShell } from '@/components/AppShell';
import { BillingPanel } from '@/components/billing';
import type { PaymentQuote } from '@/components/billing/types';
import { getCurrentUser } from '@/lib/supabase/server';
import {
  PAYMENT_ADDRESSES,
  PLAN_INTERVAL_DAYS,
  PLAN_PRICE_USD,
  type CryptoCurrency,
} from '@/lib/billing/plan';
import { getCryptoAmountForUsd } from '@/lib/billing/price';
import { getSubscriptionState, type SubscriptionState } from '@/lib/billing/subscription';

export const metadata: Metadata = { title: 'Billing' };
export const dynamic = 'force-dynamic';

/**
 * Quotes are taken here rather than in the browser: the price feed is a
 * third-party API, and calling it from the client would put its host in the CSP
 * and its rate limit at the mercy of anyone with the page open.
 *
 * A failed lookup is a null, never an error — the panel then says "the
 * equivalent of $15" instead of an amount, which is still enough to pay with.
 */
async function quoteFor(currency: CryptoCurrency): Promise<[CryptoCurrency, PaymentQuote | null]> {
  try {
    const quote = await getCryptoAmountForUsd(currency, PLAN_PRICE_USD);
    if (!quote) return [currency, null];
    return [
      currency,
      { amount: quote.amount, rateUsd: quote.rateUsd, quotedAt: new Date().toISOString() },
    ];
  } catch {
    return [currency, null];
  }
}

export default async function BillingPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  // "Unknown" and "none" are different answers, and a page about somebody's
  // money must not print the second when it means the first.
  let state: SubscriptionState | null = null;
  try {
    state = await getSubscriptionState(user.id);
  } catch {
    state = null;
  }

  const quotes: Partial<Record<CryptoCurrency, PaymentQuote | null>> = {};
  const settled = await Promise.all(PAYMENT_ADDRESSES.map((entry) => quoteFor(entry.currency)));
  for (const [currency, quote] of settled) quotes[currency] = quote;

  return (
    <AppShell email={user.email}>
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Billing</h1>
            <p className="mt-1 text-sm text-fg-muted">
              One plan, ${PLAN_PRICE_USD} a month, paid in cryptocurrency. Each payment adds{' '}
              {PLAN_INTERVAL_DAYS} days.
            </p>
          </div>
          <Link
            href="/pricing"
            className="text-xs font-medium text-fg-muted transition-colors hover:text-fg"
          >
            What is in each plan
          </Link>
        </div>

        <div className="mt-8">
          <BillingPanel
            initialState={state}
            addresses={PAYMENT_ADDRESSES}
            quotes={quotes}
            priceUsd={PLAN_PRICE_USD}
            intervalDays={PLAN_INTERVAL_DAYS}
          />
        </div>
      </div>
    </AppShell>
  );
}
