'use client';

import type { ComponentPropsWithRef, CSSProperties, ReactElement } from 'react';
import { cn } from '../lib/cn';
import { describedBy, FieldShell, useFieldIds } from './Field';
import { ChevronDownIcon } from './icons';

export interface SelectProps extends ComponentPropsWithRef<'select'> {
  label: string;
  labelHidden?: boolean;
  hint?: string;
  /** Present means invalid: sets `aria-invalid` and renders an outlined message. */
  error?: string;
  /** Rendered as a disabled, selected first option when the value is empty. */
  placeholder?: string;
  fieldClassName?: string;
  fieldStyle?: CSSProperties;
}

/**
 * A native `<select>`: it keeps the platform's own keyboard handling and mobile
 * picker. Only the chevron is ours, drawn over a suppressed native arrow so the
 * control matches the other fields.
 */
export function Select({
  label,
  labelHidden,
  hint,
  error,
  placeholder,
  fieldClassName,
  fieldStyle,
  className,
  style,
  id: providedId,
  required,
  children,
  'aria-describedby': ariaDescribedBy,
  ...rest
}: SelectProps): ReactElement {
  const { id, hintId, errorId } = useFieldIds(providedId);

  return (
    <FieldShell
      id={id}
      hintId={hintId}
      errorId={errorId}
      label={label}
      labelHidden={labelHidden}
      hint={hint}
      error={error}
      required={required}
      className={fieldClassName}
      style={fieldStyle}
    >
      <span className="tg-select" style={{ position: 'relative', display: 'block' }}>
        <select
          {...rest}
          id={id}
          required={required}
          className={cn(
            'tg-control',
            'tg-control--select',
            error && 'tg-control--invalid',
            className,
          )}
          style={style}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(
            ariaDescribedBy,
            hint && !error && hintId,
            error && errorId,
          )}
        >
          {placeholder ? (
            <option value="" disabled>
              {placeholder}
            </option>
          ) : null}
          {children}
        </select>
        <ChevronDownIcon className="tg-select__chevron" size={16} />
      </span>
    </FieldShell>
  );
}
