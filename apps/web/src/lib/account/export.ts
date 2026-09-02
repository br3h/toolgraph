import 'server-only';

/**
 * "Download everything you have of mine."
 *
 * Assembled entirely through the RLS-scoped client, so the export is defined by
 * what the caller is allowed to read rather than by a filter written here. That
 * is the property that makes it safe: there is no code path in this file that
 * could be made to include another account's row, because none of it can see one.
 *
 * What is deliberately NOT in the bundle:
 *
 *   * Any credential, in any form. Not the ciphertext, not a hint, not a length.
 *     An export is a file that ends up in a downloads folder, an email, a
 *     support ticket. `hasCredential` is a boolean and that is the whole story.
 *   * Other members' email addresses from shared workspaces. The requester's
 *     own data is theirs; a colleague's address is not.
 */

import { createClient } from '@/lib/supabase/server';

export interface AccountExport {
  exportedAt: string;
  format: 'toolgraph.account-export.v1';
  account: { id: string; email: string | null; createdAt: string | null };
  profile: { displayName: string | null } | null;
  graphs: unknown[];
  connections: unknown[];
  runs: unknown[];
  workspaces: unknown[];
  subscription: unknown;
  notes: string[];
}

export async function buildAccountExport(user: {
  id: string;
  email?: string | undefined;
  created_at?: string | undefined;
}): Promise<AccountExport> {
  const supabase = await createClient();

  const [graphs, connections, runs, memberships, profile, subscription] = await Promise.all([
    supabase
      .from('graphs')
      .select('id, title, graph_json, workspace_id, created_at, updated_at')
      .order('created_at', { ascending: true })
      .limit(1000),
    // Note the columns: no `tools_cache` (large, and re-derivable by testing the
    // connection) and — far more importantly — nothing from connection_secrets.
    supabase
      .from('mcp_server_connections')
      .select(
        'id, name, provider, transport, url, command, args, workspace_id, status, ' +
          'last_success_at, tool_count, has_credential, created_at',
      )
      .order('created_at', { ascending: true })
      .limit(500),
    supabase
      .from('execution_runs')
      .select('id, graph_id, status, started_at, finished_at, step_count, error_summary')
      .order('started_at', { ascending: false })
      .limit(1000),
    supabase
      .from('workspace_members')
      .select('role, created_at, workspace:workspaces!inner(id, name, slug)')
      .limit(50),
    supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle(),
    supabase
      .from('subscriptions')
      .select('status, plan, billing_interval, seats, current_period_end, created_at')
      .maybeSingle(),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    format: 'toolgraph.account-export.v1',
    account: {
      id: user.id,
      email: user.email ?? null,
      createdAt: user.created_at ?? null,
    },
    profile: profile.data ? { displayName: (profile.data.display_name as string) ?? null } : null,
    graphs: graphs.data ?? [],
    connections: connections.data ?? [],
    runs: runs.data ?? [],
    workspaces: memberships.data ?? [],
    subscription: subscription.data ?? null,
    notes: [
      'Graph documents are complete: every node, edge and JSON Schema is here, so a graph can be rebuilt from this file alone.',
      'Connection credentials are NOT included, by design. They are encrypted at rest and are never exported — hasCredential records only whether one exists.',
      'Per-step execution detail is not stored by Toolgraph at all; only the run summaries above exist to export.',
      'Runs are capped at the most recent 1000 and graphs at 1000. Get in touch if you have more than that.',
      'Members of workspaces you belong to are not listed here: their email addresses are their data, not yours.',
    ],
  };
}
