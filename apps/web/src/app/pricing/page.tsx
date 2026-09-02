import type { Metadata } from 'next';
import Link from 'next/link';
import { SuccessIcon, WarningIcon } from '@toolgraph/ui';

import { getCurrentUser } from '@/lib/supabase/server';
import { MarketingShell } from '@/components/marketing/MarketingShell';
import { IntervalToggle } from '@/components/marketing/IntervalToggle';
import {
  PAYMENT_ADDRESSES,
  PLANS,
  annualSavingPercent,
  type BillingInterval,
  type PlanId,
} from '@/lib/billing/plan';

export const metadata: Metadata = {
  title: 'Pricing | Toolgraph',
  description:
    'Toolgraph is free and MIT licensed. Pro is $15 a month or $150 a year; Team is $12 per seat per month or $120 per seat per year. Paid in cryptocurrency — there is no card processor.',
  alternates: { canonical: '/pricing' },
};

export const dynamic = 'force-dynamic';

function PlanFeature({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-0.5 shrink-0 text-fg-muted">
        <SuccessIcon size={15} />
      </span>
      <span className="text-sm leading-relaxed text-fg-muted">{children}</span>
    </li>
  );
}

/**
 * One pricing card.
 *
 * The annual figure is the plan's own `annualUsd`, not the monthly price times
 * twelve with a discount applied at render time. That is the difference between
 * "two months free" being a fact about the price and being a claim in the copy —
 * and it is the same number `priceUsd()` will require at checkout, because both
 * read the same table.
 */
function PlanCard({
  plan,
  interval,
  emphasis,
  cta,
  ctaHref,
  note,
}: {
  plan: PlanId;
  interval: BillingInterval;
  emphasis?: boolean;
  cta: string;
  ctaHref: string;
  note?: string;
}) {
  const definition = PLANS[plan];
  const perSeat = interval === 'annual' ? definition.annualUsd : definition.monthlyUsd;
  const saving = annualSavingPercent(plan);

  return (
    <div
      className={
        emphasis
          ? 'flex flex-col rounded-[var(--tg-radius-lg)] border-2 border-border-strong bg-bg-raised p-6'
          : 'flex flex-col rounded-[var(--tg-radius-lg)] border border-border-subtle bg-bg-raised p-6'
      }
    >
      <h2 className="text-sm font-semibold tracking-tight">{definition.name}</h2>

      <p className="mt-3 flex flex-wrap items-baseline gap-1.5">
        <span className="text-3xl font-semibold tracking-tight">${perSeat}</span>
        <span className="text-sm text-fg-muted">
          {plan === 'free'
            ? 'forever'
            : `per ${plan === 'team' ? 'seat per ' : ''}${interval === 'annual' ? 'year' : 'month'}`}
        </span>
      </p>

      {plan !== 'free' && interval === 'annual' && saving > 0 ? (
        <p className="mt-1 text-xs text-fg-subtle">
          ${definition.monthlyUsd} a month billed monthly — annual saves {saving}%, which is two
          months.
        </p>
      ) : null}
      {plan === 'team' ? (
        <p className="mt-1 text-xs text-fg-subtle">
          Minimum {definition.minSeats} seats, so from ${perSeat * definition.minSeats} per{' '}
          {interval === 'annual' ? 'year' : 'month'}.
        </p>
      ) : null}

      <p className="mt-3 text-sm leading-relaxed text-fg-muted">{definition.tagline}</p>

      <ul className="mt-5 space-y-2.5">
        {definition.features.map((feature) => (
          <PlanFeature key={feature}>{feature}</PlanFeature>
        ))}
      </ul>

      <div className="mt-6 pt-2">
        <Link
          href={ctaHref}
          className={
            emphasis
              ? 'inline-flex items-center rounded-[var(--tg-radius-md)] bg-accent px-5 py-2.5 text-sm font-semibold text-fg-on-accent transition-opacity hover:opacity-90'
              : 'inline-flex items-center rounded-[var(--tg-radius-md)] border border-border px-5 py-2.5 text-sm font-medium text-fg transition-colors hover:bg-bg-sunken'
          }
          data-testid={`pricing-${plan}-cta`}
        >
          {cta}
        </Link>
        {note ? <p className="mt-2.5 text-xs text-fg-subtle">{note}</p> : null}
      </div>
    </div>
  );
}

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  const signedIn = Boolean(user);

  // The interval lives in the URL rather than in client state, so a shared link
  // shows what the sender was looking at and the server renders the real
  // numbers for it — no price table needs to reach the browser.
  const params = await searchParams;
  const raw = Array.isArray(params.interval) ? params.interval[0] : params.interval;
  const interval: BillingInterval = raw === 'annual' ? 'annual' : 'monthly';

  const buyHref = (plan: 'pro' | 'team') =>
    signedIn ? `/billing?plan=${plan}&interval=${interval}` : '/signup';

  return (
    <MarketingShell signedIn={signedIn}>
      <section className="mx-auto w-full max-w-5xl px-6 pb-10 pt-14 sm:pt-20">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-fg-subtle">Pricing</p>
        <h1 className="mt-3 max-w-3xl text-3xl font-semibold leading-[1.15] tracking-tight sm:text-4xl">
          The whole product is free. Paying raises the ceiling, and adds a team.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-fg-muted">
          Toolgraph is MIT licensed and self-hostable, so nothing you build here can be taken away
          from you. The paid plans fund the hosted side of it, and they are billed in cryptocurrency
          because there is no card processor behind this project.
        </p>

        <div className="mt-8">
          <IntervalToggle interval={interval} savingPercent={annualSavingPercent('pro')} />
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-6 pb-14">
        <div className="grid gap-4 md:grid-cols-3">
          <PlanCard
            plan="free"
            interval={interval}
            cta={signedIn ? 'Open your graphs' : 'Start free'}
            ctaHref={signedIn ? '/graphs' : '/signup'}
          />
          <PlanCard
            plan="pro"
            interval={interval}
            emphasis
            cta={signedIn ? 'Pay with crypto' : 'Create an account'}
            ctaHref={buyHref('pro')}
            {...(signedIn
              ? {}
              : {
                  note: 'You need an account first — a payment is matched to it by the transaction hash you submit afterwards.',
                })}
          />
          <PlanCard
            plan="team"
            interval={interval}
            cta={signedIn ? 'Set up a team' : 'Create an account'}
            ctaHref={signedIn ? buyHref('team') : '/signup'}
            note="A Team plan pays for seats on a workspace, so you create the workspace first and then buy seats for it."
          />
        </div>
      </section>

      {/* The one thing on this page nobody should be able to miss. */}
      <section className="border-y border-border-subtle bg-bg-subtle">
        <div className="mx-auto w-full max-w-5xl px-6 py-14">
          <div className="rounded-[var(--tg-radius-lg)] border-2 border-border-strong bg-bg-raised p-6 sm:p-8">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 shrink-0 text-fg">
                <WarningIcon size={20} />
              </span>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold tracking-tight">Crypto only</h2>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-muted">
                  There is no card processor behind Toolgraph, so there are no cards, no PayPal and
                  no invoices. You transfer the amount for the plan you picked straight to our
                  address, then paste the transaction hash into your billing page. The server reads
                  that transaction off the chain itself and switches the subscription on once it
                  confirms — usually a minute or two, longer for Bitcoin.
                </p>
                <p className="mt-3 max-w-2xl text-sm leading-relaxed text-fg-muted">
                  Until that check passes, your account shows the payment as pending rather than
                  active. A transfer also cannot be reversed the way a card charge can, so the
                  address and the network are worth reading twice before you send.
                </p>

                <ul className="mt-5 grid gap-2 sm:grid-cols-3">
                  {PAYMENT_ADDRESSES.map((entry) => (
                    <li
                      key={entry.currency}
                      className="rounded-[var(--tg-radius-md)] border border-border p-3"
                    >
                      <p className="text-sm font-semibold tracking-tight">{entry.label}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">
                        {entry.network}
                      </p>
                    </li>
                  ))}
                </ul>

                <p className="mt-4 text-xs leading-relaxed text-fg-subtle">
                  The receiving addresses are shown on your billing page after you sign in, next to
                  the exact amount to send at the current rate.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-6 py-14">
        <h2 className="text-xl font-semibold tracking-tight">Questions people actually ask</h2>
        <div className="mt-6 grid gap-8 sm:grid-cols-2">
          <div className="border-t border-border-subtle pt-5">
            <h3 className="text-sm font-semibold tracking-tight">
              Is annual really cheaper, or just presented that way?
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">
              Really cheaper. Pro is ${PLANS.pro.monthlyUsd} a month, which is $
              {PLANS.pro.monthlyUsd * 12} over a year, against ${PLANS.pro.annualUsd} paid annually
              — two months free. Team is the same shape per seat. The annual figure is a separate
              price in the code, not a discount applied to the monthly one at display time.
            </p>
          </div>
          <div className="border-t border-border-subtle pt-5">
            <h3 className="text-sm font-semibold tracking-tight">
              What does the Team plan actually get me?
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">
              A workspace: graphs everyone in it can open and edit, connections shared without
              sharing their credentials, owner and admin and member roles, invitations by email, and
              seat-based billing. Those features are built — the plan pays for the hosted runner at
              team volume rather than unlocking them.
            </p>
          </div>
          <div className="border-t border-border-subtle pt-5">
            <h3 className="text-sm font-semibold tracking-tight">
              What happens if I pay the wrong amount?
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">
              Anything within 2 percent of the price is accepted, which covers the drift between
              quoting a rate and the transaction landing. Below that, the submission is rejected
              with the value we read, and you can send the difference as a second transaction.
            </p>
          </div>
          <div className="border-t border-border-subtle pt-5">
            <h3 className="text-sm font-semibold tracking-tight">Do I have to cancel?</h3>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">
              No. Nothing recurs, because nothing is stored that could charge you again. Access
              lasts for the period you paid for and then stops — and paying again before it ends
              adds to the end rather than replacing it.
            </p>
          </div>
          <div className="border-t border-border-subtle pt-5">
            <h3 className="text-sm font-semibold tracking-tight">Is there a refund?</h3>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">
              A blockchain transfer cannot be reversed by us or by your wallet, so there is no
              chargeback to offer. That is the honest answer, and it is the reason the free plan is
              the whole product rather than a demo.
            </p>
          </div>
          <div className="border-t border-border-subtle pt-5">
            <h3 className="text-sm font-semibold tracking-tight">
              What if the price feed is down when I pay?
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">
              Your payment is recorded as pending and reviewed by hand. A price API of ours being
              unavailable is not a reason to take somebody&apos;s money and refuse them.
            </p>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
