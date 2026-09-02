import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { EmptyState } from '@toolgraph/ui';

import { AppShell } from '@/components/AppShell';
import { ConnectionList } from '@/components/connections/ConnectionList';
import { NewConnectionButton } from '@/components/connections/NewConnectionButton';
import { getCurrentUser } from '@/lib/supabase/server';
import { listConnections } from '@/lib/connections/store';
import { listWorkspaces } from '@/lib/workspaces/store';
import { credentialStorageConfigured } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

// Authenticated, and describes one account's infrastructure. Never indexed.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ConnectionsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const [connections, workspaces] = await Promise.all([listConnections(), listWorkspaces()]);

  return (
    <AppShell email={user.email} active="connections">
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Connections</h1>
            <p className="mt-1 max-w-2xl text-sm text-fg-muted">
              A server you have told Toolgraph about, saved once and usable from any graph. Testing
              one reads its tools and their real JSON Schemas, and caches them so the canvas does
              not have to wake the engine to draw a palette.
            </p>
          </div>
          <NewConnectionButton
            workspaces={workspaces.map((w) => ({ id: w.id, name: w.name }))}
            credentialStorage={credentialStorageConfigured()}
          />
        </div>

        <div className="mt-8">
          {connections.length === 0 ? (
            <EmptyState
              title="No connections yet"
              description="Add an MCP server over streamable HTTP or SSE. Toolgraph reads the tools it advertises, then every graph you build can use them without you re-typing the URL or the token."
              action={
                <NewConnectionButton
                  size="md"
                  workspaces={workspaces.map((w) => ({ id: w.id, name: w.name }))}
                  credentialStorage={credentialStorageConfigured()}
                />
              }
            />
          ) : (
            <ConnectionList
              connections={connections}
              workspaces={workspaces.map((w) => ({ id: w.id, name: w.name }))}
              credentialStorage={credentialStorageConfigured()}
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}
