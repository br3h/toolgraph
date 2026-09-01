'use client';

/**
 * The export panel.
 *
 * The generated code is the thing the user actually walks away with, so this
 * shows it in full rather than describing it — Monaco, read-only, one file at a
 * time, with the whole bundle downloadable.
 *
 * Monaco arrives with its own colour theme, which would be the one place in the
 * product where hue leaks in. `defineMonochromeTheme` below replaces every
 * token colour with a step from the neutral ramp, so syntax is distinguished by
 * lightness and italics instead.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor, { type Monaco } from '@monaco-editor/react';
import type { ExportTarget, GeneratedFile } from '@toolgraph/schema-core';
import { Alert, Button, Modal, Skeleton, cn } from '@toolgraph/ui';

import type { GraphEditorState } from '@/hooks/useGraphEditor';
import { captureEvent } from '@/lib/analytics';

export interface ExportPanelProps {
  editor: GraphEditorState;
  open: boolean;
  onClose: () => void;
}

const THEME_LIGHT = 'toolgraph-light';
const THEME_DARK = 'toolgraph-dark';

function readToken(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * Two greyscale Monaco themes built from the live CSS variables.
 *
 * Comments and strings are separated by lightness and italics rather than
 * colour, which is the whole constraint. Monaco needs 6-digit hex, so the
 * values are read from the ramp and passed through unchanged.
 */
function defineMonochromeTheme(monaco: Monaco): void {
  const fg = readToken('--tg-gray-10', '#161616');
  const muted = readToken('--tg-gray-7', '#6e6e6e');
  const subtle = readToken('--tg-gray-6', '#949494');

  monaco.editor.defineTheme(THEME_LIGHT, {
    base: 'vs',
    inherit: false,
    rules: [
      { token: '', foreground: fg.replace('#', '') },
      { token: 'comment', foreground: subtle.replace('#', ''), fontStyle: 'italic' },
      { token: 'string', foreground: muted.replace('#', '') },
      { token: 'keyword', foreground: fg.replace('#', ''), fontStyle: 'bold' },
      { token: 'number', foreground: muted.replace('#', '') },
      { token: 'type', foreground: fg.replace('#', '') },
      { token: 'identifier', foreground: fg.replace('#', '') },
    ],
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': fg,
      'editorLineNumber.foreground': subtle,
      'editorLineNumber.activeForeground': fg,
      'editor.selectionBackground': '#e9e9e9',
      'editor.lineHighlightBackground': '#fafafa',
      'editorIndentGuide.background1': '#e9e9e9',
      'editorGutter.background': '#ffffff',
    },
  });

  monaco.editor.defineTheme(THEME_DARK, {
    base: 'vs-dark',
    inherit: false,
    rules: [
      { token: '', foreground: 'fafafa' },
      { token: 'comment', foreground: '6e6e6e', fontStyle: 'italic' },
      { token: 'string', foreground: 'bcbcbc' },
      { token: 'keyword', foreground: 'ffffff', fontStyle: 'bold' },
      { token: 'number', foreground: 'bcbcbc' },
      { token: 'type', foreground: 'fafafa' },
      { token: 'identifier', foreground: 'fafafa' },
    ],
    colors: {
      'editor.background': '#0a0a0a',
      'editor.foreground': '#fafafa',
      'editorLineNumber.foreground': '#4a4a4a',
      'editorLineNumber.activeForeground': '#fafafa',
      'editor.selectionBackground': '#2b2b2b',
      'editor.lineHighlightBackground': '#161616',
      'editorIndentGuide.background1': '#2b2b2b',
      'editorGutter.background': '#0a0a0a',
    },
  });
}

function prefersDark(): boolean {
  if (typeof window === 'undefined') return false;
  const explicit = document.documentElement.dataset.theme;
  if (explicit === 'dark') return true;
  if (explicit === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function languageFor(path: string): string {
  if (path.endsWith('.ts')) return 'typescript';
  if (path.endsWith('.py')) return 'python';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.md')) return 'markdown';
  return 'plaintext';
}

/** A slug safe to use as a filename across platforms. */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'toolgraph-export';
}

function downloadText(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  // Revoking immediately can race the download in some browsers; a tick is enough.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function ExportPanel({ editor, open, onClose }: ExportPanelProps) {
  const [target, setTarget] = useState<ExportTarget>('typescript');
  const [files, setFiles] = useState<GeneratedFile[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [dark, setDark] = useState(false);

  const monacoRef = useRef<Monaco | null>(null);

  // Follow the site theme, both the manual toggle and the OS preference.
  useEffect(() => {
    if (!open) return;
    setDark(prefersDark());

    const observer = new MutationObserver(() => setDark(prefersDark()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onMediaChange = () => setDark(prefersDark());
    media.addEventListener('change', onMediaChange);

    return () => {
      observer.disconnect();
      media.removeEventListener('change', onMediaChange);
    };
  }, [open]);

  const load = useCallback(
    async (nextTarget: ExportTarget) => {
      setLoading(true);
      setError(null);
      setFiles([]);
      setWarnings([]);

      try {
        const response = await fetch('/api/export', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            target: nextTarget,
            document: editor.document,
            tools: editor.tools,
          }),
        });

        const body: unknown = await response.json().catch(() => null);

        if (!response.ok) {
          const message =
            body && typeof body === 'object' && 'message' in body
              ? String((body as { message: unknown }).message)
              : `Export failed with ${response.status}.`;
          setError(message);
          return;
        }

        const generated =
          body && typeof body === 'object' && 'files' in body
            ? ((body as { files: GeneratedFile[] }).files ?? [])
            : [];
        const generatedWarnings =
          body && typeof body === 'object' && 'warnings' in body
            ? ((body as { warnings: string[] }).warnings ?? [])
            : [];

        setFiles(generated);
        setWarnings(generatedWarnings);
        setSelected(generated[0]?.path ?? null);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Export failed.');
      } finally {
        setLoading(false);
      }
    },
    [editor.document, editor.tools],
  );

  useEffect(() => {
    if (!open) return;
    void load(target);
  }, [open, target, load]);

  const active = useMemo(
    () => files.find((file) => file.path === selected) ?? files[0] ?? null,
    [files, selected],
  );

  const extension = target === 'python' ? 'py' : 'ts';

  const downloadBundle = () => {
    const separator = target === 'python' ? '#' : '//';
    const bundle = files
      .map(
        (file) =>
          `${separator} ${'='.repeat(70)}\n${separator} ${file.path}\n${separator} ${'='.repeat(70)}\n\n${file.contents}`,
      )
      .join('\n\n');

    downloadText(`${slugify(editor.document.name)}.${extension}.txt`, bundle);
    captureEvent('export downloaded', { target, fileCount: files.length });
  };

  const downloadActive = () => {
    if (!active) return;
    downloadText(active.path, active.contents);
    captureEvent('export downloaded', { target, fileCount: 1 });
  };

  const copyActive = async () => {
    if (!active) return;
    try {
      await navigator.clipboard.writeText(active.contents);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      setError('Your browser would not allow copying to the clipboard.');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Export this graph"
      description="Standalone code with no toolgraph dependency. It is yours to keep."
      size="lg"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-fg-muted">
            {files.length} file{files.length === 1 ? '' : 's'}
          </span>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => void copyActive()} disabled={!active}>
              {copied ? 'Copied' : 'Copy this file'}
            </Button>
            <Button variant="secondary" onClick={downloadActive} disabled={!active}>
              Download this file
            </Button>
            <Button
              variant="primary"
              onClick={downloadBundle}
              disabled={files.length === 0}
              data-testid="export-download"
            >
              Download all
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div role="tablist" aria-label="Export language" className="flex gap-1">
          {(['typescript', 'python'] as const).map((option) => (
            <button
              key={option}
              role="tab"
              type="button"
              aria-selected={target === option}
              data-testid={`export-tab-${option}`}
              onClick={() => setTarget(option)}
              className={cn(
                'rounded-[var(--tg-radius-sm)] border px-3 py-1.5 text-xs font-medium transition-colors',
                target === option
                  ? 'border-transparent bg-accent text-fg-on-accent'
                  : 'border-border text-fg-muted hover:text-fg',
              )}
            >
              {option === 'typescript' ? 'TypeScript' : 'Python'}
            </button>
          ))}
        </div>

        {error ? (
          <Alert variant="error" title="Could not generate the export">
            {error}
          </Alert>
        ) : null}

        {warnings.length > 0 ? (
          <Alert
            variant="warning"
            title={`${warnings.length} thing${warnings.length === 1 ? '' : 's'} worth knowing`}
          >
            <ul className="space-y-1">
              {warnings.slice(0, 5).map((warning, index) => (
                <li key={index} className="text-xs">
                  {warning}
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : files.length === 0 && !error ? (
          <p className="py-8 text-center text-sm text-fg-muted">
            Add at least one tool to the canvas to export it.
          </p>
        ) : (
          <div className="flex min-h-0 gap-3">
            <ul className="w-44 shrink-0 space-y-0.5 overflow-y-auto" aria-label="Generated files">
              {files.map((file) => (
                <li key={file.path}>
                  <button
                    type="button"
                    onClick={() => setSelected(file.path)}
                    aria-current={active?.path === file.path}
                    className={cn(
                      'w-full truncate rounded-[var(--tg-radius-sm)] px-2 py-1.5 text-left font-mono text-[11px] transition-colors',
                      active?.path === file.path
                        ? 'bg-bg-sunken font-semibold text-fg'
                        : 'text-fg-muted hover:bg-bg-sunken hover:text-fg',
                    )}
                  >
                    {file.path}
                  </button>
                </li>
              ))}
            </ul>

            <div className="min-w-0 flex-1 overflow-hidden rounded-[var(--tg-radius-md)] border border-border">
              <Editor
                height="420px"
                path={active?.path}
                language={active ? languageFor(active.path) : 'plaintext'}
                value={active?.contents ?? ''}
                theme={dark ? THEME_DARK : THEME_LIGHT}
                beforeMount={(monaco) => {
                  monacoRef.current = monaco;
                  defineMonochromeTheme(monaco);
                }}
                options={{
                  readOnly: true,
                  domReadOnly: true,
                  minimap: { enabled: false },
                  fontSize: 12,
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  renderLineHighlight: 'line',
                  automaticLayout: true,
                  wordWrap: 'on',
                  padding: { top: 12, bottom: 12 },
                }}
              />
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
