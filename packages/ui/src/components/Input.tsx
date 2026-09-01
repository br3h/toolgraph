'use client';

import type { ComponentPropsWithRef, CSSProperties, ReactElement } from 'react';
import { cn } from '../lib/cn';
import { describedBy, FieldShell, useFieldIds } from './Field';

export interface InputProps extends Omit<ComponentPropsWithRef<'input'>, 'children'> {
  label: string;
  labelHidden?: boolean;
  hint?: string;
  /** Present means invalid: sets `aria-invalid` and renders an outlined message. */
  error?: string;
  /** Class for the wrapper; `className` still lands on the `<input>` itself. */
  fieldClassName?: string;
  fieldStyle?: CSSProperties;
}

export function Input({
  label,
  labelHidden,
  hint,
  error,
  fieldClassName,
  fieldStyle,
  className,
  style,
  id: providedId,
  required,
  'aria-describedby': ariaDescribedBy,
  ...rest
}: InputProps): ReactElement {
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
      <input
        {...rest}
        id={id}
        required={required}
        className={cn('tg-control', error && 'tg-control--invalid', className)}
        style={style}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(ariaDescribedBy, hint && !error && hintId, error && errorId)}
      />
    </FieldShell>
  );
}
