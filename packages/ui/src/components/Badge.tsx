import type { ComponentPropsWithRef, ReactElement } from 'react';
import { cn } from '../lib/cn';
import { mergeStyles, type StyleWithVars } from '../lib/style';

/**
 * Emphasis only, never category: `subtle` recedes, `strong` carries a heavy
 * outline and a bold label. Two badges differ by weight and border, not hue.
 */
export type BadgeVariant = 'subtle' | 'default' | 'strong';

export interface BadgeProps extends ComponentPropsWithRef<'span'> {
  variant?: BadgeVariant;
  /** Small-caps treatment for terse status words. */
  uppercase?: boolean;
}

const VARIANT_STYLES: Record<BadgeVariant, StyleWithVars> = {
  subtle: {
    borderWidth: '1px',
    borderColor: 'var(--tg-border-subtle)',
    color: 'var(--tg-fg-muted)',
    fontWeight: 400,
  },
  default: {
    borderWidth: '1px',
    borderColor: 'var(--tg-border)',
    color: 'var(--tg-fg)',
    fontWeight: 500,
  },
  strong: {
    borderWidth: '2px',
    borderColor: 'var(--tg-border-strong)',
    color: 'var(--tg-fg)',
    fontWeight: 700,
  },
};

export function Badge({
  variant = 'default',
  uppercase = false,
  className,
  style,
  children,
  ...rest
}: BadgeProps): ReactElement {
  const base: StyleWithVars = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '1px 7px',
    borderStyle: 'solid',
    borderRadius: 'var(--tg-radius-sm)',
    background: 'transparent',
    fontSize: '11px',
    lineHeight: '18px',
    letterSpacing: uppercase ? '0.06em' : 'normal',
    textTransform: uppercase ? 'uppercase' : 'none',
    whiteSpace: 'nowrap',
    ...VARIANT_STYLES[variant],
  };

  return (
    <span
      {...rest}
      className={cn('tg-badge', `tg-badge--${variant}`, className)}
      style={mergeStyles(base, style)}
      data-variant={variant}
    >
      {children}
    </span>
  );
}
