import type { ComponentPropsWithRef, ReactElement, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { mergeStyles, type StyleWithVars } from '../lib/style';

export interface EmptyStateProps extends Omit<ComponentPropsWithRef<'div'>, 'title'> {
  /** Usually an icon from this package, sized 24–32px. */
  icon?: ReactNode;
  title: string;
  description?: string;
  /** A single primary action, e.g. a `Button`. */
  action?: ReactNode;
  /** Drops the dashed-free outline when the state sits inside an existing card. */
  bordered?: boolean;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  bordered = true,
  className,
  style,
  children,
  ...rest
}: EmptyStateProps): ReactElement {
  const base: StyleWithVars = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    padding: '32px 24px',
    textAlign: 'center',
    color: 'var(--tg-fg)',
    border: bordered ? '1px solid var(--tg-border-subtle)' : 'none',
    borderRadius: 'var(--tg-radius-lg)',
    background: 'var(--tg-bg-subtle)',
  };

  return (
    <div {...rest} className={cn('tg-empty', className)} style={mergeStyles(base, style)}>
      {icon ? (
        <span className="tg-empty__icon" style={{ color: 'var(--tg-fg-subtle)', lineHeight: 0 }}>
          {icon}
        </span>
      ) : null}

      <p className="tg-empty__title" style={{ margin: 0, fontSize: '14px', fontWeight: 700 }}>
        {title}
      </p>

      {description ? (
        <p
          className="tg-empty__description"
          style={{
            margin: 0,
            maxWidth: '46ch',
            color: 'var(--tg-fg-muted)',
            fontSize: '13px',
            lineHeight: 1.5,
          }}
        >
          {description}
        </p>
      ) : null}

      {children}

      {action ? (
        <span className="tg-empty__action" style={{ marginTop: '4px' }}>
          {action}
        </span>
      ) : null}
    </div>
  );
}
