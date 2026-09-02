import { redirect } from 'next/navigation';
import { ThemeToggle } from '@toolgraph/ui';

import { Section } from '@/components/settings/Section';
import { DisplayNameForm } from '@/components/settings/DisplayNameForm';
import { createClient, getCurrentUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** "GitHub" reads better than "github" next to an email address. */
const PROVIDER_LABEL: Record<string, string> = {
  email: 'Email and password',
  github: 'GitHub',
};

export default async function AccountSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', user.id)
    .maybeSingle();

  const identities = user.identities ?? [];

  return (
    <div className="space-y-5">
      <Section
        title="Display name"
        description="Shown to the other people in your workspaces instead of your email address. Optional."
      >
        <DisplayNameForm initial={(profile?.display_name as string | null) ?? ''} />
      </Section>

      <Section
        title="Email"
        description="The address you sign in with, and where confirmation mail is sent."
      >
        <p className="font-mono text-sm text-fg">{user.email ?? 'No address on this account'}</p>
        {/*
          Changing an email address is a real flow — it needs confirmation at
          the new address and revocation at the old one — and Toolgraph does not
          have it yet. Saying so is better than an input that silently does
          nothing, and better than an input that changes an address without
          confirming it.
        */}
        <p className="mt-2 text-xs text-fg-subtle">
          Changing this is not self-service yet: it needs a confirmation round trip to both
          addresses, which is not built. Get in touch and it will be done by hand.
        </p>
      </Section>

      <Section title="How you sign in" description="Every identity linked to this account.">
        <ul className="space-y-2">
          {identities.length === 0 ? (
            <li className="text-sm text-fg-muted">No linked identities.</li>
          ) : (
            identities.map((identity) => (
              <li
                key={identity.identity_id ?? identity.provider}
                className="flex items-center justify-between gap-3 rounded-[var(--tg-radius-md)] border border-border px-3 py-2"
              >
                <span className="text-sm font-medium">
                  {PROVIDER_LABEL[identity.provider] ?? identity.provider}
                </span>
                <span className="text-xs text-fg-subtle">
                  {identity.created_at
                    ? `Linked ${new Date(identity.created_at).toLocaleDateString('en-GB', { timeZone: 'UTC' })}`
                    : 'Linked'}
                </span>
              </li>
            ))
          )}
        </ul>
      </Section>

      <Section
        title="Appearance"
        description="Light, dark, or whatever this device is set to. Stored in this browser."
      >
        <ThemeToggle />
      </Section>
    </div>
  );
}
