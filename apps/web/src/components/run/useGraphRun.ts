'use client';

/**
 * Driving a live test-run.
 *
 * The engine streams progress over SSE **on the response to the POST that
 * started the run**. That shape is forced by two facts: the run needs an
 * Authorization header and a JSON body, and `EventSource` can send neither. So
 * this reads `response.body` as a stream and parses the SSE framing by hand.
 *
 * The subtle part is buffering. A network chunk boundary can fall anywhere,
 * including the middle of a frame or between the `\n\n` that terminates one.
 * Parsing each chunk independently silently drops events, which looks like a
 * run that stalls. The buffer below is what prevents that.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ExecutionEvent,
  ExecutionStepResult,
  McpConnectionSecrets,
} from '@toolgraph/schema-core';

import { publicEnv } from '@/lib/public-env';
import { createClient } from '@/lib/supabase/client';
import { captureEvent } from '@/lib/analytics';
import type { GraphEditorState } from '@/hooks/useGraphEditor';

/** After this long with no byte from the engine, assume it is cold. */
const COLD_START_HINT_MS = 3_000;

export type RunPhase = 'idle' | 'waking' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface UseGraphRun {
  phase: RunPhase;
  steps: ExecutionStepResult[];
  error: string | null;
  wakingUp: boolean;
  start: (secrets?: Record<string, McpConnectionSecrets>) => void;
  cancel: () => void;
  reset: () => void;
}

/** Split a buffer into complete SSE frames, returning the unconsumed remainder. */
function takeFrames(buffer: string): { frames: string[]; rest: string } {
  const frames: string[] = [];
  let rest = buffer;

  for (;;) {
    const boundary = rest.indexOf('\n\n');
    if (boundary === -1) break;
    frames.push(rest.slice(0, boundary));
    rest = rest.slice(boundary + 2);
  }

  return { frames, rest };
}

/** Pull the JSON payload out of one frame, ignoring comments and other fields. */
function parseFrame(frame: string): ExecutionEvent | null {
  const dataLines: string[] = [];

  for (const line of frame.split('\n')) {
    // `:` introduces a comment, which is how the engine sends keepalives.
    if (line.startsWith(':')) continue;
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }

  if (dataLines.length === 0) return null;

  try {
    return JSON.parse(dataLines.join('\n')) as ExecutionEvent;
  } catch {
    return null;
  }
}

export function useGraphRun(
  editor: GraphEditorState,
  graphId: string,
  /**
   * Saved connections used by this graph that have a stored credential. When
   * any of them is on the canvas the run is proxied through `/api/run` so the
   * credential can be resolved server-side. Empty means the direct path.
   */
  credentialConnectionIds: readonly string[] = [],
): UseGraphRun {
  const [phase, setPhase] = useState<RunPhase>('idle');
  const [steps, setSteps] = useState<ExecutionStepResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [wakingUp, setWakingUp] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const coldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearColdTimer = useCallback(() => {
    if (coldTimer.current) {
      clearTimeout(coldTimer.current);
      coldTimer.current = null;
    }
  }, []);

  // A run must not outlive the panel that started it.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (coldTimer.current) clearTimeout(coldTimer.current);
    },
    [],
  );

  const applyEvent = useCallback((event: ExecutionEvent) => {
    switch (event.type) {
      case 'run:start':
        setPhase('running');
        setSteps([]);
        break;

      case 'step:start':
        setSteps((current) => [
          ...current,
          {
            nodeId: event.nodeId,
            ...(event.toolName ? { toolName: event.toolName } : {}),
            status: 'running',
            startedAt: event.at,
          },
        ]);
        break;

      case 'step:finish':
        setSteps((current) => {
          const index = current.findIndex((step) => step.nodeId === event.step.nodeId);
          if (index === -1) return [...current, event.step];
          const next = [...current];
          next[index] = event.step;
          return next;
        });
        break;

      case 'run:finish':
        // The final list is authoritative: it includes steps that were skipped
        // after a failure and never produced a `step:start`.
        setSteps(event.steps);
        setPhase(event.status);
        break;

      case 'run:error':
        setError(event.message);
        setPhase('failed');
        break;

      default:
        break;
    }
  }, []);

  const start = useCallback(
    (secrets?: Record<string, McpConnectionSecrets>) => {
      /*
       * Two routes to the engine, and which one is taken depends on whether
       * this graph uses a saved connection that has a stored credential.
       *
       *   direct   — no stored credential to resolve. Browser to engine, with
       *              no serverless time limit, so a cold start plus a long run
       *              is merely slow.
       *   proxied  — a credential has to be decrypted server-side and must
       *              never reach this component, so the whole run goes through
       *              /api/run, which pipes the SSE stream back unchanged. That
       *              path is bounded by the function's execution limit.
       *
       * `credentialConnectionIds` is supplied by the editor from the saved
       * connections it was rendered with. An empty list means the direct path,
       * which is the common case and the better one.
       */
      if (phase === 'running' || phase === 'waking') return;

      const controller = new AbortController();
      abortRef.current = controller;

      setError(null);
      setSteps([]);
      setPhase('waking');
      setWakingUp(false);

      coldTimer.current = setTimeout(() => setWakingUp(true), COLD_START_HINT_MS);

      void (async () => {
        try {
          const supabase = createClient();
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;

          if (!token) {
            setError('Your session has expired. Reload the page and sign in again.');
            setPhase('failed');
            return;
          }

          // Only servers actually on this canvas count: a saved connection the
          // user has not used here must not have its credential decrypted.
          const onCanvas = new Set(editor.document.servers.map((server) => server.id));
          const needed = credentialConnectionIds.filter((id) => onCanvas.has(id));

          const response =
            needed.length > 0
              ? await fetch('/api/run', {
                  method: 'POST',
                  signal: controller.signal,
                  headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
                  body: JSON.stringify({
                    graphId,
                    document: editor.document,
                    connectionIds: needed,
                  }),
                })
              : await fetch(`${publicEnv.engineUrl}/run`, {
                  method: 'POST',
                  signal: controller.signal,
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                    Accept: 'text/event-stream',
                  },
                  body: JSON.stringify({
                    graphId,
                    document: editor.document,
                    ...(secrets ? { secrets } : {}),
                  }),
                });

          if (!response.ok) {
            const body: unknown = await response.json().catch(() => null);
            const message =
              body && typeof body === 'object' && 'message' in body
                ? String((body as { message: unknown }).message)
                : null;

            setError(
              message ??
                (response.status === 401
                  ? 'The engine did not accept your session. Reload and sign in again.'
                  : response.status === 429
                    ? 'You have started too many runs. Wait a moment and try again.'
                    : `The engine responded ${response.status}.`),
            );
            setPhase('failed');
            return;
          }

          if (!response.body) {
            setError('The engine returned no stream to read.');
            setPhase('failed');
            return;
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let sawEvent = false;

          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;

            // `stream: true` matters: a multi-byte character can straddle a
            // chunk boundary just as a frame can.
            buffer += decoder.decode(value, { stream: true });

            const { frames, rest } = takeFrames(buffer);
            buffer = rest;

            for (const frame of frames) {
              const event = parseFrame(frame);
              if (!event) continue;

              if (!sawEvent) {
                sawEvent = true;
                clearColdTimer();
                setWakingUp(false);
              }
              applyEvent(event);
            }
          }

          // Anything left after the stream closes is a frame with no trailing
          // blank line; the engine sends one on an abrupt end.
          const tail = parseFrame(buffer);
          if (tail) applyEvent(tail);

          setPhase((current) =>
            current === 'running' || current === 'waking' ? 'succeeded' : current,
          );
        } catch (caught) {
          if (controller.signal.aborted) {
            setPhase('cancelled');
            return;
          }
          setError(
            caught instanceof Error
              ? `Could not reach the engine: ${caught.message}`
              : 'Could not reach the engine.',
          );
          setPhase('failed');
        } finally {
          clearColdTimer();
          setWakingUp(false);
          abortRef.current = null;
        }
      })();
    },
    [applyEvent, clearColdTimer, credentialConnectionIds, editor.document, graphId, phase],
  );

  // Report the outcome once, when the run reaches a terminal state.
  const reported = useRef<RunPhase | null>(null);
  useEffect(() => {
    if (phase !== 'succeeded' && phase !== 'failed') return;
    if (reported.current === phase) return;
    reported.current = phase;
    captureEvent('test-run executed', { stepCount: steps.length, status: phase });
  }, [phase, steps.length]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    clearColdTimer();
    setWakingUp(false);
    setPhase('cancelled');
  }, [clearColdTimer]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    clearColdTimer();
    reported.current = null;
    setPhase('idle');
    setSteps([]);
    setError(null);
    setWakingUp(false);
  }, [clearColdTimer]);

  return { phase, steps, error, wakingUp, start, cancel, reset };
}
