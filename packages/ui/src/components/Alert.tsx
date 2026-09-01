import type { ComponentPropsWithRef, ReactElement, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { mergeStyles, type StyleWithVars } from '../lib/style';
import { ErrorIcon, InfoIcon, SuccessIcon, WarningIcon, type IconProps } from './icons';

export type AlertVariant = 'info' | 'success' | 'warning' | 'error';

export interface AlertProps extends Omit<ComponentPropsWithRef<'div'>, 'title'> {
  variant?: AlertVariant;
  /** Overrides the variant's default heading; the heading is never dropped. */
  title?: string;
  /** Trailing content, e.g. a `Button`. */
  action?: ReactNode;
}

interface VariantSpec {
  /** Each variant gets its own glyph — that is the primary signal. */
  Icon: (props: IconProps) => ReactElement;
  /** Heading text, so the state is readable without seeing the icon. */
  title: string;
  borderWidth: string;
  borderColor: string;
  titleWeight: number;
  /** `alert` interrupts; `status` is announced politely. */
  role: 'status' | 'alert';
}

/**
 * The three signals are icon, heading and border weight — never colour. A
 * warning is a heavier outline than an info, an error heavier still, and every
 * one of them says what it is in words as well.
 */
const VARIANTS: Record<AlertVariant, VariantSpec> = {
  info: {
    Icon: InfoIcon,
    title: 'Information',
    borderWidth: '1px',
    borderColor: 'var(--tg-border-subtle)',
    titleWeight: 600,
    role: 'status',
  },
  success: {
    Icon: SuccessIcon,
    title: 'Success',
    borderWidth: '1px',
    borderColor: 'var(--tg-border)',
    titleWeight: 600,
    role: 'status',
  },
  warning: {
    Icon: WarningIcon,
    title: 'Warning',
    borderWidth: '2px',
    borderColor: 'var(--tg-border)',
    titleWeight: 700,
    role: 'status',
  },
  error: {
    Icon: ErrorIcon,
    title: 'Error',
    borderWidth: '2px',
    borderColor: 'var(--tg-border-strong)',
    titleWeight: 700,
    role: 'alert',
  },
};

export function Alert({
  variant = 'info',
  title,
  action,
  className,
  style,
  children,
  role,
  ...rest
}: AlertProps): ReactElement {
  const spec = VARIANTS[variant];
  const heading = title ?? spec.title;

  const base: StyleWithVars = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    padding: '10px 12px',
    background: 'var(--tg-bg-raised)',
    color: 'var(--tg-fg)',
    border: `${spec.borderWidth} solid ${spec.borderColor}`,
    borderRadius: 'var(--tg-radius-md)',
    fontSize: '13px',
    lineHeight: 1.45,
  };

  return (
    <div
      {...rest}
      role={role ?? spec.role}
      className={cn('tg-alert', `tg-alert--${variant}`, className)}
      style={mergeStyles(base, style)}
      data-variant={variant}
    >
      <span
        className="tg-alert__icon"
        style={{ flex: '0 0 auto', lineHeight: 0, marginTop: '1px' }}
      >
        <spec.Icon size={16} />
      </span>

      <div className="tg-alert__content" style={{ flex: '1 1 auto', minWidth: 0 }}>
        <p
          className="tg-alert__title"
          style={{ margin: 0, fontSize: '13px', fontWeight: spec.titleWeight }}
        >
          {heading}
        </p>
        {children ? (
          <div className="tg-alert__body" style={{ marginTop: '2px', color: 'var(--tg-fg-muted)' }}>
            {children}
          </div>
        ) : null}
      </div>

      {action ? (
        <span className="tg-alert__action" style={{ flex: '0 0 auto' }}>
          {action}
        </span>
      ) : null}
    </div>
  );
}
