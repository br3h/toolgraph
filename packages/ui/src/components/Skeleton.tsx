import type { CSSProperties, ReactElement } from 'react';
import { cn } from '../lib/cn';

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  /** Render as a circle, e.g. an avatar placeholder. */
  circle?: boolean;
  radius?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * A loading placeholder. The shimmer is three stops of the neutral ramp; under
 * `prefers-reduced-motion` the stylesheet drops the animation and leaves the
 * flat sunken surface, which still reads as "not content yet".
 */
export function Skeleton({
  width = '100%',
  height = '1em',
  circle = false,
  radius,
  className,
  style,
}: SkeletonProps): ReactElement {
  return (
    <span
      className={cn('tg-skeleton', className)}
      aria-hidden="true"
      style={{
        display: 'block',
        width,
        height: circle && typeof width !== 'undefined' && !height ? width : height,
        borderRadius: circle ? '50%' : (radius ?? 'var(--tg-radius-sm)'),
        background: 'var(--tg-bg-sunken)',
        ...style,
      }}
    />
  );
}
