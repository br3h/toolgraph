'use client';

/**
 * One MCP tool on the canvas.
 *
 * Inputs are handles down the left, outputs down the right, each addressing a
 * specific field by JSON pointer. Showing the fields rather than a single
 * node-level port is the whole reason the type check can be precise: you
 * connect `createUser.user.id` to `sendEmail.userId`, not "tool A" to "tool B".
 */

import { memo, useMemo, useState } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import type { JsonSchema, SchemaField } from '@toolgraph/schema-core';
import { listSchemaFields } from '@toolgraph/schema-core';
import { cn } from '@toolgraph/ui';

import { encodeHandle } from './handles';

/** Past this many fields the node scrolls rather than growing without bound. */
const VISIBLE_FIELDS = 8;

export interface ToolNodeData {
  label: string;
  toolName?: string;
  serverName?: string;
  description?: string;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  staticInputs?: Record<string, unknown>;
  onRemove?: (nodeId: string) => void;
}

/**
 * Fields worth offering as connection points.
 *
 * The root is included — wiring a whole object into a whole parameter is
 * common — but a bare scalar root would duplicate its own only field, so it is
 * dropped when there is nothing else to show.
 */
function connectableFields(schema: JsonSchema | undefined): SchemaField[] {
  if (!schema) return [];

  const fields = listSchemaFields(schema, { maxDepth: 3 });
  if (fields.length <= 1) return fields;

  const root = fields[0];
  const rest = fields.filter((field) => field.pointer !== '');

  // Keep the root only when it is a container; a scalar root is its own field.
  const rootIsContainer =
    root?.typeLabel.startsWith('{') ||
    root?.typeLabel.startsWith('Array') ||
    root?.typeLabel.startsWith('Record');

  return rootIsContainer && root ? [root, ...rest] : rest;
}

function FieldRow({
  field,
  direction,
  bound,
}: {
  field: SchemaField;
  direction: 'in' | 'out';
  bound: boolean;
}) {
  const isInput = direction === 'in';
  const name = field.pointer === '' ? 'whole value' : field.name;

  return (
    <div
      className={cn(
        'group/field relative flex items-center gap-1.5 px-3 py-1',
        isInput ? 'justify-start' : 'justify-end text-right',
      )}
      style={{ paddingLeft: isInput ? 14 : undefined, paddingRight: isInput ? undefined : 14 }}
    >
      <Handle
        type={isInput ? 'target' : 'source'}
        position={isInput ? Position.Left : Position.Right}
        id={encodeHandle(direction, field.pointer)}
        // reactflow positions handles absolutely; nudging them onto the node's
        // edge keeps the hit target aligned with the row it belongs to.
        style={{ [isInput ? 'left' : 'right']: -5, top: '50%' } as React.CSSProperties}
      />

      <span className="min-w-0 truncate text-[11px] font-medium text-fg" title={name}>
        {name}
        {field.required ? (
          <span className="ml-0.5 font-bold text-fg" title="Required" aria-label="required">
            *
          </span>
        ) : null}
      </span>
      <span
        className="shrink-0 truncate text-[10px] text-fg-subtle"
        title={field.typeLabel}
        style={{ maxWidth: 96 }}
      >
        {field.typeLabel}
      </span>
      {bound ? (
        <span
          className="shrink-0 rounded-sm border border-border px-1 text-[9px] text-fg-muted"
          title="A fixed value is set for this field"
        >
          set
        </span>
      ) : null}
    </div>
  );
}

function ToolNodeComponent({ id, data, selected }: NodeProps<ToolNodeData>) {
  const [expanded, setExpanded] = useState(false);

  const inputFields = useMemo(() => connectableFields(data.inputSchema), [data.inputSchema]);
  const outputFields = useMemo(() => connectableFields(data.outputSchema), [data.outputSchema]);

  const hasOutputSchema = Boolean(data.outputSchema);
  const staticPointers = new Set(Object.keys(data.staticInputs ?? {}));

  const shownInputs = expanded ? inputFields : inputFields.slice(0, VISIBLE_FIELDS);
  const shownOutputs = expanded ? outputFields : outputFields.slice(0, VISIBLE_FIELDS);
  const hiddenCount =
    inputFields.length - shownInputs.length + (outputFields.length - shownOutputs.length);

  return (
    <div
      className={cn(
        'w-[340px] overflow-hidden rounded-[var(--tg-radius-lg)] border bg-bg-raised shadow-[var(--tg-shadow-sm)]',
        selected ? 'border-border-strong shadow-[var(--tg-shadow-md)]' : 'border-border',
      )}
    >
      <header className="flex items-start justify-between gap-2 border-b border-border-subtle bg-bg-subtle px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold tracking-tight text-fg">
            {data.toolName ?? data.label}
          </p>
          {data.serverName ? (
            <p className="truncate text-[10px] text-fg-subtle">{data.serverName}</p>
          ) : null}
        </div>
        {data.onRemove ? (
          <button
            type="button"
            onClick={() => data.onRemove?.(id)}
            aria-label={`Remove ${data.toolName ?? data.label}`}
            className="nodrag shrink-0 rounded-sm border border-transparent px-1.5 text-xs leading-5 text-fg-muted transition-colors hover:border-border hover:text-fg"
          >
            &times;
          </button>
        ) : null}
      </header>

      {data.description ? (
        <p className="border-b border-border-subtle px-3 py-1.5 text-[10px] leading-relaxed text-fg-muted">
          {data.description.length > 120
            ? `${data.description.slice(0, 120).trimEnd()}...`
            : data.description}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-x-2 py-1.5">
        <div className="min-w-0 border-r border-border-subtle">
          <p className="px-3 pb-1 text-[9px] font-semibold uppercase tracking-wider text-fg-subtle">
            Input
          </p>
          {shownInputs.length === 0 ? (
            <p className="px-3 py-1 text-[10px] text-fg-subtle">No parameters</p>
          ) : (
            shownInputs.map((field) => (
              <FieldRow
                key={`in-${field.pointer}`}
                field={field}
                direction="in"
                bound={staticPointers.has(field.pointer)}
              />
            ))
          )}
        </div>

        <div className="min-w-0">
          <p className="px-3 pb-1 text-right text-[9px] font-semibold uppercase tracking-wider text-fg-subtle">
            Output
          </p>
          {!hasOutputSchema ? (
            <>
              <FieldRow
                field={{
                  pointer: '',
                  name: '',
                  typeLabel: 'unknown',
                  schema: {},
                  required: false,
                  depth: 0,
                }}
                direction="out"
                bound={false}
              />
              {/* An unproven output is a real, common situation — say so rather
                  than implying the tool returns nothing. */}
              <p className="px-3 py-1 text-right text-[10px] italic text-fg-subtle">
                This server declares no output schema
              </p>
            </>
          ) : shownOutputs.length === 0 ? (
            <p className="px-3 py-1 text-right text-[10px] text-fg-subtle">No fields</p>
          ) : (
            shownOutputs.map((field) => (
              <FieldRow key={`out-${field.pointer}`} field={field} direction="out" bound={false} />
            ))
          )}
        </div>
      </div>

      {hiddenCount > 0 || expanded ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="nodrag w-full border-t border-border-subtle px-3 py-1.5 text-[10px] font-medium text-fg-muted transition-colors hover:bg-bg-sunken hover:text-fg"
        >
          {expanded
            ? 'Show fewer fields'
            : `Show ${hiddenCount} more field${hiddenCount === 1 ? '' : 's'}`}
        </button>
      ) : null}
    </div>
  );
}

export const ToolNode = memo(ToolNodeComponent);
