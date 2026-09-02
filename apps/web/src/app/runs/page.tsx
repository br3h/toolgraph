import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge, EmptyState } from '@toolgraph/ui';

import { AppShell } from '@/components/AppShell';
import { createClient, getCurrentUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

const TIME = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
});

const STATUS_LABEL: Record<string, string> = {
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/** "1.4s" / "2m 05s" — a duration, not a millisecond count. */
function duration(startedAt: string, finishedAt: string | null): string {
  if (!finishedAt) return '—';
  const ms = Date.parse(finishedAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

export default async function RunsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const supabase = await createClient();
  // RLS decides the row set: the caller's own runs, plus runs against graphs
  // shared with a workspace they are in. No filter here, deliberately.
  const { data, error } = await supabase
    .from('execution_runs')
    .select(
      'id, graph_id, status, started_at, finished_at, step_count, error_summary, graph:graphs(title)',
    )
    .order('started_at', { ascending: false })
    .limit(100);

  const runs = (data ?? []) as unknown as Array<{
    id: string;
    graph_id: string;
    status: string;
    started_at: string;
    finished_at: string | null;
    step_count: number;
    error_summary: string | null;
    graph: { title: string } | null;
  }>;

  return (
    <AppShell email={user.email} active="runs">
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <h1 className="text-xl font-semibold tracking-tight">Runs</h1>
        <p className="mt-1 max-w-2xl text-sm text-fg-muted">
          Every test-run of a graph, most recent first. Per-step inputs and outputs are streamed to
          the browser as a run happens and are deliberately never stored — so what is here is when
          it ran, how long it took, and where it stopped.
        </p>

        {error ? (
          <div className="mt-8 rounded-[var(--tg-radius-lg)] border border-border-strong p-4">
            <p className="text-sm font-medium">Your runs could not be loaded.</p>
            <p className="mt-1 text-sm text-fg-muted">{error.message}</p>
          </div>
        ) : null}

        <div className="mt-8">
          {runs.length === 0 ? (
            <EmptyState
              title="Nothing has run yet"
              description="Open a graph, connect its tools, and press Run. Each execution is recorded here so you can see what happened afterwards."
              action={
                <Link
                  href="/graphs"
                  className="inline-flex items-center rounded-[var(--tg-radius-md)] bg-accent px-4 py-2 text-sm font-semibold text-fg-on-accent transition-opacity hover:opacity-90"
                >
                  Go to your graphs
                </Link>
              }
            />
          ) : (
            <div className="overflow-x-auto rounded-[var(--tg-radius-lg)] border border-border-subtle">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border-subtle bg-bg-subtle text-xs uppercase tracking-[0.08em] text-fg-subtle">
                    <th scope="col" className="px-4 py-2.5 font-medium">
                      Graph
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-medium">
                      Started
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-medium">
                      Took
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-medium">
                      Steps
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-medium">
                      Result
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id} className="border-b border-border-subtle last:border-0">
                      <td className="px-4 py-3">
                        <Link
                          href={`/graphs/${run.graph_id}`}
                          className="font-medium text-fg underline-offset-2 hover:underline"
                        >
                          {run.graph?.title ?? 'Deleted graph'}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-fg-muted">
                        {TIME.format(new Date(run.started_at))}
                      </td>
                      <td className="px-4 py-3 text-fg-muted">
                        {duration(run.started_at, run.finished_at)}
                      </td>
                      <td className="px-4 py-3 text-fg-muted">{run.step_count}</td>
                      <td className="px-4 py-3">
                        <Badge variant={run.status === 'succeeded' ? 'strong' : 'subtle'}>
                          {STATUS_LABEL[run.status] ?? run.status}
                        </Badge>
                        {run.error_summary ? (
                          <p className="mt-1 max-w-md text-xs leading-relaxed text-fg-subtle">
                            {run.error_summary}
                          </p>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
