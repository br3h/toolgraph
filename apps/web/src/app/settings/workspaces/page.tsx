import { redirect } from 'next/navigation';
import { EmptyState } from '@toolgraph/ui';

import { Section } from '@/components/settings/Section';
import { CreateWorkspaceForm } from '@/components/settings/CreateWorkspaceForm';
import { PendingInvitations } from '@/components/settings/PendingInvitations';
import { WorkspaceCard } from '@/components/settings/WorkspaceCard';
import { getCurrentUser } from '@/lib/supabase/server';
import {
  listMembers,
  listPendingInvitations,
  listSentInvitations,
  listWorkspaces,
  paidSeats,
} from '@/lib/workspaces/store';

export const dynamic = 'force-dynamic';

export default async function WorkspacesSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const [workspaces, invitations] = await Promise.all([listWorkspaces(), listPendingInvitations()]);

  // Members, sent invitations and seat entitlement for each workspace. Fetched
  // together rather than lazily because the page is not useful without them —
  // a workspace card with a spinner where the members should be is a worse
  // first impression than a page that takes an extra beat.
  const detailed = await Promise.all(
    workspaces.map(async (workspace) => ({
      workspace,
      members: await listMembers(workspace.id),
      sent:
        workspace.role === 'owner' || workspace.role === 'admin'
          ? await listSentInvitations(workspace.id)
          : [],
      seats: await paidSeats(workspace.id),
    })),
  );

  return (
    <div className="space-y-5">
      {invitations.length > 0 ? <PendingInvitations invitations={invitations} /> : null}

      {detailed.length === 0 ? (
        <Section
          title="Workspaces"
          description="A workspace is a shared container: graphs and connections in it are visible to everyone who is a member."
        >
          <EmptyState
            title="No workspaces yet"
            description="Create one to share graphs and connections with other people. A shared connection stores its credential once, and members can use it without ever seeing it."
            action={<CreateWorkspaceForm />}
          />
        </Section>
      ) : (
        <>
          {detailed.map(({ workspace, members, sent, seats }) => (
            <WorkspaceCard
              key={workspace.id}
              workspace={workspace}
              members={members}
              sent={sent}
              paidSeats={seats}
              currentUserId={user.id}
            />
          ))}

          <Section
            title="New workspace"
            description="You become its owner, and can invite people straight away."
          >
            <CreateWorkspaceForm />
          </Section>
        </>
      )}
    </div>
  );
}
