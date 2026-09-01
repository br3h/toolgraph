/**
 * RFC 6901 JSON pointers over JSON Schema documents, plus the two structural
 * normalisations every other module in this package needs before it can compare
 * anything: `$ref` resolution and shallow `allOf` flattening.
 *
 * Schemas arrive from third-party MCP servers, so every walk here is bounded.
 * A malicious or merely sloppy server must never be able to hang the checker.
 */

import type { JsonSchema } from './types';

/** A pathological chain of `$ref`s stops here rather than looping forever. */
const MAX_REF_HOPS = 32;

/** `allOf` is flattened, not evaluated; nested composition stops at this depth. */
const MAX_ALLOF_DEPTH = 4;

/** Pointer resolution may step through unions; bound how deep that search goes. */
const MAX_UNION_DEPTH = 8;

/**
 * Keywords that may sit beside `$ref` without changing what it validates. In
 * 2020-12 any sibling is legal, but only non-annotation siblings actually
 * constrain the value, and merging those loses object identity — which the
 * recursion guards elsewhere rely on — so annotations are deliberately dropped.
 */
const ANNOTATION_KEYWORDS = new Set([
  '$ref',
  '$comment',
  'title',
  'description',
  'default',
  'examples',
  'deprecated',
  'readOnly',
  'writeOnly',
]);

/** Array indices in a pointer are decimal, without leading zeros. */
const ARRAY_INDEX = /^(?:0|[1-9][0-9]*)$/;

/* -------------------------------------------------------------------------- */
/* Pointer syntax                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Split an RFC 6901 pointer into its decoded reference tokens.
 *
 * A pointer that omits its leading `/` is accepted rather than rejected: MCP
 * servers and hand-written graph handles both produce them, and guessing the
 * user's intent is friendlier than losing the connection.
 */
export function parsePointer(pointer: string): string[] {
  if (pointer === '') return [];
  const body = pointer.startsWith('/') ? pointer.slice(1) : pointer;
  return body.split('/').map(unescapeToken);
}

/** Join reference tokens back into a pointer, escaping `~` and `/`. */
export function formatPointer(tokens: string[]): string {
  if (tokens.length === 0) return '';
  return `/${tokens.map(escapeToken).join('/')}`;
}

function unescapeToken(token: string): string {
  // `~1` must be decoded before `~0`, or `~01` would wrongly decode to `/`.
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

function escapeToken(token: string): string {
  // Mirror image: `~` first, so the `~` introduced by `/` is not escaped twice.
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

/* -------------------------------------------------------------------------- */
/* `$ref`                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Follow `$ref` until a concrete schema is reached.
 *
 * Returns undefined when the reference is external, dangling, cyclic through
 * pure indirection, or longer than {@link MAX_REF_HOPS}.
 */
export function resolveRef(
  schema: JsonSchema | undefined,
  root?: JsonSchema,
  seen?: Set<string>,
): JsonSchema | undefined {
  if (!schema) return undefined;
  const visited = seen ?? new Set<string>();
  let current: JsonSchema = schema;
  let hops = 0;

  while (typeof current.$ref === 'string') {
    if (hops >= MAX_REF_HOPS) return undefined;
    hops += 1;

    const ref = current.$ref;
    // A `$ref` that leads back to a `$ref` already followed is a pure cycle and
    // can never bottom out in a real schema.
    if (visited.has(ref)) return undefined;
    visited.add(ref);

    const target = lookupRef(ref, root);
    if (!target) return undefined;

    const siblings = constrainingSiblings(current);
    current = siblings ? { ...target, ...siblings } : target;
  }

  return current;
}

/** Sibling keywords of a `$ref` that genuinely constrain the value, if any. */
function constrainingSiblings(schema: JsonSchema): JsonSchema | undefined {
  let found: JsonSchema | undefined;
  for (const [key, value] of Object.entries(schema)) {
    if (ANNOTATION_KEYWORDS.has(key)) continue;
    found ??= {};
    found[key] = value;
  }
  return found;
}

function lookupRef(ref: string, root: JsonSchema | undefined): JsonSchema | undefined {
  if (!root) return undefined;
  if (ref === '#' || ref === '') return root;
  // Only same-document pointers are resolvable; fetching a URL is out of scope
  // for a package that must run unchanged inside a browser bundle.
  if (!ref.startsWith('#/')) return undefined;
  return resolveRawPointer(root, parsePointer(ref.slice(1)));
}

/**
 * Walk a pointer over the raw document rather than over its schema semantics,
 * which is what `#/$defs/X` and `#/definitions/X` need.
 */
function resolveRawPointer(root: JsonSchema, tokens: string[]): JsonSchema | undefined {
  let current: unknown = root;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      if (!ARRAY_INDEX.test(token)) return undefined;
      const index = Number(token);
      if (index >= current.length) return undefined;
      current = current[index];
      continue;
    }
    if (!isRecord(current)) return undefined;
    // `hasOwnProperty` rather than `in`: a `$ref` must never reach `__proto__`.
    if (!Object.prototype.hasOwnProperty.call(current, token)) return undefined;
    current = current[token];
  }
  return isRecord(current) ? (current as JsonSchema) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/* -------------------------------------------------------------------------- */
/* `allOf`                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Flatten `allOf` into a single schema so callers can read `properties`,
 * `required` and friends off one object.
 *
 * The merge is shallow by design: it unions property maps and required lists
 * and lets the outer schema win any scalar conflict. That is enough for the
 * composition MCP servers actually emit, and it cannot diverge.
 */
export function mergeAllOf(
  schema: JsonSchema | undefined,
  root?: JsonSchema,
  depth = 0,
): JsonSchema | undefined {
  if (!schema) return undefined;
  const branches = schema.allOf;
  if (!Array.isArray(branches) || branches.length === 0) return schema;
  if (depth >= MAX_ALLOF_DEPTH) return withoutKeys(schema, ['allOf']);

  let merged = withoutKeys(schema, ['allOf']);
  for (const branch of branches) {
    const resolved = mergeAllOf(resolveRef(branch, root), root, depth + 1);
    if (resolved) merged = mergeSchemas(merged, resolved);
  }
  return merged;
}

/** Combine two schemas, `base` winning any scalar conflict. */
export function mergeSchemas(base: JsonSchema, extra: JsonSchema): JsonSchema {
  const out: JsonSchema = { ...extra, ...base };

  if (base.properties || extra.properties) {
    out.properties = { ...extra.properties, ...base.properties };
  }
  if (base.required || extra.required) {
    out.required = [...new Set([...(extra.required ?? []), ...(base.required ?? [])])];
  }
  if (base.$defs || extra.$defs) {
    out.$defs = { ...extra.$defs, ...base.$defs };
  }
  if (base.definitions || extra.definitions) {
    out.definitions = { ...extra.definitions, ...base.definitions };
  }
  // A closed object stays closed however it was composed.
  if (base.additionalProperties === false || extra.additionalProperties === false) {
    out.additionalProperties = false;
  }
  // The composition has been consumed; leaving it would re-apply on every pass.
  delete out.allOf;
  return out;
}

function withoutKeys(schema: JsonSchema, keys: readonly string[]): JsonSchema {
  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (keys.includes(key)) continue;
    out[key] = value;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Pointer resolution                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Resolve a pointer against a schema, returning the schema of the addressed
 * field, or undefined when the pointer addresses nothing.
 *
 * `$ref` and `allOf` are resolved at every step, so pointers work through
 * `$defs` indirection and composed objects alike.
 */
export function resolvePointer(
  schema: JsonSchema,
  pointer: string,
  root?: JsonSchema,
): JsonSchema | undefined {
  const effectiveRoot = root ?? schema;
  let current = normalizeSchema(schema, effectiveRoot);
  for (const token of parsePointer(pointer)) {
    if (!current) return undefined;
    current = normalizeSchema(stepInto(current, token, effectiveRoot, 0), effectiveRoot);
  }
  return current;
}

/** Resolve `$ref` then flatten `allOf`, the shape every consumer expects. */
export function normalizeSchema(
  schema: JsonSchema | undefined,
  root?: JsonSchema,
): JsonSchema | undefined {
  return mergeAllOf(resolveRef(schema, root), root);
}

function stepInto(
  schema: JsonSchema,
  token: string,
  root: JsonSchema,
  depth: number,
): JsonSchema | undefined {
  const named = schema.properties?.[token];
  if (named) return named;

  if (ARRAY_INDEX.test(token) || token === '-') {
    const element = stepIntoArray(schema, token);
    if (element) return element;
  }

  // A map-shaped object addresses its values through `additionalProperties`.
  const additional = schema.additionalProperties;
  if (additional && typeof additional === 'object') return additional;

  // Finally, a union addresses whatever its first matching branch addresses.
  if (depth < MAX_UNION_DEPTH) {
    const branches = schema.anyOf ?? schema.oneOf;
    if (Array.isArray(branches)) {
      for (const branch of branches) {
        const resolved = normalizeSchema(branch, root);
        if (!resolved) continue;
        const found = stepInto(resolved, token, root, depth + 1);
        if (found) return found;
      }
    }
  }

  return undefined;
}

function stepIntoArray(schema: JsonSchema, token: string): JsonSchema | undefined {
  const prefix = schema.prefixItems;
  if (Array.isArray(prefix) && token !== '-') {
    const index = Number(token);
    const positional = prefix[index];
    if (positional) return positional;
  }
  return schema.items;
}
