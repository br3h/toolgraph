import Image from 'next/image';
import Link from 'next/link';
import { ThemeToggle } from '@toolgraph/ui';

import { MobileNav } from '@/components/MobileNav';

/**
 * The public site's header and footer.
 *
 * Extracted because the landing page and the pricing page each had their own
 * copy, and a third and fourth public page would have made four. Two headers
 * that are meant to be identical and are maintained separately is how a site
 * ends up with a nav link that exists on one page and not another.
 */

export const REPO = 'https://github.com/br3h/toolgraph';

const NAV = [
  { href: '/docs', label: 'Docs' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/security', label: 'Security' },
] as const;

export interface MarketingShellProps {
  children: React.ReactNode;
  /** Signed-in visitors get "Your graphs" instead of "Sign in". */
  signedIn?: boolean;
}

export function MarketingShell({ children, signedIn = false }: MarketingShellProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-[var(--tg-radius-md)] focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-fg-on-accent"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-10 border-b border-border-subtle bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            <Image
              src="/toolgraph.png"
              alt=""
              width={22}
              height={22}
              className="rounded"
              priority
            />
            <span className="truncate text-sm font-semibold tracking-tight">Toolgraph</span>
          </Link>

          <nav aria-label="Main" className="hidden shrink-0 items-center gap-1.5 sm:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-[var(--tg-radius-sm)] px-2.5 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:text-fg"
              >
                {item.label}
              </Link>
            ))}
            <a
              href={REPO}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-[var(--tg-radius-sm)] px-2.5 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:text-fg"
            >
              GitHub
            </a>
            <ThemeToggle />
            {signedIn ? (
              <Link
                href="/graphs"
                className="rounded-[var(--tg-radius-sm)] bg-accent px-3 py-1.5 text-xs font-semibold text-fg-on-accent transition-opacity hover:opacity-90"
              >
                Your graphs
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="rounded-[var(--tg-radius-sm)] px-2.5 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:text-fg"
                >
                  Sign in
                </Link>
                <Link
                  href="/signup"
                  className="rounded-[var(--tg-radius-sm)] bg-accent px-3 py-1.5 text-xs font-semibold text-fg-on-accent transition-opacity hover:opacity-90"
                >
                  Get started
                </Link>
              </>
            )}
          </nav>

          {/*
            Below `sm` the same destinations move behind the trigger. The theme
            toggle stays outside it: it is a single icon that always fits, and
            burying a preference control makes it harder to find than it is wide.
          */}
          <div className="flex shrink-0 items-center gap-1.5 sm:hidden">
            <ThemeToggle />
            <MobileNav
              label="Main menu"
              links={[
                ...NAV.map((item) => ({ href: item.href, label: item.label })),
                { href: REPO, label: 'GitHub', external: true },
                ...(signedIn
                  ? [{ href: '/graphs', label: 'Your graphs', emphasis: true }]
                  : [
                      { href: '/login', label: 'Sign in' },
                      { href: '/signup', label: 'Get started', emphasis: true },
                    ]),
              ]}
            />
          </div>
        </div>
      </header>

      <main id="main" className="flex-1">
        {children}
      </main>

      <footer className="border-t border-border-subtle">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-6 py-10 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-sm">
            <p className="text-sm font-semibold tracking-tight">Toolgraph</p>
            <p className="mt-1.5 text-xs leading-relaxed text-fg-subtle">
              The typed integration layer for MCP servers and APIs. Open source, MIT licensed, and
              yours to self-host.
            </p>
          </div>

          {/*
            Internal links matter here beyond navigation: they are how a crawler
            finds /docs, /security, /privacy and /terms at all, since nothing
            else on the public site points at them.
          */}
          <nav
            aria-label="Footer"
            className="grid grid-cols-2 gap-x-10 gap-y-2 text-xs sm:gap-x-16"
          >
            <Link href="/" className="text-fg-muted transition-colors hover:text-fg">
              Home
            </Link>
            <Link href="/docs" className="text-fg-muted transition-colors hover:text-fg">
              Docs
            </Link>
            <Link href="/pricing" className="text-fg-muted transition-colors hover:text-fg">
              Pricing
            </Link>
            <Link href="/security" className="text-fg-muted transition-colors hover:text-fg">
              Security
            </Link>
            <Link href="/privacy" className="text-fg-muted transition-colors hover:text-fg">
              Privacy
            </Link>
            <Link href="/terms" className="text-fg-muted transition-colors hover:text-fg">
              Terms
            </Link>
            <a
              href={REPO}
              target="_blank"
              rel="noreferrer noopener"
              className="text-fg-muted transition-colors hover:text-fg"
            >
              Source
            </a>
            <a
              href={`${REPO}/blob/main/LICENSE`}
              target="_blank"
              rel="noreferrer noopener"
              className="text-fg-muted transition-colors hover:text-fg"
            >
              Licence
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
