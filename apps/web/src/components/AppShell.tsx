import Image from 'next/image';
import Link from 'next/link';
import { ThemeToggle } from '@toolgraph/ui';

import { signOut } from '@/app/auth/actions';
import { MobileNav } from '@/components/MobileNav';
import { NavLink, type NavSection } from '@/components/NavLink';

/** The product's sections, in the order they are worked through. */
const SECTIONS: readonly { id: NavSection; href: string; label: string }[] = [
  { id: 'graphs', href: '/graphs', label: 'Graphs' },
  { id: 'connections', href: '/connections', label: 'Connections' },
  { id: 'runs', href: '/runs', label: 'Runs' },
  { id: 'usage', href: '/usage', label: 'Usage' },
];

export interface AppShellProps {
  email?: string | undefined;
  children: React.ReactNode;
  /** Rendered between the nav and the account menu, e.g. the graph title. */
  toolbar?: React.ReactNode;
  /** The canvas needs the full viewport with no page scroll of its own. */
  fullBleed?: boolean;
  /**
   * Which section is current.
   *
   * Passed in rather than derived from `usePathname()` so the shell stays a
   * server component: making it client-side would pull the whole authenticated
   * layout into the browser bundle for the sake of one underline.
   */
  active?: NavSection | undefined;
}

export function AppShell({ email, children, toolbar, fullBleed = false, active }: AppShellProps) {
  return (
    <div
      className={
        fullBleed ? 'flex h-screen flex-col overflow-hidden' : 'flex min-h-screen flex-col'
      }
    >
      {/*
        A skip link is the one accessibility affordance a keyboard user needs
        most on a page with a persistent nav, and it costs nothing. It is
        visually hidden until focused.
      */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-[var(--tg-radius-md)] focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-fg-on-accent"
      >
        Skip to content
      </a>

      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border-subtle px-4 sm:gap-5 sm:px-6">
        <Link
          href="/graphs"
          className="flex min-w-0 shrink-0 items-center gap-2.5"
          aria-label="Toolgraph home"
        >
          <Image src="/toolgraph.png" alt="" width={22} height={22} className="rounded" priority />
          <span className="hidden truncate text-sm font-semibold tracking-tight sm:inline">
            Toolgraph
          </span>
        </Link>

        {/*
          The product nav. Hidden below `md` because four sections plus a graph
          title plus an account menu is more than a phone header can hold; the
          same destinations are in the mobile menu below.
        */}
        <nav aria-label="Sections" className="hidden shrink-0 items-center gap-0.5 md:flex">
          {SECTIONS.map((section) => (
            <NavLink
              key={section.id}
              href={section.href}
              section={section.id}
              active={active}
              label={section.label}
            />
          ))}
        </nav>

        <div className="min-w-0 flex-1">{toolbar}</div>

        <div className="hidden shrink-0 items-center gap-2 sm:flex" data-testid="user-menu">
          <NavLink href="/settings" section="settings" active={active} label="Settings" />
          <ThemeToggle />
          {email ? (
            <span className="hidden max-w-[180px] truncate text-xs text-fg-muted lg:inline">
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

        {/* Below sm, behind the trigger. Sign out is a server action, so it is
            rendered here and passed down rather than reimplemented client-side. */}
        <div className="flex shrink-0 items-center gap-1.5 sm:hidden">
          <ThemeToggle />
          <MobileNav
            label="Menu"
            links={[
              ...SECTIONS.map((section) => ({ href: section.href, label: section.label })),
              { href: '/settings', label: 'Settings' },
              { href: '/billing', label: 'Billing' },
            ]}
          >
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

      {/*
        Between `sm` and `md` the section nav is hidden from the header but the
        account controls are not, so the sections get their own scrollable strip
        rather than disappearing entirely at tablet widths.
      */}
      <nav
        aria-label="Sections"
        className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border-subtle px-4 py-1.5 sm:px-6 md:hidden"
      >
        {SECTIONS.map((section) => (
          <NavLink
            key={section.id}
            href={section.href}
            section={section.id}
            active={active}
            label={section.label}
          />
        ))}
      </nav>

      <main id="main" className={fullBleed ? 'min-h-0 flex-1' : 'flex-1'}>
        {children}
      </main>
    </div>
  );
}
