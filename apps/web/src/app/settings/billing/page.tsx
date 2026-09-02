import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge } from '@toolgraph/ui';

import { Section } from '@/components/settings/Section';
import { getCurrentUser } from '@/lib/supabase/server';
import { getSubscriptionState } from '@/lib/billing/subscription';
import { createClient } from '@/lib/supabase/server';
import { PLANS, formatPrice } from '@/lib/billing/plan';

export const dynamic = 'force-dynamic';

const DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : `${DATE.format(date)} (UTC)`;
}

const SUBMISSION_LABEL: Record<string, string> = {
  pending: 'Awaiting review',
  verified: 'Verified',
  rejected: 'Not accepted',
};

export default async function PlanSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const state = await getSubscriptionState(user.id);

  // The audit trail, read through the scoped client so it is the caller's own
  // submissions and nobody else's. This is the "billing history" a paying
  // customer expects, built from the rows that already exist rather than from
  // an invoice system Toolgraph does not have.
  const supabase = await createClient();
  const { data: submissions } = await supabase
    .from('payment_submissions')
    .select(
      'id, currency, tx_hash, status, plan, billing_interval, seats, expected_usd, usd_at_verification, failure_reason, submitted_at',
    )
    .order('submitted_at', { ascending: false })
    .limit(25);

  const active = state.status === 'active';
  const definition = PLANS[state.plan];

  return (
    <div className="space-y-5">
      <Section title="Your plan" description="What is active on this account right now.">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-medium">
              {definition.name}
              <Badge variant={active ? 'strong' : 'subtle'}>
                {active
                  ? 'Active'
                  : state.status === 'pending'
                    ? 'Payment awaiting review'
                    : state.status === 'expired'
                      ? 'Expired'
                      : 'No subscription'}
              </Badge>
            </p>
            <p className="mt-1 text-sm text-fg-muted">
              {active ? (
                <>
                  {formatPrice(state.plan, state.billingInterval)}
                  {state.plan === 'team' ? ` · ${state.seats} seats` : ''} · ends{' '}
                  {formatDate(state.currentPeriodEnd)}
                  {state.daysRemaining !== null ? ` (${state.daysRemaining} days left)` : ''}
                </>
              ) : state.status === 'pending' ? (
                // 'pending' is a claim, not an entitlement, and this page says
                // so in words rather than showing a plan somebody has not got.
                'A payment has been submitted and is not verified yet. Nothing is unlocked until it is.'
              ) : (
                'The free plan is the whole product. Paying raises the ceiling on the hosted runner.'
              )}
            </p>
          </div>
          <Link
            href="/billing"
            className="inline-flex items-center rounded-[var(--tg-radius-md)] bg-accent px-4 py-2 text-sm font-semibold text-fg-on-accent transition-opacity hover:opacity-90"
          >
            {active ? 'Extend or change plan' : 'Choose a plan'}
          </Link>
        </div>

        {active ? (
          <p className="mt-4 text-xs leading-relaxed text-fg-subtle">
            Nothing renews on its own — there is no stored payment method that could charge you
            again — so there is nothing to cancel. Access simply ends on the date above unless you
            pay again, and paying early adds to the end rather than replacing it.
          </p>
        ) : null}
      </Section>

      <Section
        title="Payment history"
        description="Every transaction hash submitted from this account, and what was decided about it."
      >
        {!submissions || submissions.length === 0 ? (
          <p className="text-sm text-fg-muted">Nothing submitted yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-xs uppercase tracking-[0.08em] text-fg-subtle">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Date
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Bought
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Paid in
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Outcome
                  </th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((row) => (
                  <tr key={String(row.id)} className="border-b border-border-subtle align-top">
                    <td className="py-2.5 pr-3 text-fg-muted">
                      {formatDate(String(row.submitted_at))}
                    </td>
                    <td className="py-2.5 pr-3">
                      {PLANS[(row.plan as 'pro' | 'team') ?? 'pro']?.name ?? 'Pro'}
                      {row.plan === 'team' ? `, ${String(row.seats)} seats` : ''}
                      <span className="block text-xs text-fg-subtle">
                        {row.billing_interval === 'annual' ? 'Annual' : 'Monthly'}
                        {row.expected_usd ? ` · $${Number(row.expected_usd)}` : ''}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-fg-muted">
                      {String(row.currency)}
                      {/*
                        Truncated because a full 66-character hash makes this
                        table unreadable, and the chain is the place to look it
                        up in full. `title` carries the whole thing.
                      */}
                      <span
                        className="block font-mono text-xs text-fg-subtle"
                        title={String(row.tx_hash)}
                      >
                        {String(row.tx_hash).slice(0, 10)}…{String(row.tx_hash).slice(-6)}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3">
                      {SUBMISSION_LABEL[String(row.status)] ?? String(row.status)}
                      {row.usd_at_verification ? (
                        <span className="block text-xs text-fg-subtle">
                          worth ${Number(row.usd_at_verification).toFixed(2)}
                        </span>
                      ) : null}
                      {row.failure_reason ? (
                        <span className="mt-0.5 block max-w-xs text-xs leading-relaxed text-fg-subtle">
                          {String(row.failure_reason)}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
