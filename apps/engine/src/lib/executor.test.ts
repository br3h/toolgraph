import { describe, expect, it, vi } from 'vitest';
import type {
  ExecutionEvent,
  GraphEdge,
  GraphNode,
  ToolGraphDocument,
} from '@toolgraph/schema-core';

import {
  buildStepInput,
  executeGraph,
  GraphCycleError,
  topologicalOrder,
  type ToolInvoker,
} from './executor';

function toolNode(id: string, toolName: string, extra: Partial<GraphNode['data']> = {}): GraphNode {
  return {
    id,
    kind: 'mcpTool',
    position: { x: 0, y: 0 },
    data: { label: id, serverId: 'srv', toolName, ...extra },
  };
}

function edge(
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
): GraphEdge {
  return { id: `${source}->${target}`, source, sourceHandle, target, targetHandle };
}

function doc(nodes: GraphNode[], edges: GraphEdge[]): ToolGraphDocument {
  return {
    version: 1,
    name: 'test',
    nodes,
    edges,
    servers: [
      { id: 'srv', name: 'Test server', transport: 'http', url: 'https://example.com/mcp' },
    ],
  };
}

/** Records every call and returns whatever the script says. */
function fakeInvoker(
  script: Record<string, unknown | ((args: Record<string, unknown>) => unknown)>,
) {
  const calls: { tool: string; args: Record<string, unknown> }[] = [];
  const invoker: ToolInvoker = {
    async call(_connection, _secrets, toolName, args) {
      calls.push({ tool: toolName, args });
      const entry = script[toolName];
      if (typeof entry === 'function') {
        return (entry as (a: Record<string, unknown>) => unknown)(args);
      }
      return entry ?? {};
    },
    dispose: vi.fn(async () => {}),
  };
  return { invoker, calls };
}

/* -------------------------------------------------------------------------- */

describe('topologicalOrder', () => {
  it('orders a simple chain', () => {
    const nodes = [toolNode('c', 'c'), toolNode('a', 'a'), toolNode('b', 'b')];
    const edges = [edge('a', '', 'b', '/x'), edge('b', '', 'c', '/y')];

    expect(topologicalOrder(nodes, edges).map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('is deterministic for independent nodes', () => {
    const nodes = [toolNode('a', 'a'), toolNode('b', 'b')];
    const first = topologicalOrder(nodes, []).map((n) => n.id);
    const second = topologicalOrder(nodes, []).map((n) => n.id);
    expect(first).toEqual(second);
  });

  it('reports a cycle instead of looping', () => {
    const nodes = [toolNode('a', 'a'), toolNode('b', 'b')];
    const edges = [edge('a', '', 'b', '/x'), edge('b', '', 'a', '/y')];

    expect(() => topologicalOrder(nodes, edges)).toThrow(GraphCycleError);
  });

  it('ignores an edge naming a node that is not in the document', () => {
    const nodes = [toolNode('a', 'a')];
    const edges = [edge('ghost', '', 'a', '/x')];
    expect(topologicalOrder(nodes, edges).map((n) => n.id)).toEqual(['a']);
  });
});

describe('buildStepInput', () => {
  it('merges static inputs with edge-supplied values', () => {
    const node = toolNode('b', 'b', { staticInputs: { '/limit': 10 } });
    const outputs = new Map<string, unknown>([['a', { user: { id: 'u1' } }]]);

    const input = buildStepInput(node, [edge('a', '/user/id', 'b', '/userId')], outputs);
    expect(input).toEqual({ limit: 10, userId: 'u1' });
  });

  it('lets an edge win over a static value for the same field', () => {
    const node = toolNode('b', 'b', { staticInputs: { '/userId': 'static' } });
    const outputs = new Map<string, unknown>([['a', { id: 'from-edge' }]]);

    const input = buildStepInput(node, [edge('a', '/id', 'b', '/userId')], outputs);
    expect(input).toEqual({ userId: 'from-edge' });
  });

  it('writes nothing when the source value is absent', () => {
    const node = toolNode('b', 'b');
    const outputs = new Map<string, unknown>([['a', {}]]);

    const input = buildStepInput(node, [edge('a', '/missing', 'b', '/userId')], outputs);
    expect(input).toEqual({});
    expect('userId' in input).toBe(false);
  });

  it('builds nested target fields', () => {
    const node = toolNode('b', 'b');
    const outputs = new Map<string, unknown>([['a', { id: 7 }]]);

    const input = buildStepInput(node, [edge('a', '/id', 'b', '/options/userId')], outputs);
    expect(input).toEqual({ options: { userId: 7 } });
  });
});

describe('executeGraph', () => {
  it('runs a two-step chain and pipes the first output into the second', async () => {
    const document = doc(
      [toolNode('a', 'createUser'), toolNode('b', 'sendEmail')],
      [edge('a', '/user/id', 'b', '/userId')],
    );

    const { invoker, calls } = fakeInvoker({
      createUser: { user: { id: 'u-42' } },
      sendEmail: { sent: true },
    });

    const events: ExecutionEvent[] = [];
    const result = await executeGraph({
      runId: 'run-1',
      document,
      invoker,
      emit: (e) => events.push(e),
    });

    expect(result.status).toBe('succeeded');
    expect(result.steps).toHaveLength(2);
    expect(calls[1]?.args).toEqual({ userId: 'u-42' });

    expect(events[0]?.type).toBe('run:start');
    expect(events.at(-1)?.type).toBe('run:finish');
    expect(events.filter((e) => e.type === 'step:start')).toHaveLength(2);
    expect(events.filter((e) => e.type === 'step:finish')).toHaveLength(2);
  });

  it('marks later steps skipped once one fails, and reports failure', async () => {
    const document = doc(
      [toolNode('a', 'boom'), toolNode('b', 'never')],
      [edge('a', '', 'b', '/in')],
    );

    const invoker: ToolInvoker = {
      async call(_c, _s, toolName) {
        if (toolName === 'boom') throw new Error('the tool exploded');
        return {};
      },
      dispose: async () => {},
    };

    const result = await executeGraph({
      runId: 'run-2',
      document,
      invoker,
      emit: () => {},
    });

    expect(result.status).toBe('failed');
    expect(result.steps[0]?.status).toBe('failed');
    expect(result.steps[0]?.error).toContain('the tool exploded');
    expect(result.steps[1]?.status).toBe('skipped');
  });

  it('always disposes the invoker, even when a step throws', async () => {
    const dispose = vi.fn(async () => {});
    const document = doc([toolNode('a', 'boom')], []);

    await executeGraph({
      runId: 'run-3',
      document,
      invoker: {
        async call() {
          throw new Error('nope');
        },
        dispose,
      },
      emit: () => {},
    });

    expect(dispose).toHaveBeenCalledOnce();
  });

  it('fails the step when a node names a server the graph does not contain', async () => {
    const node = toolNode('a', 'x');
    node.data.serverId = 'missing-server';
    const document = doc([node], []);

    const { invoker } = fakeInvoker({});
    const result = await executeGraph({ runId: 'r', document, invoker, emit: () => {} });

    expect(result.status).toBe('failed');
    expect(result.steps[0]?.error).toContain('missing-server');
  });

  it('feeds input nodes from the run payload', async () => {
    const inputNode: GraphNode = {
      id: 'in',
      kind: 'input',
      position: { x: 0, y: 0 },
      data: { label: 'input' },
    };
    const document = doc([inputNode, toolNode('a', 'echo')], [edge('in', '/name', 'a', '/name')]);

    const { invoker, calls } = fakeInvoker({ echo: {} });

    await executeGraph({
      runId: 'r',
      document,
      input: { in: { name: 'toolgraph' } },
      invoker,
      emit: () => {},
    });

    expect(calls[0]?.args).toEqual({ name: 'toolgraph' });
  });

  it('refuses a graph with more steps than a single run allows', async () => {
    const nodes = Array.from({ length: 51 }, (_, i) => toolNode(`n${i}`, 't'));
    const { invoker } = fakeInvoker({ t: {} });

    await expect(
      executeGraph({ runId: 'r', document: doc(nodes, []), invoker, emit: () => {} }),
    ).rejects.toThrow(/50/);
  });

  it('propagates a cycle as an error rather than hanging', async () => {
    const document = doc(
      [toolNode('a', 'a'), toolNode('b', 'b')],
      [edge('a', '', 'b', '/x'), edge('b', '', 'a', '/y')],
    );
    const { invoker } = fakeInvoker({});

    await expect(executeGraph({ runId: 'r', document, invoker, emit: () => {} })).rejects.toThrow(
      GraphCycleError,
    );
  });
});
