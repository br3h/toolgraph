import Image from 'next/image';
import Link from 'next/link';
import { ThemeToggle } from '@toolgraph/ui';

import { signOut } from '@/app/auth/actions';

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
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border-subtle px-4">
        <Link href="/graphs" className="flex shrink-0 items-center gap-2.5">
          <Image src="/toolgraph.png" alt="" width={22} height={22} className="rounded" priority />
          <span className="text-sm font-semibold tracking-tight">Toolgraph</span>
        </Link>

        <div className="min-w-0 flex-1">{toolbar}</div>

        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle />
          <div className="flex items-center gap-2" data-testid="user-menu">
            {email ? (
              <span className="hidden max-w-[180px] truncate text-xs text-fg-muted sm:inline">
                {email}
              </span>
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
        </div>
      </header>

      <main className={fullBleed ? 'min-h-0 flex-1' : 'flex-1'}>{children}</main>
    </div>
  );
}
