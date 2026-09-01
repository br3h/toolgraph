'use client';

/**
 * The graph editor's single source of truth.
 *
 * The canvas, the run panel and the export panel all read from this hook and
 * none of them own graph state of their own. Keeping it in one place is what
 * lets a type-check computed when an edge is drawn still be correct when the
 * export panel reads it thirty seconds later.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CompatibilityResult,
  GraphEdge,
  GraphNode,
  McpServerConnection,
  McpToolDescriptor,
  ToolGraphDocument,
} from '@toolgraph/schema-core';
import { checkConnection } from '@toolgraph/schema-core';

import { saveGraph } from '@/app/graphs/actions';

/** How long after the last edit an autosave fires. */
const AUTOSAVE_DEBOUNCE_MS = 1200;

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export interface ConnectionAttempt {
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}

export interface GraphEditorState {
  document: ToolGraphDocument;
  tools: McpToolDescriptor[];
  saveState: SaveState;
  saveError: string | null;

  /** Compatibility verdict per edge id, recomputed whenever schemas change. */
  edgeResults: Map<string, CompatibilityResult>;
  /** The most recent rejected connection, for inline feedback on the canvas. */
  lastRejection: { attempt: ConnectionAttempt; result: CompatibilityResult } | null;

  setNodes: (updater: (nodes: GraphNode[]) => GraphNode[]) => void;
  setEdges: (updater: (edges: GraphEdge[]) => GraphEdge[]) => void;
  addServer: (server: McpServerConnection, tools: McpToolDescriptor[]) => void;
  removeServer: (serverId: string) => void;
  addToolNode: (tool: McpToolDescriptor, position: { x: number; y: number }) => void;
  removeNode: (nodeId: string) => void;
  setStaticInput: (nodeId: string, pointer: string, value: unknown) => void;
  rename: (name: string) => void;

  /** Type-checks first, and only creates the edge when the check passes. */
  tryConnect: (attempt: ConnectionAttempt) => CompatibilityResult;
  clearRejection: () => void;
  saveNow: () => void;
}

function toolKey(serverId: string, name: string): string {
  return `${serverId} ${name}`;
}

/** A stable id without depending on crypto.randomUUID in older browsers. */
function makeId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

export function useGraphEditor(
  graphId: string,
  initialDocument: ToolGraphDocument,
  initialTools: McpToolDescriptor[] = [],
): GraphEditorState {
  const [document, setDocument] = useState<ToolGraphDocument>(initialDocument);
  const [tools, setTools] = useState<McpToolDescriptor[]>(initialTools);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastRejection, setLastRejection] = useState<GraphEditorState['lastRejection']>(null);

  // A ref alongside the state, so the debounced save always writes the newest
  // document rather than the one captured when its timer was scheduled.
  const documentRef = useRef(document);
  documentRef.current = document;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstRender = useRef(true);

  const toolIndex = useMemo(() => {
    const index = new Map<string, McpToolDescriptor>();
    for (const tool of tools) index.set(toolKey(tool.serverId, tool.name), tool);
    return index;
  }, [tools]);

  /**
   * A node's effective schemas.
   *
   * The live tool descriptor wins over whatever was saved in the document: a
   * server can change its schemas under a saved graph, and the freshly
   * introspected shape is the one that will actually be called.
   */
  const schemasFor = useCallback(
    (node: GraphNode | undefined) => {
      if (!node) return { input: undefined, output: undefined };
      if (node.kind !== 'mcpTool') {
        return { input: node.data.inputSchema, output: node.data.outputSchema };
      }
      const tool =
        node.data.serverId && node.data.toolName
          ? toolIndex.get(toolKey(node.data.serverId, node.data.toolName))
          : undefined;
      return {
        input: tool?.inputSchema ?? node.data.inputSchema,
        output: tool?.outputSchema ?? node.data.outputSchema,
      };
    },
    [toolIndex],
  );

  const evaluate = useCallback(
    (attempt: ConnectionAttempt): CompatibilityResult => {
      const nodes = documentRef.current.nodes;
      const source = nodes.find((node) => node.id === attempt.source);
      const target = nodes.find((node) => node.id === attempt.target);

      if (!source || !target) {
        return {
          compatible: false,
          issues: [
            {
              code: 'pointer_not_found',
              severity: 'error',
              path: '',
              expected: 'a node',
              actual: 'nothing',
              message: 'One end of that connection no longer exists.',
            },
          ],
        };
      }

      const sourceSchemas = schemasFor(source);
      const targetSchemas = schemasFor(target);

      return checkConnection({
        sourceSchema: sourceSchemas.output,
        sourcePointer: attempt.sourceHandle,
        targetSchema: targetSchemas.input ?? {},
        targetPointer: attempt.targetHandle,
        sourceLabel: source.data.toolName ?? source.data.label,
        targetLabel: target.data.toolName ?? target.data.label,
      });
    },
    [schemasFor],
  );

  /**
   * Every edge re-checked whenever the graph or its schemas change.
   *
   * Recomputing all of them rather than caching per edge is deliberate: a
   * server's schemas can change under a saved graph, and a stale "compatible"
   * marking is worse than a slightly slower render.
   */
  const edgeResults = useMemo(() => {
    const results = new Map<string, CompatibilityResult>();
    for (const edge of document.edges) {
      results.set(
        edge.id,
        evaluate({
          source: edge.source,
          sourceHandle: edge.sourceHandle,
          target: edge.target,
          targetHandle: edge.targetHandle,
        }),
      );
    }
    return results;
  }, [document, evaluate]);

  const markDirty = useCallback(() => {
    setSaveState('dirty');
    setSaveError(null);
  }, []);

  const setNodes = useCallback(
    (updater: (nodes: GraphNode[]) => GraphNode[]) => {
      setDocument((current) => ({ ...current, nodes: updater(current.nodes) }));
      markDirty();
    },
    [markDirty],
  );

  const setEdges = useCallback(
    (updater: (edges: GraphEdge[]) => GraphEdge[]) => {
      setDocument((current) => ({ ...current, edges: updater(current.edges) }));
      markDirty();
    },
    [markDirty],
  );

  const tryConnect = useCallback(
    (attempt: ConnectionAttempt): CompatibilityResult => {
      const result = evaluate(attempt);

      if (!result.compatible) {
        setLastRejection({ attempt, result });
        return result;
      }

      setLastRejection(null);
      setDocument((current) => {
        // One edge per target field: a field fed twice has no defined winner.
        const withoutConflict = current.edges.filter(
          (edge) => !(edge.target === attempt.target && edge.targetHandle === attempt.targetHandle),
        );
        return {
          ...current,
          edges: [
            ...withoutConflict,
            {
              id: makeId('edge'),
              source: attempt.source,
              sourceHandle: attempt.sourceHandle,
              target: attempt.target,
              targetHandle: attempt.targetHandle,
            },
          ],
        };
      });
      markDirty();
      return result;
    },
    [evaluate, markDirty],
  );

  const addServer = useCallback(
    (server: McpServerConnection, serverTools: McpToolDescriptor[]) => {
      setDocument((current) => ({
        ...current,
        servers: [...current.servers.filter((s) => s.id !== server.id), server],
      }));
      setTools((current) => [
        ...current.filter((tool) => tool.serverId !== server.id),
        ...serverTools,
      ]);
      markDirty();
    },
    [markDirty],
  );

  const removeServer = useCallback(
    (serverId: string) => {
      setDocument((current) => {
        const doomed = new Set(
          current.nodes.filter((node) => node.data.serverId === serverId).map((node) => node.id),
        );
        return {
          ...current,
          servers: current.servers.filter((server) => server.id !== serverId),
          nodes: current.nodes.filter((node) => !doomed.has(node.id)),
          edges: current.edges.filter(
            (edge) => !doomed.has(edge.source) && !doomed.has(edge.target),
          ),
        };
      });
      setTools((current) => current.filter((tool) => tool.serverId !== serverId));
      markDirty();
    },
    [markDirty],
  );

  const addToolNode = useCallback(
    (tool: McpToolDescriptor, position: { x: number; y: number }) => {
      setDocument((current) => ({
        ...current,
        nodes: [
          ...current.nodes,
          {
            id: makeId('node'),
            kind: 'mcpTool',
            position,
            data: {
              label: tool.title ?? tool.name,
              serverId: tool.serverId,
              toolName: tool.name,
              inputSchema: tool.inputSchema,
              ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
            },
          },
        ],
      }));
      markDirty();
    },
    [markDirty],
  );

  const removeNode = useCallback(
    (nodeId: string) => {
      setDocument((current) => ({
        ...current,
        nodes: current.nodes.filter((node) => node.id !== nodeId),
        edges: current.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
      }));
      markDirty();
    },
    [markDirty],
  );

  const setStaticInput = useCallback(
    (nodeId: string, pointer: string, value: unknown) => {
      setDocument((current) => ({
        ...current,
        nodes: current.nodes.map((node) => {
          if (node.id !== nodeId) return node;
          const staticInputs = { ...(node.data.staticInputs ?? {}) };
          if (value === undefined || value === '') {
            delete staticInputs[pointer];
          } else {
            staticInputs[pointer] = value;
          }
          return { ...node, data: { ...node.data, staticInputs } };
        }),
      }));
      markDirty();
    },
    [markDirty],
  );

  const rename = useCallback(
    (name: string) => {
      setDocument((current) => ({ ...current, name }));
      markDirty();
    },
    [markDirty],
  );

  const persist = useCallback(async () => {
    setSaveState('saving');
    const result = await saveGraph(graphId, documentRef.current);
    if (result.ok) {
      setSaveState('saved');
      setSaveError(null);
    } else {
      setSaveState('error');
      setSaveError(result.error ?? 'Could not save.');
    }
  }, [graphId]);

  const saveNow = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    void persist();
  }, [persist]);

  // Debounced autosave. Skipped on the first render so merely opening a graph
  // does not write a new version into its history.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void persist(), AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [document, persist]);

  const clearRejection = useCallback(() => setLastRejection(null), []);

  return {
    document,
    tools,
    saveState,
    saveError,
    edgeResults,
    lastRejection,
    setNodes,
    setEdges,
    addServer,
    removeServer,
    addToolNode,
    removeNode,
    setStaticInput,
    rename,
    tryConnect,
    clearRejection,
    saveNow,
  };
}
