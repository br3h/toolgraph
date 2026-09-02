import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AppShell } from '@/components/AppShell';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { getSubscriptionState } from '@/lib/billing/subscription';
import { PLANS } from '@/lib/billing/plan';
import { POLICIES } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Every number on this page is a `count` from a real table, or a constant read
 * from the rate-limit policy table that actually governs the endpoint. Nothing
 * is estimated, projected or rounded up to look busier — a usage page that
 * invents a figure is worse than no usage page, because it is the screen people
 * check when they think they are being overcharged.
 */
function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-[var(--tg-radius-lg)] border border-border-subtle bg-bg-raised p-4">
      <p className="text-xs font-medium uppercase tracking-[0.1em] text-fg-subtle">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      {hint ? <p className="mt-1 text-xs leading-relaxed text-fg-subtle">{hint}</p> : null}
    </div>
  );
}

export default async function UsagePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const supabase = await createClient();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const [graphs, connections, runsAll, runs30, failed30, subscription] = await Promise.all([
    supabase.from('graphs').select('id', { count: 'exact', head: true }),
    supabase.from('mcp_server_connections').select('id', { count: 'exact', head: true }),
    supabase.from('execution_runs').select('id', { count: 'exact', head: true }),
    supabase
      .from('execution_runs')
      .select('id', { count: 'exact', head: true })
      .gte('started_at', thirtyDaysAgo),
    supabase
      .from('execution_runs')
      .select('id', { count: 'exact', head: true })
      .gte('started_at', thirtyDaysAgo)
      .eq('status', 'failed'),
    getSubscriptionState(user.id),
  ]);

  const plan = PLANS[subscription.plan];
  const active = subscription.status === 'active';

  return (
    <AppShell email={user.email} active="usage">
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <h1 className="text-xl font-semibold tracking-tight">Usage</h1>
        <p className="mt-1 max-w-2xl text-sm text-fg-muted">
          What is in this account, and the limits that apply to it. Every figure is counted from the
          database rather than estimated.
        </p>

        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Graphs" value={graphs.count ?? 0} hint="No cap on any plan." />
          <Stat
            label="Connections"
            value={connections.count ?? 0}
            hint="Includes connections shared with you."
          />
          <Stat
            label="Runs, last 30 days"
            value={runs30.count ?? 0}
            hint={`${failed30.count ?? 0} failed`}
          />
          <Stat label="Runs, all time" value={runsAll.count ?? 0} />
        </div>

        <section className="mt-8 rounded-[var(--tg-radius-lg)] border border-border-subtle bg-bg-raised p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold tracking-tight">Your plan</h2>
              <p className="mt-1 text-sm text-fg-muted">
                {active
                  ? `${plan.name}${subscription.plan === 'team' ? `, ${subscription.seats} seats` : ''}, billed ${subscription.billingInterval === 'annual' ? 'annually' : 'monthly'}.`
                  : 'Free. The whole product, at the standard rate limit.'}
              </p>
            </div>
            <Link
              href="/billing"
              className="text-xs font-medium text-fg-muted transition-colors hover:text-fg"
            >
              {active ? 'Manage' : 'See plans'}
            </Link>
          </div>
        </section>

        <section className="mt-5 rounded-[var(--tg-radius-lg)] border border-border-subtle bg-bg-raised p-5">
          <h2 className="text-sm font-semibold tracking-tight">Rate limits</h2>
          <p className="mt-1 text-sm leading-relaxed text-fg-muted">
            These are per account and are what the server actually enforces — the numbers below are
            read from the same policy table the endpoints use, so this page cannot drift from the
            behaviour.
          </p>
          <dl className="mt-4 space-y-3">
            {(
              [
                ['Test a connection', 'connectionTest'],
                ['Export a graph as code', 'export'],
                ['Download your account data', 'dataExport'],
                ['Invite someone to a workspace', 'invite'],
                ['Submit a payment', 'billingSubmit'],
              ] as const
            ).map(([label, surface]) => {
              const policy = POLICIES[surface];
              const window =
                policy.windowSeconds >= 3600
                  ? `${policy.windowSeconds / 3600} hour${policy.windowSeconds === 3600 ? '' : 's'}`
                  : `${policy.windowSeconds} seconds`;
              return (
                <div
                  key={surface}
                  className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border-subtle pb-3 last:border-0 last:pb-0"
                >
                  <dt className="text-sm">{label}</dt>
                  <dd className="text-sm text-fg-muted">
                    {policy.limit} per {window}
                  </dd>
                </div>
              );
            })}
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-fg-subtle">
            Running a graph is limited by the execution engine rather than here, at 10 runs and 20
            server introspections a minute per account.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
