'use client';

import { useId } from 'react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { ErrorIcon } from './icons';

export interface FieldIds {
  /** Id for the control itself; the label's `htmlFor`. */
  id: string;
  hintId: string;
  errorId: string;
}

/**
 * Stable ids for a labelled control. A caller-supplied `id` wins so a form
 * library can address the control, otherwise `useId` provides one that is
 * stable across server and client renders.
 */
export function useFieldIds(providedId?: string): FieldIds {
  const generated = useId();
  const id = providedId ?? `tg-field-${generated}`;
  return { id, hintId: `${id}-hint`, errorId: `${id}-error` };
}

/** Join the ids a control should point `aria-describedby` at, or nothing. */
export function describedBy(...ids: Array<string | false | null | undefined>): string | undefined {
  const present = ids.filter((value): value is string => typeof value === 'string' && value !== '');
  return present.length > 0 ? present.join(' ') : undefined;
}

export interface FieldShellProps extends FieldIds {
  label: string;
  /** Keep the label for assistive tech but take it out of the visual layout. */
  labelHidden?: boolean;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * Label / hint / error chrome shared by `Input`, `Textarea` and `Select`.
 *
 * The error is an outlined block with an icon and a word — never a colour —
 * because the whole theme is a single neutral ramp.
 */
export function FieldShell({
  id,
  hintId,
  errorId,
  label,
  labelHidden = false,
  hint,
  error,
  required = false,
  children,
  className,
  style,
}: FieldShellProps): ReactElement {
  return (
    <div
      className={cn('tg-field', className)}
      style={{ display: 'flex', flexDirection: 'column', gap: '6px', ...style }}
    >
      <label
        htmlFor={id}
        className={cn('tg-field__label', labelHidden && 'tg-visually-hidden')}
        style={{ color: 'var(--tg-fg)', fontSize: '13px', fontWeight: 600 }}
      >
        {label}
        {required ? (
          <span className="tg-field__required" aria-hidden="true" style={{ fontWeight: 700 }}>
            {' *'}
          </span>
        ) : null}
      </label>

      {children}

      {hint && !error ? (
        <p
          id={hintId}
          className="tg-field__hint"
          style={{ color: 'var(--tg-fg-muted)', fontSize: '12px', margin: 0 }}
        >
          {hint}
        </p>
      ) : null}

      {error ? (
        <p
          id={errorId}
          className="tg-field__error"
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '6px',
            margin: 0,
            padding: '6px 8px',
            border: '2px solid var(--tg-border-strong)',
            borderRadius: 'var(--tg-radius-sm)',
            color: 'var(--tg-fg)',
            fontSize: '12px',
            fontWeight: 600,
          }}
        >
          <ErrorIcon size={14} style={{ flex: '0 0 auto', marginTop: '1px' }} />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
