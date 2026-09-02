import { notFound, redirect } from 'next/navigation';

import { GraphEditor } from '@/components/GraphEditor';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { parseDocument } from '@/lib/graph-document';

export const dynamic = 'force-dynamic';

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

  return (
    <GraphEditor
      graphId={String(graph.id)}
      initialTitle={title}
      initialDocument={parseDocument(graph.graph_json, title)}
      userEmail={user.email}
    />
  );
}
