import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { EmptyState } from '@toolgraph/ui';

import { AppShell } from '@/components/AppShell';
import { GraphCard, type GraphSummary } from '@/components/GraphCard';
import { NewGraphButton } from '@/components/NewGraphButton';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { parseDocument } from '@/lib/graph-document';

export const metadata: Metadata = { title: 'Your graphs' };
export const dynamic = 'force-dynamic';

export default async function GraphsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const supabase = await createClient();
  // RLS restricts this to the caller's rows; no `.eq('owner', ...)` is needed
  // and adding one would imply the filter is what protects the data.
  const { data, error } = await supabase
    .from('graphs')
    .select('id, title, updated_at, graph_json')
    .order('updated_at', { ascending: false })
    .limit(100);

  const graphs: GraphSummary[] = (data ?? []).map((row) => ({
    id: String(row.id),
    title: String(row.title),
    updatedAt: String(row.updated_at),
    nodeCount: parseDocument(row.graph_json).nodes.filter((n) => n.kind === 'mcpTool').length,
  }));

  return (
    <AppShell email={user.email}>
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Your graphs</h1>
            <p className="mt-1 text-sm text-fg-muted">
              Each graph wires MCP tools together, type-checked before it runs.
            </p>
          </div>
          <NewGraphButton />
        </div>

        {error ? (
          <div className="mt-8 rounded-[var(--tg-radius-lg)] border border-border-strong p-4">
            <p className="text-sm font-medium">Your graphs could not be loaded.</p>
            <p className="mt-1 text-sm text-fg-muted">{error.message}</p>
          </div>
        ) : null}

        <div className="mt-8" data-testid="graph-list">
          {graphs.length === 0 ? (
            <EmptyState
              title="No graphs yet"
              description="Create one, connect an MCP server, and wire its tools together. Every connection is checked against the tools' real schemas before it can run."
              action={<NewGraphButton size="md" />}
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {graphs.map((graph) => (
                <GraphCard key={graph.id} graph={graph} />
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
