/**
 * Handle id encoding.
 *
 * reactflow identifies a connection endpoint with an opaque string, but a
 * toolgraph connection is a JSON pointer into a schema. So the pointer is
 * encoded into the handle id and decoded on the other side.
 *
 * Both ends of that round trip live here on purpose: when the encoder and the
 * decoder are written in separate files they drift, and the symptom is edges
 * that silently connect the wrong fields.
 */

export type HandleDirection = 'in' | 'out';

const SEPARATOR = ':';

/** `in:/user/id`, `out:` for the whole value. */
export function encodeHandle(direction: HandleDirection, pointer: string): string {
  return `${direction}${SEPARATOR}${pointer}`;
}

export interface DecodedHandle {
  direction: HandleDirection;
  pointer: string;
}

/**
 * Decode a handle id, or null when it is not one of ours.
 *
 * reactflow can hand back null for a node-level connection, and a stale saved
 * graph can carry an id from an older encoding — both are "not ours" rather
 * than errors worth throwing over.
 */
export function decodeHandle(id: string | null | undefined): DecodedHandle | null {
  if (!id) return null;

  const separator = id.indexOf(SEPARATOR);
  if (separator === -1) return null;

  const direction = id.slice(0, separator);
  if (direction !== 'in' && direction !== 'out') return null;

  // The pointer may itself contain colons, so take everything after the first.
  return { direction, pointer: id.slice(separator + 1) };
}

/** The pointer a handle addresses, or `''` (the whole value) if unrecognised. */
export function handlePointer(id: string | null | undefined): string {
  return decodeHandle(id)?.pointer ?? '';
}
