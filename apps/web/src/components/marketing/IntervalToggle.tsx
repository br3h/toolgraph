'use client';

/**
 * Monthly / Annual.
 *
 * Two links rather than a stateful switch, and the choice lives in the query
 * string. That keeps the price rendering on the server — the browser never
 * receives the price table and so cannot show a figure the server would not
 * charge — and it means a shared or bookmarked link shows what the sender saw.
 *
 * `role="group"` with `aria-current` rather than a radio group: these navigate
 * rather than submit, and announcing them as form controls would promise a
 * submit that does not exist.
 */

import Link from 'next/link';
import { cn } from '@toolgraph/ui';

import type { BillingInterval } from '@/lib/billing/plan';

export function IntervalToggle({
  interval,
  savingPercent,
}: {
  interval: BillingInterval;
  savingPercent: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div
        role="group"
        aria-label="Billing interval"
        className="inline-flex gap-1 rounded-[var(--tg-radius-md)] border border-border p-1"
      >
        <Link
          href="/pricing?interval=monthly"
          scroll={false}
          aria-current={interval === 'monthly' ? 'true' : undefined}
          className={cn(
            'rounded-[var(--tg-radius-sm)] px-4 py-1.5 text-sm font-medium transition-colors',
            interval === 'monthly'
              ? 'bg-accent text-fg-on-accent'
              : 'text-fg-muted hover:bg-bg-sunken hover:text-fg',
          )}
        >
          Monthly
        </Link>
        <Link
          href="/pricing?interval=annual"
          scroll={false}
          aria-current={interval === 'annual' ? 'true' : undefined}
          className={cn(
            'rounded-[var(--tg-radius-sm)] px-4 py-1.5 text-sm font-medium transition-colors',
            interval === 'annual'
              ? 'bg-accent text-fg-on-accent'
              : 'text-fg-muted hover:bg-bg-sunken hover:text-fg',
          )}
        >
          Annual
        </Link>
      </div>
      {savingPercent > 0 ? (
        <p className="text-xs text-fg-subtle">Annual is {savingPercent}% less — two months free.</p>
      ) : null}
    </div>
  );
}
