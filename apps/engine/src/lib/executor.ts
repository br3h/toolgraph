/**
 * Graph execution.
 *
 * Stateless per run: everything needed arrives in one request and nothing
 * survives it. That is what makes the engine safe to host on a plan that sleeps
 * after fifteen minutes and drops open connections when it does.
 *
 * Progress is reported through an `emit` callback rather than written to a
 * socket, so the transport (SSE today) stays out of the execution logic and the
 * whole thing is testable without a server.
 */

import type {
  ExecutionEvent,
  ExecutionStepResult,
  GraphEdge,
  GraphNode,
  McpConnectionSecrets,
  McpServerConnection,
  ToolGraphDocument,
} from '@toolgraph/schema-core';

import { getAtPointer, setAtPointer } from './values';

/** A run cannot exceed this, whatever the graph says. */
export const MAX_STEPS = 50;
export const MAX_RUN_MS = 120_000;

export interface ToolInvoker {
  /** Call one tool on one server, returning its raw result. */
  call(
    connection: McpServerConnection,
    secrets: McpConnectionSecrets | undefined,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown>;
  /** Release anything the invoker opened. Always called, even on failure. */
  dispose(): Promise<void>;
}

export interface ExecuteGraphOptions {
  runId: string;
  document: ToolGraphDocument;
  /** Values for the graph's `input` nodes, keyed by node id. */
  input?: Record<string, unknown>;
  /** Per-server credentials, keyed by server id. Never persisted. */
  secrets?: Record<string, McpConnectionSecrets>;
  invoker: ToolInvoker;
  emit: (event: ExecutionEvent) => void;
  now?: () => number;
  signal?: AbortSignal;
}

export interface ExecuteGraphResult {
  status: 'succeeded' | 'failed';
  steps: ExecutionStepResult[];
}

export class GraphCycleError extends Error {
  constructor(public readonly nodeIds: string[]) {
    super(
      `The graph contains a cycle through ${nodeIds.map((id) => `\`${id}\``).join(' -> ')}, so it has no execution order.`,
    );
    this.name = 'GraphCycleError';
  }
}

/**
 * Order nodes so every node comes after the ones feeding it.
 *
 * Kahn's algorithm, with ties broken by the node's position in the document so
 * the same graph always runs in the same order — a run that reorders itself
 * between attempts is impossible to debug.
 */
export function topologicalOrder(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const indegree = new Map<string, number>(nodes.map((node) => [node.id, 0]));
  const dependents = new Map<string, string[]>();

  for (const edge of edges) {
    // An edge naming a node that is not in the document is ignored rather than
    // fatal: a stale edge should not make a whole graph unrunnable.
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    dependents.set(edge.source, [...(dependents.get(edge.source) ?? []), edge.target]);
  }

  const order: GraphNode[] = [];
  const ready = nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0);

  while (ready.length > 0) {
    const node = ready.shift();
    if (!node) break;
    order.push(node);

    for (const dependentId of dependents.get(node.id) ?? []) {
      const remaining = (indegree.get(dependentId) ?? 0) - 1;
      indegree.set(dependentId, remaining);
      if (remaining === 0) {
        const dependent = byId.get(dependentId);
        if (dependent) ready.push(dependent);
      }
    }
  }

  if (order.length !== nodes.length) {
    const stuck = nodes.filter((node) => !order.some((seen) => seen.id === node.id));
    throw new GraphCycleError(stuck.map((node) => node.id));
  }

  return order;
}

/** Build one node's arguments from its incoming edges and its static inputs. */
export function buildStepInput(
  node: GraphNode,
  incoming: GraphEdge[],
  outputs: Map<string, unknown>,
): Record<string, unknown> {
  let args: unknown = {};

  // Static values first, so an edge feeding the same field wins over a literal
  // the user left behind. The edge is the more deliberate statement of intent.
  for (const [pointer, value] of Object.entries(node.data.staticInputs ?? {})) {
    args = setAtPointer(args, pointer, value);
  }

  for (const edge of incoming) {
    if (!outputs.has(edge.source)) continue;
    const sourceValue = getAtPointer(outputs.get(edge.source), edge.sourceHandle);
    // An edge carrying nothing writes nothing, rather than writing `undefined`
    // and turning a missing optional into an explicit null downstream.
    if (sourceValue === undefined) continue;
    args = setAtPointer(args, edge.targetHandle, sourceValue);
  }

  return (args && typeof args === 'object' && !Array.isArray(args) ? args : {}) as Record<
    string,
    unknown
  >;
}

export async function executeGraph(options: ExecuteGraphOptions): Promise<ExecuteGraphResult> {
  const { runId, document, invoker, emit, input = {}, secrets = {}, signal } = options;
  const now = options.now ?? (() => Date.now());

  const startedAtMs = now();
  const steps: ExecutionStepResult[] = [];
  const outputs = new Map<string, unknown>();
  const serversById = new Map(document.servers.map((server) => [server.id, server]));

  const order = topologicalOrder(document.nodes, document.edges);
  const runnable = order.filter((node) => node.kind === 'mcpTool');

  if (runnable.length > MAX_STEPS) {
    throw new Error(
      `This graph has ${runnable.length} tool steps, more than the ${MAX_STEPS} a single run allows.`,
    );
  }

  emit({
    type: 'run:start',
    runId,
    totalSteps: runnable.length,
    at: new Date(startedAtMs).toISOString(),
  });

  let failed = false;

  try {
    for (const node of order) {
      // Boundary nodes carry values rather than doing work.
      if (node.kind === 'input') {
        outputs.set(node.id, input[node.id]);
        continue;
      }
      if (node.kind === 'output') {
        const incoming = document.edges.filter((edge) => edge.target === node.id);
        outputs.set(node.id, buildStepInput(node, incoming, outputs));
        continue;
      }

      // Once a step has failed, the rest cannot have their inputs, so they are
      // reported as skipped rather than silently dropped.
      if (failed) {
        steps.push({
          nodeId: node.id,
          ...(node.data.toolName ? { toolName: node.data.toolName } : {}),
          status: 'skipped',
          startedAt: new Date(now()).toISOString(),
        });
        continue;
      }

      if (signal?.aborted) throw new Error('The run was cancelled.');
      if (now() - startedAtMs > MAX_RUN_MS) {
        throw new Error(`The run exceeded its ${MAX_RUN_MS / 1000}s budget.`);
      }

      const stepStartedMs = now();
      const stepStartedAt = new Date(stepStartedMs).toISOString();

      emit({
        type: 'step:start',
        runId,
        nodeId: node.id,
        ...(node.data.toolName ? { toolName: node.data.toolName } : {}),
        at: stepStartedAt,
      });

      const incoming = document.edges.filter((edge) => edge.target === node.id);
      const args = buildStepInput(node, incoming, outputs);

      let step: ExecutionStepResult;

      try {
        const server = node.data.serverId ? serversById.get(node.data.serverId) : undefined;
        if (!server) {
          throw new Error(
            `Node \`${node.data.label}\` refers to server \`${node.data.serverId ?? 'none'}\`, which is not part of this graph.`,
          );
        }
        if (!node.data.toolName) {
          throw new Error(`Node \`${node.data.label}\` does not name a tool to call.`);
        }

        const output = await invoker.call(server, secrets[server.id], node.data.toolName, args);
        outputs.set(node.id, output);

        const finishedMs = now();
        step = {
          nodeId: node.id,
          toolName: node.data.toolName,
          status: 'succeeded',
          startedAt: stepStartedAt,
          finishedAt: new Date(finishedMs).toISOString(),
          durationMs: finishedMs - stepStartedMs,
          input: args,
          output,
        };
      } catch (error) {
        failed = true;
        const finishedMs = now();
        step = {
          nodeId: node.id,
          ...(node.data.toolName ? { toolName: node.data.toolName } : {}),
          status: 'failed',
          startedAt: stepStartedAt,
          finishedAt: new Date(finishedMs).toISOString(),
          durationMs: finishedMs - stepStartedMs,
          input: args,
          error: error instanceof Error ? error.message : 'The tool call failed.',
        };
      }

      steps.push(step);
      emit({ type: 'step:finish', runId, step });
    }
  } finally {
    await invoker.dispose().catch(() => {
      // Disposal problems must not mask the run's own outcome.
    });
  }

  const status = failed ? 'failed' : 'succeeded';
  emit({ type: 'run:finish', runId, status, steps, at: new Date(now()).toISOString() });

  return { status, steps };
}
