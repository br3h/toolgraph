/**
 * RFC 6901 pointer access over runtime VALUES.
 *
 * `@toolgraph/schema-core` resolves pointers over schemas; this resolves the
 * same pointers over the actual data flowing through a run. The two are
 * deliberately separate: a schema walk steps through `properties` and `items`,
 * while a value walk steps through real keys and indices.
 */

/** Decode a pointer into its tokens, `~1` before `~0` as RFC 6901 requires. */
export function pointerTokens(pointer: string): string[] {
  if (pointer === '') return [];
  const body = pointer.startsWith('/') ? pointer.slice(1) : pointer;
  return body.split('/').map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/** Read the value a pointer addresses, or undefined when it addresses nothing. */
export function getAtPointer(value: unknown, pointer: string): unknown {
  let current = value;
  for (const token of pointerTokens(pointer)) {
    if (current === null || current === undefined) return undefined;

    if (Array.isArray(current)) {
      const index = Number(token);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined;
      current = current[index];
      continue;
    }

    if (typeof current !== 'object') return undefined;

    // Own properties only: a pointer must never be able to read `__proto__` or
    // `constructor` off an object that came from a third-party server.
    if (!Object.prototype.hasOwnProperty.call(current, token)) return undefined;
    current = (current as Record<string, unknown>)[token];
  }
  return current;
}

/** Keys that must never be written through, whatever a pointer says. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Write a value at a pointer, creating intermediate containers as needed.
 *
 * Returns a new root rather than mutating, so a partially-built argument object
 * can never leak into a sibling step.
 */
export function setAtPointer(root: unknown, pointer: string, value: unknown): unknown {
  const tokens = pointerTokens(pointer);
  if (tokens.length === 0) return value;

  // Prototype pollution is the obvious attack on a function that writes to an
  // arbitrary path derived from user-controlled graph data.
  if (tokens.some((token) => FORBIDDEN_KEYS.has(token))) {
    throw new Error(`Refusing to write through the unsafe path "${pointer}".`);
  }

  const base: Record<string, unknown> =
    root && typeof root === 'object' && !Array.isArray(root)
      ? { ...(root as Record<string, unknown>) }
      : {};

  let cursor: Record<string, unknown> = base;

  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i];
    if (token === undefined) break;

    const existing = cursor[token];
    const next: Record<string, unknown> =
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    cursor[token] = next;
    cursor = next;
  }

  const last = tokens[tokens.length - 1];
  if (last !== undefined) cursor[last] = value;

  return base;
}
