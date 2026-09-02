import { redirect } from 'next/navigation';

import { Section } from '@/components/settings/Section';
import { DeleteAccountForm } from '@/components/settings/DeleteAccountForm';
import { getCurrentUser } from '@/lib/supabase/server';
import { previewDeletion } from '@/lib/account/delete';

export const dynamic = 'force-dynamic';

export default async function DataSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const preview = await previewDeletion(user.id);
  const hasPassword = (user.identities ?? []).some((identity) => identity.provider === 'email');

  return (
    <div className="space-y-5">
      <Section
        title="Export your data"
        description="Everything Toolgraph holds about this account, as one JSON file."
      >
        <div className="space-y-3">
          <p className="text-sm leading-relaxed text-fg-muted">
            Graph documents come out complete — every node, edge and JSON Schema — so a graph can be
            rebuilt from the file alone. Connections come out without their credentials, which are
            never exported in any form.
          </p>
          {/*
            A plain link rather than a fetch-and-blob: the route sets
            Content-Disposition and the browser saves it. That also means the
            download works with JavaScript disabled and cannot be broken by a
            client-side error.
          */}
          <a
            href="/api/account/export"
            className="inline-flex items-center rounded-[var(--tg-radius-md)] border border-border px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-bg-sunken"
          >
            Download account data
          </a>
        </div>
      </Section>

      <Section
        title="What Toolgraph stores"
        description="The short version, without a policy document."
      >
        <ul className="space-y-2 text-sm leading-relaxed text-fg-muted">
          <li>
            <span className="font-medium text-fg">Your graphs</span> — nodes, edges and the JSON
            Schemas the servers advertised. Never a credential.
          </li>
          <li>
            <span className="font-medium text-fg">Your connections</span> — where a server is and
            how to reach it, plus when it last worked. Credentials, if you save one, are encrypted
            under a key that is not in the database.
          </li>
          <li>
            <span className="font-medium text-fg">Run summaries</span> — that a run happened, how
            long it took, and whether it failed. Per-step inputs and outputs are streamed to your
            browser and never written down.
          </li>
          <li>
            <span className="font-medium text-fg">Payments</span> — the transaction hashes you
            submitted and what was decided about them.
          </li>
          <li>
            <span className="font-medium text-fg">Analytics</span> — counts and enumerated values
            only. No server URL you typed, no tool name, no field name, no graph contents.
          </li>
        </ul>
      </Section>

      <Section
        tone="danger"
        title="Delete this account"
        description="Permanent, immediate, and there is no undo. Read what goes with it before you do."
      >
        <DeleteAccountForm preview={preview} hasPassword={hasPassword} email={user.email ?? ''} />
      </Section>
    </div>
  );
}
