'use client';

import type { ComponentPropsWithRef, CSSProperties, ReactElement } from 'react';
import { cn } from '../lib/cn';
import { describedBy, FieldShell, useFieldIds } from './Field';

export interface TextareaProps extends ComponentPropsWithRef<'textarea'> {
  label: string;
  labelHidden?: boolean;
  hint?: string;
  /** Present means invalid: sets `aria-invalid` and renders an outlined message. */
  error?: string;
  fieldClassName?: string;
  fieldStyle?: CSSProperties;
}

export function Textarea({
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
  rows = 4,
  'aria-describedby': ariaDescribedBy,
  ...rest
}: TextareaProps): ReactElement {
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
      <textarea
        {...rest}
        id={id}
        rows={rows}
        required={required}
        className={cn(
          'tg-control',
          'tg-control--textarea',
          error && 'tg-control--invalid',
          className,
        )}
        style={style}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(ariaDescribedBy, hint && !error && hintId, error && errorId)}
      />
    </FieldShell>
  );
}
