import type { Metadata } from 'next';

import { MarketingShell } from '@/components/marketing/MarketingShell';
import { Prose } from '@/components/marketing/Prose';
import { getCurrentUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Privacy | Toolgraph',
  description:
    'What Toolgraph stores, what it deliberately does not store, who processes it, and how to export or delete everything.',
  alternates: { canonical: '/privacy' },
};

/**
 * Written as a description of what the code actually does, not as a legal
 * template. Every statement here is checkable against the repository, and where
 * something is not implemented it says so rather than reaching for a phrase
 * that sounds like a commitment.
 */
export default async function PrivacyPage() {
  const signedIn = Boolean(await getCurrentUser());

  return (
    <MarketingShell signedIn={signedIn}>
      <div className="mx-auto w-full max-w-5xl px-6 py-14 sm:py-20">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-fg-subtle">Privacy</p>
        <h1 className="mt-3 max-w-3xl text-3xl font-semibold leading-[1.15] tracking-tight sm:text-4xl">
          What Toolgraph stores about you
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-fg-muted">
          This is a description of what the software does, not a template. Everything below is
          checkable against the source.
        </p>

        <Prose>
          <h2>What is stored</h2>
          <ul>
            <li>
              <strong>Your account</strong> — email address, and a password hash if you use one.
              Held by Supabase Auth. If you sign in with GitHub, your GitHub username and email as
              GitHub reports them.
            </li>
            <li>
              <strong>An optional display name</strong>, if you set one, so people in your
              workspaces see a name rather than an address.
            </li>
            <li>
              <strong>Your graphs</strong> — nodes, edges, positions, and the JSON Schemas the
              servers advertised. Never a credential: the graph document has no field one could
              occupy.
            </li>
            <li>
              <strong>Your connections</strong> — a name, a URL or command, and health: when it was
              last reached and why it last failed.
            </li>
            <li>
              <strong>Connection credentials</strong>, if you save one — encrypted, under a key that
              is not in the database.
            </li>
            <li>
              <strong>Run summaries</strong> — that a run happened, when, how long it took, how many
              steps, and an error summary if it failed.
            </li>
            <li>
              <strong>Payments</strong> — the transaction hashes you submitted, what plan they were
              for, and what was decided about them.
            </li>
          </ul>

          <h2>What is deliberately not stored</h2>
          <ul>
            <li>
              <strong>Per-step inputs and outputs of a run.</strong> They stream to your browser and
              are never written down. If a tool returns customer data, that data does not land in
              Toolgraph&apos;s database.
            </li>
            <li>
              <strong>Anything in analytics that could identify what you are building.</strong> No
              server URL, no tool name, no field name, no graph contents — only counts, booleans and
              enumerated values. Events are keyed to an account id, never an email address.
            </li>
            <li>
              <strong>Credentials in any readable form</strong>, anywhere: not in logs, not in error
              monitoring, not in exports, not in generated code.
            </li>
          </ul>

          <h2>Who else processes it</h2>
          <p>
            Toolgraph is a small project and uses ordinary infrastructure rather than running its
            own. In each case the provider processes data on our behalf:
          </p>
          <ul>
            <li>
              <strong>Supabase</strong> — database and authentication. Everything above except what
              follows.
            </li>
            <li>
              <strong>Vercel</strong> — hosting for the web app. Request logs.
            </li>
            <li>
              <strong>Render</strong> — hosting for the execution engine. Request logs, with
              authorization headers and credential fields redacted before they are written.
            </li>
            <li>
              <strong>Upstash</strong> — rate limiting. Counters keyed by account id or address.
            </li>
            <li>
              <strong>Resend</strong> — transactional email. Your address, when we send you
              something.
            </li>
            <li>
              <strong>Sentry</strong> — error monitoring, with credential fields scrubbed.
            </li>
            <li>
              <strong>PostHog</strong> — product analytics, subject to the constraint above.
            </li>
          </ul>
          <p>
            When you run a graph, the engine connects to whatever servers you pointed it at, on your
            behalf. Those are your servers and your relationship with whoever operates them.
          </p>

          <h2>Getting it out, and getting rid of it</h2>
          <p>
            Settings → Data &amp; privacy has a download of everything, as one JSON file, and a
            delete button that actually deletes. Deletion removes your account and — by database
            cascade rather than by a list of steps that could be incomplete — your graphs, their
            version history, your connections and their stored credentials, your run records, your
            profile, your workspace memberships, and your payment records.
          </p>
          <p>
            The one thing deletion refuses to do is destroy a workspace other people are in. If you
            own one, transfer it or remove the members first; that data is theirs as much as yours.
          </p>
          <p>
            Backups held by our infrastructure providers roll off on their own schedules, so a
            deleted account can persist in a Supabase backup for a period after deletion. That is
            true of every hosted product and it would be dishonest to imply otherwise.
          </p>

          <h2>Cookies</h2>
          <p>
            The session cookie, which is required to be signed in — it is HTTP-only, secure, and
            same-site. A theme preference in local storage, which never leaves your browser. If
            analytics is configured on a deployment, PostHog sets its own.
          </p>

          <h2>Changes, and getting in touch</h2>
          <p>
            This page changes when the software does, and the software&apos;s history is public. For
            anything about your own data, open an issue or email the address in the repository.
          </p>
        </Prose>
      </div>
    </MarketingShell>
  );
}
