'use client';

/**
 * A connection, drawn according to whether it type-checks.
 *
 * This is the one place in toolgraph where a signal is carried by something
 * other than text and weight. A canvas at low zoom cannot show a label on every
 * edge, and greyscale alone cannot separate "checked and fine" from "rejected".
 * So a failing edge gets a dashed stroke — a pattern, not a hue — and that
 * exception is documented in packages/ui/src/styles.css and the README.
 */

import { memo } from 'react';
import { EdgeLabelRenderer, getBezierPath, type EdgeProps } from 'reactflow';
import type { CompatibilityResult } from '@toolgraph/schema-core';
import { Tooltip } from '@toolgraph/ui';

export interface TypedEdgeData {
  result?: CompatibilityResult;
}

function TypedEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
  selected,
}: EdgeProps<TypedEdgeData>) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const issues = data?.result?.issues ?? [];
  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');

  const hasErrors = errors.length > 0;
  const hasWarnings = !hasErrors && warnings.length > 0;

  const className = hasErrors
    ? 'tg-edge-path--invalid'
    : hasWarnings
      ? 'tg-edge-path--pending'
      : undefined;

  const first = errors[0] ?? warnings[0];

  return (
    <>
      {/*
        Rendered directly rather than through reactflow's BaseEdge, which takes
        no className. The dash pattern must come from the documented
        `.tg-edge-path--invalid` rule in packages/ui/src/styles.css rather than
        an inline strokeDasharray, so the one exception to the monochrome rule
        stays defined in exactly one place.
      */}
      <path
        id={id}
        d={path}
        fill="none"
        markerEnd={markerEnd}
        className={['react-flow__edge-path', className].filter(Boolean).join(' ')}
        style={{ strokeWidth: selected ? 2 : 1.5 }}
      />

      {first ? (
        <EdgeLabelRenderer>
          <div
            // reactflow renders labels in a transform layer that ignores pointer
            // events by default; the badge has a tooltip so it needs them back.
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
          >
            <Tooltip content={first.message}>
              <button
                type="button"
                className="cursor-help rounded-full border border-border-strong bg-bg-raised px-1.5 py-0.5 text-[10px] font-semibold text-fg shadow-[var(--tg-shadow-sm)]"
                aria-label={first.message}
              >
                {hasErrors
                  ? `${errors.length} error${errors.length === 1 ? '' : 's'}`
                  : `${warnings.length} warning${warnings.length === 1 ? '' : 's'}`}
              </button>
            </Tooltip>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const TypedEdge = memo(TypedEdgeComponent);
