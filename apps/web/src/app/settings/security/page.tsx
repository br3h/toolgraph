import { redirect } from 'next/navigation';

import { Section } from '@/components/settings/Section';
import { PasswordForm } from '@/components/settings/PasswordForm';
import { SignOutEverywhere } from '@/components/settings/SignOutEverywhere';
import { getCurrentUser } from '@/lib/supabase/server';
import { credentialStorageConfigured } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

export default async function SecuritySettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const hasPassword = (user.identities ?? []).some((identity) => identity.provider === 'email');
  const storesCredentials = credentialStorageConfigured();

  return (
    <div className="space-y-5">
      <Section
        title="Password"
        description={
          hasPassword
            ? 'Changing it needs the current one, so a session on its own is not enough.'
            : 'This account signs in with GitHub and has no password.'
        }
      >
        {hasPassword ? (
          <PasswordForm />
        ) : (
          <p className="text-sm text-fg-muted">
            Setting a password on a GitHub account is not built yet. Until it is, GitHub is how you
            sign in — which also means your GitHub account&apos;s own two-factor setting protects
            this one.
          </p>
        )}
      </Section>

      <Section
        title="Sessions"
        description="Signs this account out of every browser and device, everywhere, at once."
      >
        {/*
          Toolgraph shows no per-session list, and that is deliberate rather
          than unfinished. Supabase does not expose per-session metadata (device,
          address, last seen) to the client, so any list drawn here would be
          invented. A button that definitely revokes everything is worth more
          than a table that might be wrong.
        */}
        <SignOutEverywhere />
      </Section>

      <Section
        title="Two-factor authentication"
        description="Not available on Toolgraph accounts yet."
      >
        <p className="text-sm leading-relaxed text-fg-muted">
          There is no TOTP or passkey enrolment here, and rather than show a switch that does
          nothing, this says so. If you sign in with GitHub, your GitHub account&apos;s own
          two-factor requirement already applies to Toolgraph.
        </p>
      </Section>

      <Section
        title="Stored connection credentials"
        description="How Toolgraph holds the tokens your connections use."
      >
        {storesCredentials ? (
          <div className="space-y-2 text-sm leading-relaxed text-fg-muted">
            <p>
              A credential you save is encrypted with AES-256-GCM before it reaches the database,
              under a key held in the server environment rather than in Postgres. A database backup
              on its own does not contain a usable token.
            </p>
            <p>
              The table it lives in is granted to the server role only, and row level security is on
              with no policies — so no browser session can read it by any query, whatever it holds.
            </p>
            <p>
              Nothing decrypts one except an outbound request to the server you pointed the
              connection at. It is never sent back to a browser, never written to a log, and never
              included in a data export.
            </p>
          </div>
        ) : (
          <div className="space-y-2 text-sm leading-relaxed text-fg-muted">
            <p>
              <span className="font-medium text-fg">Not configured on this deployment.</span> No
              encryption key is set, so Toolgraph will not store connection credentials at all.
            </p>
            <p>
              Connections still work: you type the authorization header when you test one, it is
              used for that request, and it is dropped. Nothing is written anywhere.
            </p>
          </div>
        )}
      </Section>
    </div>
  );
}
