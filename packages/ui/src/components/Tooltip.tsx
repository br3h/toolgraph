'use client';

import { cloneElement, useCallback, useEffect, useId, useRef, useState } from 'react';
import type {
  CSSProperties,
  FocusEvent,
  HTMLAttributes,
  MouseEvent,
  ReactElement,
  ReactNode,
} from 'react';
import { cn } from '../lib/cn';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

/** The trigger has to accept the handlers and the `aria-describedby` we add. */
type TriggerProps = HTMLAttributes<HTMLElement>;

export interface TooltipProps {
  /** Short supplementary text. Never put the only copy of anything in here. */
  content: ReactNode;
  /** A single focusable element: a button, a link, a control. */
  children: ReactElement<TriggerProps>;
  placement?: TooltipPlacement;
  /** Hover open delay in ms. Focus always opens immediately. */
  delay?: number;
  className?: string;
  style?: CSSProperties;
}

const PLACEMENT_STYLES: Record<TooltipPlacement, CSSProperties> = {
  top: { bottom: '100%', left: '50%', transform: 'translate(-50%, -6px)' },
  bottom: { top: '100%', left: '50%', transform: 'translate(-50%, 6px)' },
  left: { right: '100%', top: '50%', transform: 'translate(-6px, -50%)' },
  right: { left: '100%', top: '50%', transform: 'translate(6px, -50%)' },
};

/**
 * Hover- and focus-triggered `role="tooltip"`, dismissed by Escape.
 *
 * The trigger is cloned rather than wrapped in a focusable element of our own,
 * so `aria-describedby` lands on the thing the user actually focuses and the
 * tab order is unchanged. The bubble is only in the DOM while it is shown —
 * a hidden tooltip is not something assistive tech should be able to reach.
 */
export function Tooltip({
  content,
  children,
  placement = 'top',
  delay = 120,
  className,
  style,
}: TooltipProps): ReactElement {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipId = `tg-tooltip-${useId()}`;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const show = useCallback(
    (immediate: boolean) => {
      clearTimer();
      if (immediate || delay <= 0) {
        setVisible(true);
        return;
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setVisible(true);
      }, delay);
    },
    [clearTimer, delay],
  );

  const hide = useCallback(() => {
    clearTimer();
    setVisible(false);
  }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  useEffect(() => {
    if (!visible) return undefined;

    // Listening on the document, not the trigger: Escape has to work even once
    // focus has moved on while the pointer still hovers.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [visible, hide]);

  const triggerProps = children.props;

  const trigger = cloneElement(children, {
    'aria-describedby': visible
      ? cn(triggerProps['aria-describedby'], tooltipId)
      : triggerProps['aria-describedby'],
    onMouseEnter: (event: MouseEvent<HTMLElement>) => {
      triggerProps.onMouseEnter?.(event);
      show(false);
    },
    onMouseLeave: (event: MouseEvent<HTMLElement>) => {
      triggerProps.onMouseLeave?.(event);
      hide();
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      triggerProps.onFocus?.(event);
      show(true);
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      triggerProps.onBlur?.(event);
      hide();
    },
  });

  return (
    <span
      className={cn('tg-tooltip', className)}
      style={{ position: 'relative', display: 'inline-flex' }}
    >
      {trigger}
      {visible ? (
        <span
          id={tooltipId}
          role="tooltip"
          className={cn('tg-tooltip__bubble', `tg-tooltip__bubble--${placement}`)}
          style={{
            position: 'absolute',
            zIndex: 40,
            width: 'max-content',
            maxWidth: '240px',
            padding: '4px 8px',
            background: 'var(--tg-bg-inverse)',
            color: 'var(--tg-fg-inverse)',
            border: '1px solid var(--tg-border-strong)',
            borderRadius: 'var(--tg-radius-sm)',
            boxShadow: 'var(--tg-shadow-md)',
            fontSize: '12px',
            fontWeight: 500,
            lineHeight: 1.4,
            // The bubble must never eat the pointer: hovering it would keep the
            // trigger's mouseleave from ever firing.
            pointerEvents: 'none',
            ...PLACEMENT_STYLES[placement],
            ...style,
          }}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}
