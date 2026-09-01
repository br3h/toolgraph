'use client';

import { useCallback, useEffect, useId, useRef } from 'react';
import type { CSSProperties, MouseEvent, ReactElement, ReactNode, SyntheticEvent } from 'react';
import { cn } from '../lib/cn';
import { Button } from './Button';
import { CloseIcon } from './icons';

export type ModalSize = 'sm' | 'md' | 'lg';

export interface ModalProps {
  open: boolean;
  /** Called for every dismissal route: Escape, the backdrop and the close button. */
  onClose: () => void;
  /** Names the dialog through `aria-labelledby`; always rendered as the heading. */
  title: string;
  /** Rendered under the heading and wired to `aria-describedby`. */
  description?: string;
  children?: ReactNode;
  /** Rendered on a sunken strip below the body, e.g. confirm / cancel buttons. */
  footer?: ReactNode;
  size?: ModalSize;
  /** False removes the close button and ignores Escape and backdrop clicks. */
  dismissible?: boolean;
  className?: string;
  style?: CSSProperties;
}

const MAX_WIDTH: Record<ModalSize, string> = { sm: '360px', md: '520px', lg: '760px' };

/**
 * A native `<dialog>` opened with `showModal()`.
 *
 * The platform is doing the hard parts: `showModal()` gives a real focus trap,
 * top-layer stacking and inertness for the rest of the page, which a div-based
 * modal has to reimplement badly. What is left for us is keeping the DOM's open
 * state in step with the `open` prop, routing every dismissal through
 * `onClose`, and putting focus back where it was.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  dismissible = true,
  className,
  style,
}: ModalProps): ReactElement {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  /** True while we are the ones calling `close()`, so the native `close` event
      does not bounce a second `onClose` back at the parent. */
  const closingRef = useRef(false);
  /** Backdrop clicks only count when the press started on the backdrop too:
      otherwise a text selection dragged out of the panel would close it. */
  const pressedBackdropRef = useRef(false);

  const generatedId = useId();
  const titleId = `tg-modal-title-${generatedId}`;
  const descriptionId = `tg-modal-desc-${generatedId}`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return undefined;

    if (!dialog.open) {
      restoreFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    }

    return () => {
      if (dialog.open) {
        closingRef.current = true;
        dialog.close();
      }

      const restore = restoreFocusRef.current;
      restoreFocusRef.current = null;
      // Skip an element that has since left the document, or focus would land
      // on <body> and the user would lose their place entirely.
      if (restore && restore.isConnected) restore.focus();
    };
  }, [open]);

  const handleCancel = useCallback(
    (event: SyntheticEvent<HTMLDialogElement>) => {
      // Escape closes through the parent's state, not behind its back.
      event.preventDefault();
      if (dismissible) onClose();
    },
    [dismissible, onClose],
  );

  const handleNativeClose = useCallback(() => {
    // `close` is dispatched from a queued task, not synchronously from
    // `close()`, so the flag has to be cleared here rather than beside the call
    // that set it.
    if (closingRef.current) {
      closingRef.current = false;
      return;
    }

    // Something other than our own effect closed the dialog (a nested
    // `form method="dialog"`, say). Tell the parent so `open` catches up.
    onClose();
  }, [onClose]);

  const handleMouseDown = useCallback((event: MouseEvent<HTMLDialogElement>) => {
    pressedBackdropRef.current = event.target === dialogRef.current;
  }, []);

  const handleClick = useCallback(
    (event: MouseEvent<HTMLDialogElement>) => {
      const onBackdrop = event.target === dialogRef.current && pressedBackdropRef.current;
      pressedBackdropRef.current = false;
      if (onBackdrop && dismissible) onClose();
    },
    [dismissible, onClose],
  );

  return (
    <dialog
      ref={dialogRef}
      className={cn('tg-modal', className)}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={handleCancel}
      onClose={handleNativeClose}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      style={{ maxWidth: MAX_WIDTH[size], ...style }}
    >
      {/* Everything lives in the panel so a click landing on the <dialog>
          element itself is unambiguously a backdrop click. */}
      <div className="tg-modal__panel">
        <div className="tg-modal__header">
          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
            <h2 id={titleId} className="tg-modal__title">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="tg-modal__description">
                {description}
              </p>
            ) : null}
          </div>

          {dismissible ? (
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close dialog">
              <CloseIcon size={16} />
            </Button>
          ) : null}
        </div>

        {children ? <div className="tg-modal__body">{children}</div> : null}

        {footer ? <div className="tg-modal__footer">{footer}</div> : null}
      </div>
    </dialog>
  );
}
