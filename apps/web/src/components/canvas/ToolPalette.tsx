'use client';

/**
 * The sidebar: connected servers and the tools they expose.
 *
 * Clicking a tool drops it on the canvas. New nodes are staggered rather than
 * stacked, so adding three tools in a row does not bury them on top of each
 * other.
 */

import { useMemo, useState } from 'react';
import type { McpToolDescriptor } from '@toolgraph/schema-core';
import { Button, EmptyState, Input } from '@toolgraph/ui';

import type { GraphEditorState } from '@/hooks/useGraphEditor';
import { ServerConnectDialog, type ImportableConnection } from './ServerConnectDialog';

export interface ToolPaletteProps {
  editor: GraphEditorState;
  /** Passed straight through to the connect dialog. */
  savedConnections?: ImportableConnection[];
}

const NODE_STAGGER = 42;

export function ToolPalette({ editor, savedConnections = [] }: ToolPaletteProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [filter, setFilter] = useState('');

  const grouped = useMemo(() => {
    const needle = filter.trim().toLowerCase();

    return editor.document.servers.map((server) => {
      const tools = editor.tools.filter((tool) => {
        if (tool.serverId !== server.id) return false;
        if (!needle) return true;
        return (
          tool.name.toLowerCase().includes(needle) ||
          (tool.description ?? '').toLowerCase().includes(needle)
        );
      });
      return { server, tools };
    });
  }, [editor.document.servers, editor.tools, filter]);

  const addTool = (tool: McpToolDescriptor) => {
    const count = editor.document.nodes.length;
    editor.addToolNode(tool, {
      x: 80 + (count % 4) * NODE_STAGGER,
      y: 80 + count * NODE_STAGGER,
    });
  };

  const hasServers = editor.document.servers.length > 0;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border-subtle p-3">
        <Button
          variant="primary"
          size="sm"
          className="w-full"
          data-testid="add-server-button"
          onClick={() => setDialogOpen(true)}
        >
          Connect a server
        </Button>
      </div>

      {hasServers ? (
        <>
          <div className="border-b border-border-subtle p-3">
            <Input
              label="Filter tools"
              labelHidden
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter tools"
              aria-label="Filter tools"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {grouped.map(({ server, tools }) => (
              <section key={server.id} className="border-b border-border-subtle">
                <header className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-fg">{server.name}</p>
                    <p className="truncate text-[10px] text-fg-subtle">
                      {server.transport} · {tools.length} tool{tools.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => editor.removeServer(server.id)}
                    aria-label={`Disconnect ${server.name}`}
                    className="shrink-0 rounded-sm border border-transparent px-1.5 text-xs leading-5 text-fg-muted transition-colors hover:border-border hover:text-fg"
                  >
                    &times;
                  </button>
                </header>

                <ul className="pb-2">
                  {tools.length === 0 ? (
                    <li className="px-3 py-1 text-[11px] text-fg-subtle">
                      {filter ? 'No tools match that filter' : 'This server exposes no tools'}
                    </li>
                  ) : (
                    tools.map((tool) => (
                      <li key={`${tool.serverId}-${tool.name}`}>
                        <button
                          type="button"
                          onClick={() => addTool(tool)}
                          className="w-full px-3 py-1.5 text-left transition-colors hover:bg-bg-sunken"
                        >
                          <span className="block truncate text-[11px] font-medium text-fg">
                            {tool.name}
                          </span>
                          {tool.description ? (
                            <span className="mt-0.5 block truncate text-[10px] text-fg-subtle">
                              {tool.description}
                            </span>
                          ) : null}
                          {!tool.outputSchema ? (
                            <span className="mt-0.5 block text-[10px] italic text-fg-subtle">
                              No output schema
                            </span>
                          ) : null}
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </section>
            ))}
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 items-center p-4">
          <EmptyState
            title="No servers connected"
            description="Connect an MCP server to see its tools here."
          />
        </div>
      )}

      <ServerConnectDialog
        editor={editor}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        savedConnections={savedConnections}
      />
    </div>
  );
}
