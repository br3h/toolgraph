import type { Metadata } from 'next';

import { MarketingShell, REPO } from '@/components/marketing/MarketingShell';
import { Prose } from '@/components/marketing/Prose';
import { getCurrentUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Security | Toolgraph',
  description:
    'How Toolgraph isolates tenants, stores credentials, defends against SSRF, and what it deliberately does not claim.',
  alternates: { canonical: '/security' },
};

export default async function SecurityPage() {
  const signedIn = Boolean(await getCurrentUser());

  return (
    <MarketingShell signedIn={signedIn}>
      <div className="mx-auto w-full max-w-5xl px-6 py-14 sm:py-20">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-fg-subtle">Security</p>
        <h1 className="mt-3 max-w-3xl text-3xl font-semibold leading-[1.15] tracking-tight sm:text-4xl">
          What protects your data, and what we do not claim
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-fg-muted">
          Toolgraph holds URLs of internal servers and tokens that open them. That is worth
          stealing, so this page says exactly what stands in the way — and every claim on it is
          checkable against the source, because the source is public.
        </p>

        <Prose>
          <h2>Tenant isolation</h2>
          <p>
            Every table is protected by Postgres row level security, with one policy per operation
            and nothing granted to anonymous requests at all — an unauthenticated request is refused
            by the grant layer before RLS is even consulted. Application code never filters by
            owner: the database decides what a query can see, so there is no filter that can be
            forgotten.
          </p>
          <p>
            Update policies carry both a <code>using</code> and a <code>with check</code> clause.
            Without the second, a user could update their own row and set its owner to somebody else
            — the row passes the visibility test on the way in and nothing checks it on the way out.
            There is a regression test for that specific hole.
          </p>
          <p>
            The isolation suite runs on every commit against a real Postgres, with two real users,
            and asserts both halves: that user B cannot see user A&apos;s rows, and that user B can
            still see their own. &ldquo;Sees nothing&rdquo; is too easy to satisfy by accident.
          </p>

          <h2>Credentials</h2>
          <p>
            A saved connection credential is encrypted with AES-256-GCM before it reaches the
            database. The key lives in the server environment, not in Postgres, so a database backup
            on its own contains nothing usable.
          </p>
          <p>Three independent things have to fail before one leaks:</p>
          <ul>
            <li>
              The table is granted to the server role only — not to authenticated users. No browser
              token can read it by any query.
            </li>
            <li>
              Row level security is on with no policies at all. Even a restored grant sees nothing.
            </li>
            <li>The ciphertext is keyed outside the database, and bound to its connection id.</li>
          </ul>
          <p>
            Plaintext exists for the duration of one outbound request to the server you pointed the
            connection at. It is never sent to a browser, never logged, never included in an error
            message, never sent to error monitoring or analytics, and never in a data export.
          </p>

          <h2>Server-side request forgery</h2>
          <p>
            Toolgraph connects to URLs that users supply, which makes the execution engine an SSRF
            target by construction. The guard blocks private, loopback, link-local and
            cloud-metadata address ranges, and — this is the part that is usually missed — it
            re-checks after DNS resolution, so a hostname that resolves to an internal address is
            refused even though the name looked public.
          </p>
          <p>
            The engine refuses to start at all if the flag that relaxes this is set while NODE_ENV
            is production. A running-but-unguarded engine is worse than one that visibly failed to
            boot.
          </p>

          <h2>The browser</h2>
          <p>
            A Content-Security-Policy with a per-request nonce, emitted from middleware rather than
            build-time config — a nonce that is the same on every response is not a nonce. No
            <code>eval</code> in production, no framing, object sources denied, and a connect
            allowlist built from the origins the app actually talks to.
          </p>
          <p>
            HSTS with a two-year max-age and subdomains included, nosniff, a strict referrer policy,
            and a permissions policy that denies every device API Toolgraph has no use for.
          </p>
          <p>
            The build fails if a server-only environment variable name is found in a browser chunk,
            and the deploy additionally greps the shipped bundle for the actual secret values.
          </p>

          <h2>Rate limiting</h2>
          <p>
            Each abuse surface has its own policy rather than sharing one global number, because the
            surfaces differ in what abuse costs: a wrong sign-in costs a hash, an export costs a
            synchronous compile, an invitation costs somebody else&apos;s inbox. Signing in,
            starting OAuth, testing connections, generating code, submitting payments, sending
            invitations, exporting your data and deleting your account are each metered separately,
            keyed by account where there is one and by address where there is not.
          </p>

          <h2>Payments</h2>
          <p>
            Nothing in the product treats an unverified payment as entitlement. A submitted
            transaction hash is a claim; only a payment the server has read off the chain, for an
            amount it computed itself, grants access. A database unique constraint on the
            transaction hash makes replaying one real payment across accounts impossible — a check
            in application code would lose that race.
          </p>

          <h2>What Toolgraph does not claim</h2>
          <p>
            No SOC 2. No ISO 27001. No penetration test report. No compliance programme. Toolgraph
            has none of those things and saying otherwise on a marketing page would be the least
            trustworthy thing on it.
          </p>
          <p>
            There is no formal uptime commitment, and the execution engine deliberately runs on a
            free plan that sleeps. Accessibility has been designed for but not audited against WCAG
            by anyone qualified to certify it.
          </p>
          <p>
            What there is instead: the whole implementation is MIT licensed and public, so none of
            the above has to be taken on trust.
          </p>

          <h2>Reporting something</h2>
          <p>
            If you find a vulnerability, please report it privately rather than opening a public
            issue. The process is in{' '}
            <a href={`${REPO}/blob/main/SECURITY.md`} target="_blank" rel="noreferrer noopener">
              SECURITY.md
            </a>
            .
          </p>
        </Prose>
      </div>
    </MarketingShell>
  );
}
