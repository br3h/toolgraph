import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface IconProps {
  /** Rendered edge length in px. Icons are square. */
  size?: number;
  className?: string;
  style?: CSSProperties;
  /**
   * Accessible name. Omit it for a decorative icon that sits next to text —
   * the icon is then hidden from assistive technology, which is the common
   * case in this package (status is always carried by an adjacent word too).
   */
  title?: string;
}

/**
 * Every icon is stroke-only and paints with `currentColor`, so it inherits the
 * monochrome token of whatever it sits inside. No icon carries a fill, and no
 * icon carries a hue.
 */
function IconBase({
  size = 16,
  className,
  style,
  title,
  children,
}: IconProps & { children: ReactNode }): ReactElement {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('tg-icon', className)}
      style={style}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

/** Info: a circled `i`. */
export function InfoIcon(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11.25v4.75" />
      <path d="M12 8.1h.01" />
    </IconBase>
  );
}

/** Success: a bare check. */
export function SuccessIcon(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M4 12.5 9.5 18 20 6.5" />
    </IconBase>
  );
}

/** Warning: a triangle with an exclamation mark. */
export function WarningIcon(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M12 3.2 22.2 20.5H1.8z" />
      <path d="M12 9.5v4.4" />
      <path d="M12 17.4h.01" />
    </IconBase>
  );
}

/** Error: an octagon with a cross. */
export function ErrorIcon(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M8.4 2.4h7.2l5.9 5.9v7.4l-5.9 5.9H8.4l-5.9-5.9V8.3z" />
      <path d="m9.4 9.4 5.2 5.2" />
      <path d="m14.6 9.4-5.2 5.2" />
    </IconBase>
  );
}

/** A close cross, for dismissible surfaces. */
export function CloseIcon(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="m5.5 5.5 13 13" />
      <path d="m18.5 5.5-13 13" />
    </IconBase>
  );
}

/** The chevron drawn over a native select. */
export function ChevronDownIcon(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="m5.5 9 6.5 6.5L18.5 9" />
    </IconBase>
  );
}

/** Theme mode `system`: a display. */
export function SystemThemeIcon(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <rect x="2.5" y="3.5" width="19" height="13" rx="1.75" />
      <path d="M8.5 20.5h7" />
      <path d="M12 16.5v4" />
    </IconBase>
  );
}

/** Theme mode `light`: a sun. */
export function LightThemeIcon(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="4.25" />
      <path d="M12 1.8v2.6" />
      <path d="M12 19.6v2.6" />
      <path d="M1.8 12h2.6" />
      <path d="M19.6 12h2.6" />
      <path d="m4.8 4.8 1.85 1.85" />
      <path d="m17.35 17.35 1.85 1.85" />
      <path d="m19.2 4.8-1.85 1.85" />
      <path d="m6.65 17.35-1.85 1.85" />
    </IconBase>
  );
}

/** Theme mode `dark`: a moon. */
export function DarkThemeIcon(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M20.5 14.6A9 9 0 0 1 9.4 3.5a9 9 0 1 0 11.1 11.1z" />
    </IconBase>
  );
}
