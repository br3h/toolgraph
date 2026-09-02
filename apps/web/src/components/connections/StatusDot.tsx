import { cn } from '@toolgraph/ui';

import { STATUS_LABEL, type ConnectionStatus } from '@/lib/connections/model';

/**
 * The health indicator.
 *
 * Deliberately not colour alone: this design system is monochrome, so the three
 * states are distinguished by fill — hollow for never tested, solid for
 * connected, ringed for failing — and every one is followed by its word. A dot
 * whose meaning depends on hue is unreadable to a meaningful fraction of people
 * and, here, would not be distinguishable at all.
 */
export function StatusDot({ status }: { status: ConnectionStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className={cn(
          'inline-block h-2 w-2 shrink-0 rounded-full border',
          status === 'connected' && 'border-fg bg-fg',
          status === 'failing' && 'border-2 border-fg bg-transparent',
          status === 'untested' && 'border-border-strong bg-transparent',
        )}
      />
      <span className="text-xs text-fg-muted">{STATUS_LABEL[status]}</span>
    </span>
  );
}
