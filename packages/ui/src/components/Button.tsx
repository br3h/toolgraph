'use client';

import type { ComponentPropsWithRef, ReactElement } from 'react';
import { cn } from '../lib/cn';
import { mergeStyles, type StyleWithVars } from '../lib/style';
import { Spinner, type SpinnerSize } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, blocks interaction and keeps the button's width. */
  loading?: boolean;
}

/**
 * Variant is expressed entirely as weight, border and contrast — `danger` is a
 * heavier outline and a bolder label, never a red one. Each variant hands the
 * stylesheet a set of custom properties so that hover, focus and disabled
 * states stay in CSS where pseudo-classes work.
 */
const VARIANT_VARS: Record<ButtonVariant, StyleWithVars> = {
  primary: {
    '--tg-btn-bg': 'var(--tg-accent)',
    '--tg-btn-bg-hover': 'var(--tg-accent-hover)',
    '--tg-btn-fg': 'var(--tg-fg-on-accent)',
    '--tg-btn-border': 'var(--tg-accent)',
    '--tg-btn-border-hover': 'var(--tg-accent-hover)',
    '--tg-btn-border-width': '1px',
    '--tg-btn-weight': '600',
  },
  secondary: {
    '--tg-btn-bg': 'transparent',
    '--tg-btn-bg-hover': 'var(--tg-bg-subtle)',
    '--tg-btn-fg': 'var(--tg-fg)',
    '--tg-btn-border': 'var(--tg-border)',
    '--tg-btn-border-hover': 'var(--tg-border-strong)',
    '--tg-btn-border-width': '1px',
    '--tg-btn-weight': '500',
  },
  ghost: {
    '--tg-btn-bg': 'transparent',
    '--tg-btn-bg-hover': 'var(--tg-bg-subtle)',
    '--tg-btn-fg': 'var(--tg-fg)',
    '--tg-btn-border': 'transparent',
    '--tg-btn-border-hover': 'transparent',
    '--tg-btn-border-width': '1px',
    '--tg-btn-weight': '500',
  },
  danger: {
    '--tg-btn-bg': 'transparent',
    '--tg-btn-bg-hover': 'var(--tg-bg-sunken)',
    '--tg-btn-fg': 'var(--tg-fg)',
    '--tg-btn-border': 'var(--tg-border-strong)',
    '--tg-btn-border-hover': 'var(--tg-fg)',
    '--tg-btn-border-width': '2px',
    '--tg-btn-weight': '700',
  },
};

const SIZE_STYLES: Record<ButtonSize, StyleWithVars> = {
  sm: { minHeight: '28px', padding: '0 10px', fontSize: '12px', gap: '6px' },
  md: { minHeight: '34px', padding: '0 14px', fontSize: '13px', gap: '8px' },
  lg: { minHeight: '42px', padding: '0 18px', fontSize: '15px', gap: '10px' },
};

const SPINNER_FOR_SIZE: Record<ButtonSize, SpinnerSize> = { sm: 'sm', md: 'sm', lg: 'md' };

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled = false,
  className,
  style,
  children,
  type = 'button',
  ...rest
}: ButtonProps): ReactElement {
  const base: StyleWithVars = {
    ...VARIANT_VARS[variant],
    ...SIZE_STYLES[size],
    borderRadius: 'var(--tg-radius-md)',
  };

  return (
    <button
      {...rest}
      type={type}
      className={cn('tg-btn', `tg-btn--${variant}`, `tg-btn--${size}`, className)}
      style={mergeStyles(base, style)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-variant={variant}
      data-size={size}
    >
      {/* The label keeps its box while loading, so the button never resizes
          mid-interaction and the layout around it never jumps. */}
      <span className="tg-btn__label" style={{ visibility: loading ? 'hidden' : 'visible' }}>
        {children}
      </span>
      {loading ? (
        <span className="tg-btn__spinner" aria-hidden="true">
          <Spinner size={SPINNER_FOR_SIZE[size]} />
        </span>
      ) : null}
    </button>
  );
}
