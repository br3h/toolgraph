import type { Metadata } from 'next';

import { MarketingShell, REPO } from '@/components/marketing/MarketingShell';
import { Prose } from '@/components/marketing/Prose';
import { getCurrentUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Terms | Toolgraph',
  description:
    'The terms of using the hosted Toolgraph service: what it does, what it does not promise, and what happens to your account.',
  alternates: { canonical: '/terms' },
};

export default async function TermsPage() {
  const signedIn = Boolean(await getCurrentUser());

  return (
    <MarketingShell signedIn={signedIn}>
      <div className="mx-auto w-full max-w-5xl px-6 py-14 sm:py-20">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-fg-subtle">Terms</p>
        <h1 className="mt-3 max-w-3xl text-3xl font-semibold leading-[1.15] tracking-tight sm:text-4xl">
          Terms of use
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-fg-muted">
          These cover the hosted service at this domain. The software itself is MIT licensed and its
          terms are in the repository.
        </p>

        <Prose>
          <h2>The service</h2>
          <p>
            Toolgraph lets you connect servers you control, check the compatibility of the tools
            they expose, run those tools, and export the result as code. An account is free; a paid
            plan raises the limits on the hosted execution engine.
          </p>

          <h2>Your account</h2>
          <p>
            You are responsible for what you do with it, for the servers you point it at, and for
            the credentials you give it. Do not use it to reach systems you are not authorised to
            reach — the SSRF guard is there to protect our infrastructure, not to make that your
            decision.
          </p>
          <p>
            One account is one person. Sharing with a team is what workspaces are for, and the Team
            plan is priced per seat because a seat is a person.
          </p>

          <h2>Payment</h2>
          <p>
            Paid plans are settled in cryptocurrency. A transfer cannot be reversed by us or by your
            wallet, so there is no chargeback and no refund to offer — which is the honest reason
            the free plan is the entire product rather than a demonstration of it.
          </p>
          <p>
            Nothing recurs. There is no stored payment method that could charge you again, and
            therefore nothing to cancel: access lasts for the period you paid for and then stops.
            Paying again before it ends extends it.
          </p>
          <p>
            A payment is credited when the server has read the transaction off the chain and
            confirmed it is worth the amount that was quoted. Until then it shows as pending and
            unlocks nothing.
          </p>

          <h2>What is not promised</h2>
          <p>
            No uptime guarantee. The execution engine runs on a free plan that sleeps after fifteen
            minutes of inactivity, which is a documented property rather than a fault. The service
            is provided as is, without warranty, and our liability is limited to what you have paid
            in the twelve months before a claim.
          </p>
          <p>
            Toolgraph is not certified against any compliance standard, and the{' '}
            <a href="/security">security page</a> lists what it does not claim.
          </p>

          <h2>Ending it</h2>
          <p>
            You can delete your account at any time from Settings, and it deletes. We may suspend an
            account that is being used to attack third parties, to abuse the execution engine, or in
            a way that puts other users at risk — and will say why.
          </p>
          <p>
            If the hosted service is ever discontinued, the software is MIT licensed and the exports
            have no Toolgraph dependency. Nothing you build here can be taken away by us shutting
            down; that is deliberate and it is why export exists.
          </p>

          <h2>The software itself</h2>
          <p>
            Separate from this service, Toolgraph is MIT licensed. The{' '}
            <a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noreferrer noopener">
              licence
            </a>{' '}
            governs the code; these terms govern the hosted instance.
          </p>
        </Prose>
      </div>
    </MarketingShell>
  );
}
