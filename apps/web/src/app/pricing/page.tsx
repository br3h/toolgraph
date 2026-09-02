import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { SuccessIcon, ThemeToggle, WarningIcon } from '@toolgraph/ui';

import { getCurrentUser } from '@/lib/supabase/server';
import { PAYMENT_ADDRESSES, PLAN_INTERVAL_DAYS, PLAN_PRICE_USD } from '@/lib/billing/plan';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Toolgraph is free and MIT licensed. Pro is $15 a month, paid in cryptocurrency — there is no card processor, and a subscription starts once the transaction confirms on-chain.',
};

export const dynamic = 'force-dynamic';

const REPO = 'https://github.com/br3h/toolgraph';

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

export default async function PricingPage() {
  // Public page: signed out is the common case, and the CTA is the only thing
  // the session changes.
  const user = await getCurrentUser();
  const signedIn = Boolean(user);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-border-subtle bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <Image
              src="/toolgraph.png"
              alt=""
              width={22}
              height={22}
              className="rounded"
              priority
            />
            <span className="text-sm font-semibold tracking-tight">Toolgraph</span>
          </Link>

          <nav className="flex items-center gap-1.5">
            <a
              href={REPO}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-[var(--tg-radius-sm)] px-2.5 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:text-fg"
            >
              GitHub
            </a>
            <ThemeToggle />
            {signedIn ? (
              <>
                <Link
                  href="/graphs"
                  className="rounded-[var(--tg-radius-sm)] px-2.5 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:text-fg"
                >
                  Your graphs
                </Link>
                <Link
                  href="/billing"
                  className="rounded-[var(--tg-radius-sm)] bg-accent px-3 py-1.5 text-xs font-semibold text-fg-on-accent transition-opacity hover:opacity-90"
                >
                  Billing
                </Link>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="rounded-[var(--tg-radius-sm)] px-2.5 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:text-fg"
                >
                  Sign in
                </Link>
                <Link
                  href="/signup"
                  className="rounded-[var(--tg-radius-sm)] bg-accent px-3 py-1.5 text-xs font-semibold text-fg-on-accent transition-opacity hover:opacity-90"
                >
                  Get started
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto w-full max-w-5xl px-6 pb-12 pt-14 sm:pt-20">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-fg-subtle">Pricing</p>
          <h1 className="mt-3 max-w-3xl text-3xl font-semibold leading-[1.15] tracking-tight sm:text-4xl">
            The whole product is free. Pro pays for the hosted parts.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-fg-muted">
            Toolgraph is MIT licensed and self-hostable, so nothing you build here can be taken away
            from you. The paid plan exists to fund the hosted side of it, and it is billed in
            cryptocurrency because there is no card processor behind this project.
          </p>
        </section>

        <section className="mx-auto w-full max-w-5xl px-6 pb-14">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Free */}
            <div className="flex flex-col rounded-[var(--tg-radius-lg)] border border-border-subtle bg-bg-raised p-6">
              <h2 className="text-sm font-semibold tracking-tight">Free</h2>
              <p className="mt-3 flex items-baseline gap-1.5">
                <span className="text-3xl font-semibold tracking-tight">$0</span>
                <span className="text-sm text-fg-muted">forever</span>
              </p>
              <p className="mt-3 text-sm leading-relaxed text-fg-muted">
                Everything the product does. No trial, no seat count, no feature held back to make
                the paid plan look better.
              </p>

              <ul className="mt-5 space-y-2.5">
                <PlanFeature>Unlimited graphs on the canvas</PlanFeature>
                <PlanFeature>
                  Every connection type-checked against the tools&apos; real JSON Schemas
                </PlanFeature>
                <PlanFeature>Connect your own MCP servers over streamable HTTP or SSE</PlanFeature>
                <PlanFeature>Export to TypeScript or Python you own outright</PlanFeature>
                <PlanFeature>Hosted test-runs, at the standard rate limit</PlanFeature>
                <PlanFeature>Self-host the whole thing — it is MIT licensed</PlanFeature>
              </ul>

              <div className="mt-6 pt-2">
                <Link
                  href={signedIn ? '/graphs' : '/signup'}
                  className="inline-flex items-center rounded-[var(--tg-radius-md)] border border-border px-5 py-2.5 text-sm font-medium text-fg transition-colors hover:bg-bg-sunken"
                >
                  {signedIn ? 'Open your graphs' : 'Start free'}
                </Link>
              </div>
            </div>

            {/* Pro — heavier frame, because weight is how emphasis is expressed here. */}
            <div className="flex flex-col rounded-[var(--tg-radius-lg)] border-2 border-border-strong bg-bg-raised p-6">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold tracking-tight">Pro</h2>
                <span className="rounded-[var(--tg-radius-sm)] border border-border px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">
                  Crypto only
                </span>
              </div>
              <p className="mt-3 flex items-baseline gap-1.5">
                <span className="text-3xl font-semibold tracking-tight">${PLAN_PRICE_USD}</span>
                <span className="text-sm text-fg-muted">per month</span>
              </p>
              <p className="mt-3 text-sm leading-relaxed text-fg-muted">
                The same product, plus a higher ceiling on the hosted runner. Mostly it is a way to
                pay for something you use and want to keep running.
              </p>

              <ul className="mt-5 space-y-2.5">
                <PlanFeature>Everything in Free</PlanFeature>
                <PlanFeature>Hosted test-runs at a higher rate limit</PlanFeature>
                <PlanFeature>Directly funds the work on Toolgraph</PlanFeature>
                <PlanFeature>Paid in ETH, USDT (ERC-20 on Ethereum mainnet) or BTC</PlanFeature>
                <PlanFeature>
                  Nothing renews on its own: each payment adds {PLAN_INTERVAL_DAYS} days, and there
                  is nothing to cancel
                </PlanFeature>
              </ul>

              <div className="mt-6 pt-2">
                <Link
                  href={signedIn ? '/billing' : '/signup'}
                  className="inline-flex items-center rounded-[var(--tg-radius-md)] bg-accent px-5 py-2.5 text-sm font-semibold text-fg-on-accent transition-opacity hover:opacity-90"
                  data-testid="pricing-pro-cta"
                >
                  {signedIn ? 'Pay with crypto' : 'Create an account'}
                </Link>
                {!signedIn ? (
                  <p className="mt-2.5 text-xs text-fg-subtle">
                    You need an account first — a payment is matched to it by the transaction hash
                    you submit afterwards.
                  </p>
                ) : null}
              </div>
            </div>
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
                    There is no card processor behind Toolgraph, so there are no cards, no PayPal
                    and no invoices. You transfer ${PLAN_PRICE_USD} worth of currency straight to
                    our address, then paste the transaction hash into your billing page. The server
                    reads that transaction off the chain itself and switches the subscription on
                    once it confirms — usually a minute or two, longer for Bitcoin.
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
                    The receiving addresses are shown on your billing page after you sign in, next
                    to the exact amount to send at the current rate.
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
                What happens if I pay the wrong amount?
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-fg-muted">
                Anything within 2 percent of ${PLAN_PRICE_USD} is accepted, which covers the drift
                between quoting a rate and the transaction landing. Below that, the submission is
                rejected with the value we read, and you can send the difference as a second
                transaction.
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
            <div className="border-t border-border-subtle pt-5">
              <h3 className="text-sm font-semibold tracking-tight">Is there a refund?</h3>
              <p className="mt-2 text-sm leading-relaxed text-fg-muted">
                A blockchain transfer cannot be reversed by us or by your wallet, so there is no
                chargeback to offer. That is the honest answer, and it is the reason the free plan
                is the whole product rather than a demo.
              </p>
            </div>
            <div className="border-t border-border-subtle pt-5">
              <h3 className="text-sm font-semibold tracking-tight">Do I have to cancel?</h3>
              <p className="mt-2 text-sm leading-relaxed text-fg-muted">
                No. Nothing recurs, because nothing is stored that could charge you again. Access
                lasts {PLAN_INTERVAL_DAYS} days per payment and then stops.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border-subtle">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-6 py-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-fg-subtle">
            Toolgraph — type-checked MCP tool graphs. MIT licensed.
          </p>
          <nav className="flex flex-wrap items-center gap-4 text-xs">
            <Link href="/" className="text-fg-muted transition-colors hover:text-fg">
              Home
            </Link>
            <a
              href={REPO}
              target="_blank"
              rel="noreferrer noopener"
              className="text-fg-muted transition-colors hover:text-fg"
            >
              Source
            </a>
            <a
              href={`${REPO}/blob/main/LICENSE`}
              target="_blank"
              rel="noreferrer noopener"
              className="text-fg-muted transition-colors hover:text-fg"
            >
              Licence
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
