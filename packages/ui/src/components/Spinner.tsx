import type { CSSProperties, ReactElement } from 'react';
import { cn } from '../lib/cn';

export type SpinnerSize = 'sm' | 'md' | 'lg';

export interface SpinnerProps {
  size?: SpinnerSize | number;
  /**
   * Accessible name. With a label the spinner is a live `status` region; with
   * none it is decorative, which is what you want when it sits inside a control
   * that already carries `aria-busy` (see `Button`).
   */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

const SPINNER_PX: Record<SpinnerSize, number> = { sm: 12, md: 16, lg: 20 };

export function Spinner({ size = 'md', label, className, style }: SpinnerProps): ReactElement {
  const px = typeof size === 'number' ? size : SPINNER_PX[size];

  return (
    <span
      className={cn('tg-spinner', className)}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ display: 'inline-flex', color: 'currentColor', ...style }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={px}
        height={px}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        {/* Track and head are the same colour at different opacities: the ramp
            is neutral, so contrast alone has to read as motion. */}
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
