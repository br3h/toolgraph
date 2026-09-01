'use client';

/**
 * The editor shell.
 *
 * Owns nothing except which panel is open. All graph state lives in
 * `useGraphEditor`, and the canvas, run panel and export panel all read from
 * that one object — so a type-check computed when an edge was drawn is the same
 * verdict the run button and the export panel see.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { McpToolDescriptor, ToolGraphDocument } from '@toolgraph/schema-core';
import { Button, Spinner } from '@toolgraph/ui';

import { AppShell } from '@/components/AppShell';
import { ConnectionIssuePanel, GraphCanvas, ToolPalette } from '@/components/canvas';
import { ExportPanel } from '@/components/export';
import { RunPanel } from '@/components/run';
import { useGraphEditor, type SaveState } from '@/hooks/useGraphEditor';
import { renameGraph } from '@/app/graphs/actions';

export interface GraphEditorProps {
  graphId: string;
  initialTitle: string;
  initialDocument: ToolGraphDocument;
  initialTools?: McpToolDescriptor[];
  userEmail?: string | undefined;
}

/** Autosave status, worded so it never looks like an error when it is not one. */
function SaveIndicator({ state, error }: { state: SaveState; error: string | null }) {
  if (state === 'saving') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-fg-muted">
        <Spinner size="sm" />
        Saving
      </span>
    );
  }
  if (state === 'saved') return <span className="text-xs text-fg-subtle">Saved</span>;
  if (state === 'dirty') return <span className="text-xs text-fg-subtle">Unsaved changes</span>;
  if (state === 'error') {
    return (
      <span className="text-xs font-medium text-fg" role="alert">
        Not saved{error ? `: ${error}` : ''}
      </span>
    );
  }
  return null;
}

export function GraphEditor({
  graphId,
  initialTitle,
  initialDocument,
  initialTools = [],
  userEmail,
}: GraphEditorProps) {
  const router = useRouter();
  const editor = useGraphEditor(graphId, initialDocument, initialTools);

  const [title, setTitle] = useState(initialTitle);
  const [runOpen, setRunOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  // The title lives in its own column, so it saves separately from the document.
  const commitTitle = useCallback(async () => {
    const trimmed = title.trim();
    if (!trimmed || trimmed === initialTitle) return;
    await renameGraph(graphId, trimmed);
    router.refresh();
  }, [graphId, initialTitle, router, title]);

  // Cmd/Ctrl+S saves immediately rather than waiting out the debounce. People
  // press it reflexively, and having it do nothing feels broken.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        editor.saveNow();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editor]);

  // Warn before leaving with unsaved work. Only while genuinely dirty, so it
  // does not become noise the user learns to dismiss.
  useEffect(() => {
    if (editor.saveState !== 'dirty' && editor.saveState !== 'error') return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [editor.saveState]);

  const toolNodeCount = editor.document.nodes.filter((node) => node.kind === 'mcpTool').length;

  const toolbar = (
    <div className="flex min-w-0 items-center gap-3">
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={() => void commitTitle()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        aria-label="Graph name"
        data-testid="graph-title-input"
        maxLength={200}
        className="min-w-0 max-w-[280px] flex-1 truncate rounded-[var(--tg-radius-sm)] border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-fg transition-colors hover:border-border focus:border-border"
      />
      <SaveIndicator state={editor.saveState} error={editor.saveError} />
    </div>
  );

  return (
    <AppShell email={userEmail} toolbar={toolbar} fullBleed>
      <div className="flex h-full min-h-0">
        <aside className="w-72 shrink-0 overflow-y-auto border-r border-border-subtle bg-bg-subtle">
          <ToolPalette editor={editor} />
        </aside>

        <div className="relative min-w-0 flex-1">
          <GraphCanvas editor={editor} />

          {/* The inline mismatch feedback: the moment the product exists for. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 p-4">
            <div className="pointer-events-auto mx-auto max-w-2xl">
              <ConnectionIssuePanel editor={editor} />
            </div>
          </div>

          <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setExportOpen(true)}
              disabled={toolNodeCount === 0}
              data-testid="export-button"
            >
              Export
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setRunOpen(true)}
              disabled={toolNodeCount === 0}
              data-testid="run-button"
            >
              Test run
            </Button>
          </div>
        </div>
      </div>

      <RunPanel
        editor={editor}
        graphId={graphId}
        open={runOpen}
        onClose={() => setRunOpen(false)}
      />
      <ExportPanel editor={editor} open={exportOpen} onClose={() => setExportOpen(false)} />
    </AppShell>
  );
}
