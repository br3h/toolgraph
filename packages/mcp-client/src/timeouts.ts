/**
 * Deadlines for every outbound MCP operation.
 *
 * A third-party server that accepts a connection and then simply never answers
 * would otherwise pin a request handler open for as long as it likes, so every
 * call the client makes is raced against a timer.
 */

/** Ceiling for the transport handshake plus MCP `initialize`. */
export const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

/** Ceiling for a whole introspection round trip: connect, list tools, close. */
export const DEFAULT_TOTAL_TIMEOUT_MS = 30_000;

/** Ceiling for a single `tools/call`. */
export const DEFAULT_TOOL_CALL_TIMEOUT_MS = 30_000;

/** Thrown when an operation outlives its deadline. */
export class TimeoutError extends Error {
  readonly label: string;
  readonly timeoutMs: number;

  constructor(label: string, timeoutMs: number) {
    super(`Timed out after ${timeoutMs} ms waiting for ${label}.`);
    this.name = 'TimeoutError';
    this.label = label;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Races `promise` against a deadline.
 *
 * The timer is always cleared, on every outcome — a rejected race that left its
 * timer armed would hold the event loop open for the length of the timeout and,
 * in a long-lived process, accumulate one dangling handle per call.
 *
 * Note that losing the race does not cancel the underlying work; callers that
 * hold a transport are responsible for closing it after a timeout.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  const delay = Number.isFinite(ms) && ms > 0 ? ms : 0;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, delay)), delay);
  });

  return Promise.race([promise, deadline]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}
