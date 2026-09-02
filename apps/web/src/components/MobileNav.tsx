'use client';

/**
 * The small-screen header menu.
 *
 * Both headers carry more than a phone can show — the landing page has five nav
 * items and the app shell adds the graph title alongside them — so below the
 * breakpoint they collapse to this and the desktop nav is hidden.
 *
 * `children` exists because some header controls cannot be described as a link.
 * Sign out is a server action inside a form, so the server component renders it
 * and passes it down; re-implementing it here would mean a second code path for
 * the same action.
 */

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@toolgraph/ui';

export interface MobileNavLink {
  href: string;
  label: string;
  /** Opens in a new tab and gets the usual rel guard. */
  external?: boolean;
  /** Rendered as the solid primary control, e.g. "Get started". */
  emphasis?: boolean;
}

export interface MobileNavProps {
  links: MobileNavLink[];
  /** Rendered at the foot of the panel, under a divider. */
  children?: ReactNode;
  /** Names the menu for assistive technology. */
  label?: string;
  className?: string;
}

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {open ? (
        <>
          <path d="M4 4l10 10" />
          <path d="M14 4L4 14" />
        </>
      ) : (
        <>
          <path d="M2.5 5h13" />
          <path d="M2.5 9h13" />
          <path d="M2.5 13h13" />
        </>
      )}
    </svg>
  );
}

export function MobileNav({ links, children, label = 'Menu', className }: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const pathname = usePathname();

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    // Focus goes back to the control that opened it, so keyboard users are not
    // dropped at the top of the document.
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // Navigating away must not leave the panel hanging open over the new page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      // A click outside dismisses, but focus stays where the person clicked
      // rather than snapping back to the trigger.
      close(false);
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, close]);

  // Move focus into the panel on open so the next Tab continues inside it.
  useEffect(() => {
    if (!open) return;
    const first = panelRef.current?.querySelector<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    first?.focus();
  }, [open]);

  return (
    <div className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? `Close ${label.toLowerCase()}` : label}
        data-testid="mobile-nav-toggle"
        className="flex h-9 w-9 items-center justify-center rounded-[var(--tg-radius-sm)] border border-border text-fg transition-colors hover:bg-bg-sunken"
      >
        <MenuIcon open={open} />
      </button>

      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          data-testid="mobile-nav-panel"
          /*
           * Anchored to the right edge of the trigger rather than stretched
           * across the viewport: a full-bleed panel inside a header that already
           * has horizontal padding is the usual way these end up wider than the
           * screen and cause a sideways scroll.
           */
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-56 max-w-[calc(100vw-2rem)] overflow-hidden rounded-[var(--tg-radius-lg)] border border-border bg-bg-raised shadow-[var(--tg-shadow-lg)]"
        >
          <nav aria-label={label} className="flex flex-col p-1.5">
            {links.map((link) =>
              link.external ? (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  onClick={() => close(false)}
                  className="rounded-[var(--tg-radius-sm)] px-3 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-bg-sunken hover:text-fg"
                >
                  {link.label}
                </a>
              ) : (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => close(false)}
                  className={cn(
                    'rounded-[var(--tg-radius-sm)] px-3 py-2 text-sm transition-colors',
                    link.emphasis
                      ? 'mt-1 bg-accent text-center font-semibold text-fg-on-accent hover:opacity-90'
                      : 'font-medium text-fg-muted hover:bg-bg-sunken hover:text-fg',
                  )}
                >
                  {link.label}
                </Link>
              ),
            )}
          </nav>

          {children ? <div className="border-t border-border-subtle p-1.5">{children}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
