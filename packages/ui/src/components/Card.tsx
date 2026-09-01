import type { ComponentPropsWithRef, ReactElement, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { mergeStyles, type StyleWithVars } from '../lib/style';

export interface CardProps extends ComponentPropsWithRef<'div'> {
  /** Rendered above the body, separated by a hairline. */
  header?: ReactNode;
  /** Rendered below the body on a sunken surface. */
  footer?: ReactNode;
  /** Set false when the body supplies its own padding, e.g. a table. */
  padded?: boolean;
  /** A raised card lifts off the page with the neutral shadow token. */
  elevated?: boolean;
}

export function Card({
  header,
  footer,
  padded = true,
  elevated = false,
  className,
  style,
  children,
  ...rest
}: CardProps): ReactElement {
  const base: StyleWithVars = {
    background: 'var(--tg-bg-raised)',
    border: '1px solid var(--tg-border)',
    borderRadius: 'var(--tg-radius-lg)',
    boxShadow: elevated ? 'var(--tg-shadow-md)' : 'none',
    color: 'var(--tg-fg)',
    overflow: 'hidden',
  };

  return (
    <div {...rest} className={cn('tg-card', className)} style={mergeStyles(base, style)}>
      {header ? (
        <div
          className="tg-card__header"
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--tg-border-subtle)',
            fontWeight: 600,
          }}
        >
          {header}
        </div>
      ) : null}

      <div className="tg-card__body" style={{ padding: padded ? '16px' : 0 }}>
        {children}
      </div>

      {footer ? (
        <div
          className="tg-card__footer"
          style={{
            padding: '12px 16px',
            borderTop: '1px solid var(--tg-border-subtle)',
            background: 'var(--tg-bg-subtle)',
          }}
        >
          {footer}
        </div>
      ) : null}
    </div>
  );
}
