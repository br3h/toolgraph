'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Modal } from '@toolgraph/ui';

import { deleteGraph, duplicateGraph, renameGraph } from '@/app/graphs/actions';

export interface GraphSummary {
  id: string;
  title: string;
  updatedAt: string;
  nodeCount: number;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'recently';

  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;

  return new Date(then).toLocaleDateString();
}

export function GraphCard({ graph }: { graph: GraphSummary }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(graph.title);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error ?? 'That did not work.');
        return;
      }
      after?.();
      router.refresh();
    });
  };

  return (
    <div
      data-testid="graph-card"
      className="group relative flex flex-col rounded-[var(--tg-radius-lg)] border border-border bg-bg-raised p-4 transition-colors hover:border-border-strong"
    >
      <Link href={`/graphs/${graph.id}`} className="min-w-0">
        <h3 className="truncate text-sm font-semibold tracking-tight">{graph.title}</h3>
        <p className="mt-1 text-xs text-fg-muted">
          {graph.nodeCount} {graph.nodeCount === 1 ? 'tool' : 'tools'} · edited{' '}
          {relativeTime(graph.updatedAt)}
        </p>
      </Link>

      {error ? (
        <p className="mt-2 border-l-2 border-border-strong pl-2 text-xs text-fg" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex items-center gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setRenaming(true)}
          disabled={pending}
          aria-label={`Rename ${graph.title}`}
        >
          Rename
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => run(() => duplicateGraph(graph.id))}
          disabled={pending}
          aria-label={`Duplicate ${graph.title}`}
        >
          Duplicate
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setConfirmingDelete(true)}
          disabled={pending}
          aria-label={`Delete ${graph.title}`}
        >
          Delete
        </Button>
      </div>

      <Modal open={renaming} onClose={() => setRenaming(false)} title="Rename graph" size="sm">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            run(
              () => renameGraph(graph.id, title),
              () => setRenaming(false),
            );
          }}
        >
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
            autoFocus
            aria-label="Graph name"
            className="w-full rounded-[var(--tg-radius-sm)] border border-border bg-bg px-3 py-2 text-sm text-fg"
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={pending}>
              Rename
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        title="Delete this graph?"
        size="sm"
      >
        <p className="text-sm text-fg-muted">
          <strong className="font-semibold text-fg">{graph.title}</strong> and its version history
          will be removed. This cannot be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setConfirmingDelete(false)}>
            Keep it
          </Button>
          <Button
            type="button"
            variant="danger"
            loading={pending}
            onClick={() =>
              run(
                () => deleteGraph(graph.id),
                () => setConfirmingDelete(false),
              )
            }
          >
            Delete permanently
          </Button>
        </div>
      </Modal>
    </div>
  );
}
