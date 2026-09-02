import Image from 'next/image';
import Link from 'next/link';
import { ThemeToggle } from '@toolgraph/ui';

import { signOut } from '@/app/auth/actions';
import { MobileNav } from '@/components/MobileNav';

export interface AppShellProps {
  email?: string | undefined;
  children: React.ReactNode;
  /** Rendered between the logo and the user menu, e.g. the graph title. */
  toolbar?: React.ReactNode;
  /** The canvas needs the full viewport with no page scroll of its own. */
  fullBleed?: boolean;
}

export function AppShell({ email, children, toolbar, fullBleed = false }: AppShellProps) {
  return (
    <div
      className={
        fullBleed ? 'flex h-screen flex-col overflow-hidden' : 'flex min-h-screen flex-col'
      }
    >
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border-subtle px-4 sm:gap-4 sm:px-6">
        <Link href="/graphs" className="flex min-w-0 shrink-0 items-center gap-2.5">
          <Image src="/toolgraph.png" alt="" width={22} height={22} className="rounded" priority />
          <span className="truncate text-sm font-semibold tracking-tight">Toolgraph</span>
        </Link>

        <div className="min-w-0 flex-1">{toolbar}</div>

        {/* Full controls from sm up. */}
        <div className="hidden shrink-0 items-center gap-2 sm:flex" data-testid="user-menu">
          <Link
            href="/billing"
            className="rounded-[var(--tg-radius-sm)] px-2.5 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:text-fg"
          >
            Billing
          </Link>
          <ThemeToggle />
          {email ? (
            <span className="max-w-[180px] truncate text-xs text-fg-muted">{email}</span>
          ) : null}
          <form action={signOut}>
            <button
              type="submit"
              data-testid="sign-out"
              className="rounded-[var(--tg-radius-sm)] border border-border px-2.5 py-1.5 text-xs font-medium text-fg transition-colors hover:bg-bg-sunken"
            >
              Sign out
            </button>
          </form>
        </div>

        {/* Below sm, behind the trigger. Sign out is a server action, so it is
            rendered here and passed down rather than reimplemented client-side. */}
        <div className="flex shrink-0 items-center gap-1.5 sm:hidden">
          <ThemeToggle />
          <MobileNav label="Account menu" links={[{ href: '/billing', label: 'Billing' }]}>
            {email ? (
              <p className="truncate px-3 pb-2 pt-1 text-xs text-fg-subtle" title={email}>
                {email}
              </p>
            ) : null}
            <form action={signOut}>
              <button
                type="submit"
                data-testid="sign-out-mobile"
                className="w-full rounded-[var(--tg-radius-sm)] border border-border px-3 py-2 text-sm font-medium text-fg transition-colors hover:bg-bg-sunken"
              >
                Sign out
              </button>
            </form>
          </MobileNav>
        </div>
      </header>

      <main className={fullBleed ? 'min-h-0 flex-1' : 'flex-1'}>{children}</main>
    </div>
  );
}
