'use client';

/**
 * The live test-run panel.
 *
 * Two things it must get right: a graph that does not type-check cannot be run
 * (and the button says exactly why), and the free-tier cold start is explained
 * rather than looking like a hang.
 */

import { useMemo, useState } from 'react';
import type { ExecutionStepResult } from '@toolgraph/schema-core';
import {
  Alert,
  Button,
  ErrorIcon,
  InfoIcon,
  Modal,
  Spinner,
  SuccessIcon,
  WarningIcon,
} from '@toolgraph/ui';

import type { GraphEditorState } from '@/hooks/useGraphEditor';
import { useGraphRun } from './useGraphRun';

export interface RunPanelProps {
  editor: GraphEditorState;
  graphId: string;
  open: boolean;
  onClose: () => void;
  /**
   * Saved connections on this canvas that have a stored credential. Their
   * presence routes the run through the server so the credential can be
   * decrypted there instead of in the browser.
   */
  credentialConnectionIds?: readonly string[];
}

/** Status is carried by an icon and a word — never by colour. */
function StepStatus({ status }: { status: ExecutionStepResult['status'] }) {
  const spec = {
    pending: { Icon: InfoIcon, label: 'Pending' },
    running: { Icon: null, label: 'Running' },
    succeeded: { Icon: SuccessIcon, label: 'Succeeded' },
    failed: { Icon: ErrorIcon, label: 'Failed' },
    skipped: { Icon: WarningIcon, label: 'Skipped' },
  }[status];

  return (
    <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-fg">
      {spec.Icon ? <spec.Icon size={14} aria-hidden /> : <Spinner size="sm" />}
      {spec.label}
    </span>
  );
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? 'undefined';
  } catch {
    return String(value);
  }
}

function StepRow({ step }: { step: ExecutionStepResult }) {
  const [expanded, setExpanded] = useState(step.status === 'failed');
  const hasDetail = step.input !== undefined || step.output !== undefined || Boolean(step.error);

  return (
    <li className="border-b border-border-subtle last:border-b-0">
      <div className="flex items-center gap-3 px-3 py-2">
        <StepStatus status={step.status} />
        <span className="min-w-0 flex-1 truncate text-sm text-fg">
          {step.toolName ?? step.nodeId}
        </span>
        {typeof step.durationMs === 'number' ? (
          <span className="shrink-0 text-xs tabular-nums text-fg-subtle">{step.durationMs} ms</span>
        ) : null}
        {hasDetail ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 text-[10px] font-medium text-fg-muted transition-colors hover:text-fg"
            aria-expanded={expanded}
          >
            {expanded ? 'Hide' : 'Details'}
          </button>
        ) : null}
      </div>

      {expanded ? (
        <div className="space-y-2 border-t border-border-subtle bg-bg-subtle px-3 py-2">
          {step.error ? (
            <Alert variant="error" title="This step failed">
              {step.error}
            </Alert>
          ) : null}

          {step.input !== undefined ? (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                Sent
              </p>
              <pre className="max-h-40 overflow-auto rounded-[var(--tg-radius-sm)] border border-border bg-bg p-2 font-mono text-[11px] leading-relaxed text-fg">
                {formatJson(step.input)}
              </pre>
            </div>
          ) : null}

          {step.output !== undefined ? (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                Returned
              </p>
              <pre className="max-h-40 overflow-auto rounded-[var(--tg-radius-sm)] border border-border bg-bg p-2 font-mono text-[11px] leading-relaxed text-fg">
                {formatJson(step.output)}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Hoisted so the default is referentially stable. A `= []` in the destructure
 * would build a new array on every render, which changes the identity of the
 * `start` callback in `useGraphRun` and defeats its memoisation.
 */
const NO_CREDENTIAL_CONNECTIONS: readonly string[] = [];

export function RunPanel({
  editor,
  graphId,
  open,
  onClose,
  credentialConnectionIds = NO_CREDENTIAL_CONNECTIONS,
}: RunPanelProps) {
  const run = useGraphRun(editor, graphId, credentialConnectionIds);

  const toolNodeCount = editor.document.nodes.filter((node) => node.kind === 'mcpTool').length;

  /** A graph with a failing edge cannot run — say which edge, not just "no". */
  const blockingEdges = useMemo(
    () =>
      [...editor.edgeResults.entries()].filter(([, result]) =>
        result.issues.some((issue) => issue.severity === 'error'),
      ),
    [editor.edgeResults],
  );

  const blocked = blockingEdges.length > 0;
  const busy = run.phase === 'running' || run.phase === 'waking';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Test run"
      description="Runs the graph against the real servers, streaming each step back as it finishes."
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-fg-muted">
            {toolNodeCount} step{toolNodeCount === 1 ? '' : 's'}
          </span>
          <div className="flex gap-2">
            {busy ? (
              <Button variant="secondary" onClick={run.cancel}>
                Cancel
              </Button>
            ) : (
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
            )}
            <Button
              variant="primary"
              onClick={() => run.start()}
              loading={busy}
              disabled={blocked || toolNodeCount === 0}
              data-testid="run-start"
            >
              {run.phase === 'idle' ? 'Run graph' : 'Run again'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {blocked ? (
          <Alert variant="error" title="This graph does not type-check yet">
            {blockingEdges.length} connection{blockingEdges.length === 1 ? '' : 's'} still
            {blockingEdges.length === 1 ? ' has' : ' have'} a type error. Running would fail at that
            step, so fix the connections first — the canvas shows each mismatch inline.
          </Alert>
        ) : null}

        {toolNodeCount === 0 ? (
          <Alert variant="info" title="Nothing to run">
            Add at least one tool to the canvas first.
          </Alert>
        ) : null}

        {run.wakingUp ? (
          <div className="flex items-start gap-3 rounded-[var(--tg-radius-md)] border border-border p-3">
            <Spinner size="sm" />
            <div>
              <p className="text-sm font-medium text-fg">Waking up the execution engine</p>
              <p className="mt-0.5 text-xs text-fg-muted">
                The engine runs on a free plan that sleeps after fifteen minutes of inactivity. The
                first run takes about a minute to start; the rest are fast.
              </p>
            </div>
          </div>
        ) : null}

        {run.error ? (
          <Alert variant="error" title="The run could not finish">
            {run.error}
          </Alert>
        ) : null}

        {run.phase === 'succeeded' && run.steps.length > 0 ? (
          <Alert variant="success" title="Every step succeeded" />
        ) : null}

        {run.phase === 'cancelled' ? <Alert variant="warning" title="Run cancelled" /> : null}

        {run.steps.length > 0 ? (
          <ul className="overflow-hidden rounded-[var(--tg-radius-md)] border border-border">
            {run.steps.map((step) => (
              <StepRow key={step.nodeId} step={step} />
            ))}
          </ul>
        ) : null}
      </div>
    </Modal>
  );
}
