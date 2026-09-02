import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { GraphEditor } from '@/components/GraphEditor';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { parseDocument } from '@/lib/graph-document';
import { listConnections } from '@/lib/connections/store';

export const dynamic = 'force-dynamic';

// A graph is somebody's private infrastructure. Never indexed, and never
// followed — a crawler that reached one should not walk out of it either.
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** A graph id is always a uuid; anything else is a 404, not a database round trip. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadGraph(id: string) {
  if (!UUID.test(id)) return null;

  const supabase = await createClient();
  // RLS scopes this to the caller. A graph belonging to someone else comes back
  // as "not found", which is also the right thing to tell the user — confirming
  // that an id exists but is not theirs would leak the id space.
  const { data, error } = await supabase
    .from('graphs')
    .select('id, title, graph_json')
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

export default async function GraphEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const { id } = await params;
  const graph = await loadGraph(id);
  if (!graph) notFound();

  const title = String(graph.title);

  /*
   * Saved connections, as a LIST WITHOUT THEIR SCHEMAS.
   *
   * This is what makes Connections part of the editor rather than a separate
   * screen: a server set up once can be dropped onto any canvas without
   * re-typing its URL or waking the engine to rediscover what it offers.
   *
   * The tools are deliberately NOT loaded here. A cached tool set is every
   * tool's full JSON Schema, and twenty connections' worth would be megabytes
   * serialised into this page's payload — paid on every graph open, by every
   * user, to render a picker most of them will not touch. They are fetched by
   * `loadConnectionTools` when somebody actually picks one, which costs one
   * round trip on an explicit click.
   *
   * Only connections that have actually succeeded are offered. One that has
   * never been tested would import an empty palette, which is not a useful
   * thing to offer — the honest place to fix that is Connections, where the
   * status says so.
   */
  const importable = (await listConnections())
    .filter((connection) => connection.status === 'connected' && connection.toolCount > 0)
    .slice(0, 20);

  return (
    <GraphEditor
      graphId={String(graph.id)}
      initialTitle={title}
      initialDocument={parseDocument(graph.graph_json, title)}
      userEmail={user.email}
      savedConnections={importable}
    />
  );
}
