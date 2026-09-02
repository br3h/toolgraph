import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AppShell } from '@/components/AppShell';
import { SettingsNav } from '@/components/settings/SettingsNav';
import { getCurrentUser } from '@/lib/supabase/server';

// Every settings route is behind a session and describes one person's account.
// `noindex` is inherited by the whole segment so a new page added here cannot
// forget it.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <AppShell email={user.email} active="settings">
      <div className="mx-auto w-full max-w-4xl px-6 py-10">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Your account, how you sign in, the workspaces you are in, and your data.
        </p>

        <div className="mt-8 gap-10 lg:flex">
          <SettingsNav />
          <div className="min-w-0 flex-1 pt-8 lg:pt-0">{children}</div>
        </div>
      </div>
    </AppShell>
  );
}
