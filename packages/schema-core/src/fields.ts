/**
 * Walking a JSON Schema to produce the addressable fields a user can wire, and
 * rendering a schema as a short human-readable type label.
 *
 * Both are presentation-facing: the canvas lists fields as connection handles,
 * and every compatibility message quotes a type label. Neither is used to decide
 * whether a connection is legal — that is `compat.ts`.
 */

import type { JsonSchema, JsonSchemaType, SchemaField } from './types';
import { formatPointer, normalizeSchema, parsePointer } from './pointer';

/** Deep enough to reach a realistic nested payload, shallow enough to stay fast. */
const DEFAULT_MAX_DEPTH = 6;

/** Past this many properties a label abbreviates rather than becoming unreadable. */
const MAX_LABELLED_PROPERTIES = 3;

/** Labels for a union stop here; beyond it the label says how many remain. */
const MAX_LABELLED_UNION_BRANCHES = 4;

export interface ListSchemaFieldsOptions {
  maxDepth?: number;
  /** The document `$ref`s resolve against. Defaults to the schema itself. */
  root?: JsonSchema;
}

/* -------------------------------------------------------------------------- */
/* Type labels                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Render a schema as a compact type, in the spelling a TypeScript user expects.
 *
 * This is the string that appears in "expects string, but provides number", so
 * it prioritises being scannable over being exhaustive.
 */
export function typeLabel(schema: JsonSchema | undefined, root?: JsonSchema, depth = 0): string {
  const resolved = normalizeSchema(schema, root);
  if (!resolved) return 'unknown';

  // A literal is the most specific thing we can say, so it wins.
  if (resolved.const !== undefined) return literalLabel(resolved.const);

  if (Array.isArray(resolved.enum) && resolved.enum.length > 0) {
    return joinUnion(resolved.enum.map(literalLabel));
  }

  const branches = resolved.anyOf ?? resolved.oneOf;
  if (Array.isArray(branches) && branches.length > 0) {
    if (depth >= 3) return 'unknown';
    return joinUnion(branches.map((branch) => typeLabel(branch, root, depth + 1)));
  }

  const types = normalizeTypes(resolved.type);
  if (types.length === 0) return 'unknown';
  if (types.length > 1) {
    return joinUnion(types.map((t) => scalarLabel(t, resolved, root, depth)));
  }

  const only = types[0];
  return only ? scalarLabel(only, resolved, root, depth) : 'unknown';
}

function scalarLabel(
  type: JsonSchemaType,
  schema: JsonSchema,
  root: JsonSchema | undefined,
  depth: number,
): string {
  switch (type) {
    case 'array':
      return arrayLabel(schema, root, depth);
    case 'object':
      return objectLabel(schema, root, depth);
    case 'string':
      // `format` is the difference between "a string" and "an email", and it is
      // exactly the kind of mismatch this product exists to surface.
      return typeof schema.format === 'string' ? `string (${schema.format})` : 'string';
    default:
      return type;
  }
}

function arrayLabel(schema: JsonSchema, root: JsonSchema | undefined, depth: number): string {
  if (depth >= 3) return 'Array<unknown>';

  const prefix = schema.prefixItems;
  if (Array.isArray(prefix) && prefix.length > 0) {
    const parts = prefix.map((item) => typeLabel(item, root, depth + 1));
    // A tuple with an open tail is still a tuple, but say that it continues.
    const rest = schema.items ? `, ...${typeLabel(schema.items, root, depth + 1)}[]` : '';
    return `[${parts.join(', ')}${rest}]`;
  }

  if (!schema.items) return 'Array<unknown>';
  return `Array<${typeLabel(schema.items, root, depth + 1)}>`;
}

function objectLabel(schema: JsonSchema, root: JsonSchema | undefined, depth: number): string {
  if (depth >= 2) return 'object';

  const properties = schema.properties;
  if (!properties) {
    const additional = schema.additionalProperties;
    if (additional && typeof additional === 'object') {
      return `Record<string, ${typeLabel(additional, root, depth + 1)}>`;
    }
    return 'object';
  }

  const required = new Set(schema.required ?? []);
  const entries = Object.entries(properties);
  if (entries.length === 0) return 'object';

  const shown = entries.slice(0, MAX_LABELLED_PROPERTIES).map(([key, value]) => {
    const optional = required.has(key) ? '' : '?';
    return `${key}${optional}: ${typeLabel(value, root, depth + 1)}`;
  });

  const hidden = entries.length - shown.length;
  const tail = hidden > 0 ? `; …+${hidden}` : '';
  return `{ ${shown.join('; ')}${tail} }`;
}

function literalLabel(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return 'unknown';
}

function joinUnion(parts: string[]): string {
  const unique = [...new Set(parts)];
  if (unique.length === 0) return 'unknown';
  if (unique.length <= MAX_LABELLED_UNION_BRANCHES) return unique.join(' | ');
  const shown = unique.slice(0, MAX_LABELLED_UNION_BRANCHES);
  return `${shown.join(' | ')} | …+${unique.length - shown.length}`;
}

/** `type` is either a single value or an array of them; callers want an array. */
export function normalizeTypes(type: JsonSchema['type']): JsonSchemaType[] {
  if (typeof type === 'string') return [type];
  if (Array.isArray(type)) return type;
  return [];
}

/* -------------------------------------------------------------------------- */
/* Field discovery                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Enumerate every field a connection could address, breadth-first.
 *
 * The root itself is always included with pointer `""`, because wiring a whole
 * object into a whole parameter is the common case, not an edge case.
 *
 * Recursion is bounded three ways — by depth, by total field count, and by a
 * per-branch set of already-visited schema objects — so a recursive `$ref` from
 * a third-party server terminates instead of hanging the canvas.
 */
export function listSchemaFields(
  schema: JsonSchema,
  options: ListSchemaFieldsOptions = {},
): SchemaField[] {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const root = options.root ?? schema;

  const out: SchemaField[] = [];
  const rootSchema = normalizeSchema(schema, root);
  if (!rootSchema) return out;

  out.push({
    pointer: '',
    name: '',
    typeLabel: typeLabel(rootSchema, root),
    schema: rootSchema,
    required: true,
    depth: 0,
    ...(typeof rootSchema.description === 'string' ? { description: rootSchema.description } : {}),
  });

  /**
   * `seen` tracks schema objects on the current path only. A shared `$def`
   * legitimately appears in sibling branches; only a cycle back into the branch
   * we are already inside is a problem.
   */
  const walk = (current: JsonSchema, pointer: string, depth: number, seen: Set<JsonSchema>) => {
    if (depth >= maxDepth) return;
    if (out.length >= 500) return;
    if (seen.has(current)) return;

    const nextSeen = new Set(seen);
    nextSeen.add(current);

    const properties = current.properties;
    if (properties) {
      const required = new Set(current.required ?? []);
      for (const [key, rawChild] of Object.entries(properties)) {
        const child = normalizeSchema(rawChild, root);
        if (!child) continue;

        const childPointer = formatPointer([...parsePointer(pointer), key]);
        out.push({
          pointer: childPointer,
          name: key,
          typeLabel: typeLabel(child, root),
          schema: child,
          required: required.has(key),
          depth: depth + 1,
          ...(typeof child.description === 'string' ? { description: child.description } : {}),
        });
        walk(child, childPointer, depth + 1, nextSeen);
      }
    }

    // Array elements are addressable, and are frequently what a user wants to
    // wire. `/0` addresses the first element of a homogeneous array.
    const items = current.items ? normalizeSchema(current.items, root) : undefined;
    if (items) {
      const itemPointer = formatPointer([...parsePointer(pointer), '0']);
      out.push({
        pointer: itemPointer,
        name: '0',
        typeLabel: typeLabel(items, root),
        schema: items,
        required: false,
        depth: depth + 1,
        ...(typeof items.description === 'string' ? { description: items.description } : {}),
      });
      walk(items, itemPointer, depth + 1, nextSeen);
    }

    const prefix = current.prefixItems;
    if (Array.isArray(prefix)) {
      for (let index = 0; index < prefix.length; index++) {
        const raw = prefix[index];
        const element = raw ? normalizeSchema(raw, root) : undefined;
        if (!element) continue;

        const elementPointer = formatPointer([...parsePointer(pointer), String(index)]);
        out.push({
          pointer: elementPointer,
          name: String(index),
          typeLabel: typeLabel(element, root),
          schema: element,
          required: true,
          depth: depth + 1,
          ...(typeof element.description === 'string' ? { description: element.description } : {}),
        });
        walk(element, elementPointer, depth + 1, nextSeen);
      }
    }
  };

  walk(rootSchema, '', 0, new Set());
  return out;
}
