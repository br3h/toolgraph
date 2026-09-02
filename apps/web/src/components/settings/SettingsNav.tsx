'use client';

/**
 * The settings sub-navigation.
 *
 * A client component because this one genuinely needs the current path: unlike
 * the product shell, settings pages are numerous enough that threading an
 * `active` prop through every one of them is the more fragile arrangement, and
 * the component is small enough that the bundle cost is real but trivial.
 *
 * A column beside the content on large screens; a horizontal scroller above it
 * below that, rather than a collapsed menu — five short labels fit on a phone
 * and hiding them behind a tap would make the section feel deeper than it is.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@toolgraph/ui';

const ITEMS = [
  { href: '/settings', label: 'Account' },
  { href: '/settings/security', label: 'Security' },
  { href: '/settings/workspaces', label: 'Workspaces' },
  { href: '/settings/billing', label: 'Plan' },
  { href: '/settings/data', label: 'Data & privacy' },
] as const;

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Settings sections"
      className="-mx-1 flex shrink-0 gap-1 overflow-x-auto border-b border-border-subtle pb-2 lg:mx-0 lg:w-44 lg:flex-col lg:border-b-0 lg:pb-0"
    >
      {ITEMS.map((item) => {
        // Exact match only. A `startsWith` test would light up "Account" on
        // every page in the section, because its href is the segment root.
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'shrink-0 rounded-[var(--tg-radius-sm)] px-3 py-1.5 text-sm transition-colors',
              active
                ? 'bg-bg-sunken font-medium text-fg'
                : 'text-fg-muted hover:bg-bg-sunken hover:text-fg',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
