'use client';

/**
 * The canvas.
 *
 * reactflow owns the viewport and the interaction; this component owns the
 * translation between reactflow's node/edge shapes and the graph document, and
 * the rule that an edge only comes into existence if it type-checks.
 */

import { useCallback, useMemo } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlowProvider,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeChange,
  type NodeTypes,
} from 'reactflow';
import { EmptyState } from '@toolgraph/ui';

import 'reactflow/dist/style.css';

import type { GraphEditorState } from '@/hooks/useGraphEditor';
import { ToolNode, type ToolNodeData } from './ToolNode';
import { TypedEdge, type TypedEdgeData } from './TypedEdge';
import { decodeHandle } from './handles';

export interface GraphCanvasProps {
  editor: GraphEditorState;
}

// Defined once at module scope: reactflow warns, and remounts every node, when
// these objects change identity between renders.
const nodeTypes: NodeTypes = { mcpTool: ToolNode };
const edgeTypes: EdgeTypes = { typed: TypedEdge };

function InnerCanvas({ editor }: GraphCanvasProps) {
  const { document, tools, edgeResults, setNodes, setEdges, removeNode, tryConnect } = editor;

  const serverNames = useMemo(
    () => new Map(document.servers.map((server) => [server.id, server.name])),
    [document.servers],
  );

  const toolIndex = useMemo(() => {
    const index = new Map<string, (typeof tools)[number]>();
    for (const tool of tools) index.set(`${tool.serverId} ${tool.name}`, tool);
    return index;
  }, [tools]);

  const nodes = useMemo<Node<ToolNodeData>[]>(
    () =>
      document.nodes.map((node) => {
        // Prefer the freshly introspected schemas over whatever was saved: a
        // server can change under a stored graph, and the live shape is the one
        // that will actually be called.
        const tool =
          node.data.serverId && node.data.toolName
            ? toolIndex.get(`${node.data.serverId} ${node.data.toolName}`)
            : undefined;

        return {
          id: node.id,
          type: 'mcpTool',
          position: node.position,
          data: {
            label: node.data.label,
            ...(node.data.toolName ? { toolName: node.data.toolName } : {}),
            ...(node.data.serverId && serverNames.has(node.data.serverId)
              ? { serverName: serverNames.get(node.data.serverId) }
              : {}),
            ...(tool?.description ? { description: tool.description } : {}),
            inputSchema: tool?.inputSchema ?? node.data.inputSchema,
            outputSchema: tool?.outputSchema ?? node.data.outputSchema,
            ...(node.data.staticInputs ? { staticInputs: node.data.staticInputs } : {}),
            onRemove: removeNode,
          },
        };
      }),
    [document.nodes, removeNode, serverNames, toolIndex],
  );

  const edges = useMemo<Edge<TypedEdgeData>[]>(
    () =>
      document.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: `out:${edge.sourceHandle}`,
        targetHandle: `in:${edge.targetHandle}`,
        type: 'typed',
        data: { ...(edgeResults.get(edge.id) ? { result: edgeResults.get(edge.id) } : {}) },
      })),
    [document.edges, edgeResults],
  );

  /** Persist drags and selections back into the document. */
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const positional = changes.filter(
        (change) => change.type === 'position' || change.type === 'dimensions',
      );
      if (positional.length === 0) return;

      setNodes((current) => {
        const asFlow = current.map((node) => ({
          id: node.id,
          position: node.position,
          data: {},
        })) as Node[];

        const updated = applyNodeChanges(positional, asFlow);
        const positions = new Map(updated.map((node) => [node.id, node.position]));

        return current.map((node) => {
          const position = positions.get(node.id);
          return position ? { ...node, position } : node;
        });
      });
    },
    [setNodes],
  );

  /**
   * The rule the product turns on: a connection is checked before it exists.
   *
   * `tryConnect` runs the compatibility check and only appends the edge when it
   * passes. A rejection surfaces through `editor.lastRejection`, which
   * `ConnectionIssuePanel` renders.
   */
  const onConnect = useCallback(
    (connection: Connection) => {
      const source = decodeHandle(connection.sourceHandle);
      const target = decodeHandle(connection.targetHandle);
      if (!connection.source || !connection.target || !source || !target) return;

      tryConnect({
        source: connection.source,
        sourceHandle: source.pointer,
        target: connection.target,
        targetHandle: target.pointer,
      });
    },
    [tryConnect],
  );

  /**
   * Structural validity only — direction and self-connection.
   *
   * Deliberately NOT the type check: refusing the drop outright would leave the
   * user with a connection that silently will not attach and no explanation.
   * Letting it drop and then explaining precisely why it was rejected is the
   * whole point.
   */
  const isValidConnection = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return false;
    if (connection.source === connection.target) return false;

    const source = decodeHandle(connection.sourceHandle);
    const target = decodeHandle(connection.targetHandle);
    return source?.direction === 'out' && target?.direction === 'in';
  }, []);

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      const ids = new Set(deleted.map((edge) => edge.id));
      setEdges((current) => current.filter((edge) => !ids.has(edge.id)));
    },
    [setEdges],
  );

  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      for (const node of deleted) removeNode(node.id);
    },
    [removeNode],
  );

  const isEmpty = document.nodes.length === 0;

  return (
    <div className="relative h-full w-full bg-canvas" data-testid="canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        onEdgesDelete={onEdgesDelete}
        onNodesDelete={onNodesDelete}
        isValidConnection={isValidConnection}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={1.75}
        proOptions={{ hideAttribution: false }}
        deleteKeyCode={['Backspace', 'Delete']}
        attributionPosition="bottom-right"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={18}
          size={1}
          color="var(--tg-canvas-dot)"
        />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          // Monochrome, like everything else: the minimap paints from the ramp
          // rather than reactflow's default palette.
          nodeColor="var(--tg-border-strong)"
          maskColor="var(--tg-overlay)"
        />
      </ReactFlow>

      {isEmpty ? (
        // pointer-events-none so the empty state never blocks panning the canvas
        // underneath it; the nested action re-enables them for itself.
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8">
          <div className="pointer-events-auto max-w-md">
            <EmptyState
              title="Nothing on the canvas yet"
              description="Connect an MCP server from the panel on the left. Every tool it exposes becomes a node you can wire up, and each connection is checked against the tools' real schemas before it runs."
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function GraphCanvas(props: GraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <InnerCanvas {...props} />
    </ReactFlowProvider>
  );
}
