import Link from 'next/link';
import { cn } from '@toolgraph/ui';

/**
 * One item in the product nav.
 *
 * A server component on purpose: deriving the active section from
 * `usePathname()` would make the whole authenticated shell a client component,
 * which is a real bundle cost for the sake of one underline. The current
 * section is passed down from the page instead.
 */

export type NavSection = 'graphs' | 'connections' | 'runs' | 'usage' | 'settings' | 'billing';

export interface NavLinkProps {
  href: string;
  section: NavSection;
  active: NavSection | undefined;
  label: string;
}

export function NavLink({ href, section, active, label }: NavLinkProps) {
  const isActive = active === section;

  return (
    <Link
      href={href}
      // `aria-current="page"` is what a screen reader announces. The colour
      // change alone would leave the state invisible to anyone not looking at
      // it, so both are set and neither is decorative.
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'shrink-0 rounded-[var(--tg-radius-sm)] px-2.5 py-1.5 text-xs font-medium transition-colors',
        isActive ? 'bg-bg-sunken text-fg' : 'text-fg-muted hover:bg-bg-sunken hover:text-fg',
      )}
    >
      {label}
    </Link>
  );
}
