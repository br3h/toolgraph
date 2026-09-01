/**
 * Language-agnostic helpers shared by the TypeScript and Python generators:
 * graph ordering, JSON-pointer translation and identifier hygiene.
 *
 * Nothing here emits code. Both generators depend on it so that a graph is
 * linearised exactly once, and so that a field called `from` is renamed the same
 * way no matter which target the user picks.
 */

import type { GraphNode, ToolGraphDocument } from './contract';

/* -------------------------------------------------------------------------- */
/* Reserved words                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Words that cannot be used as a bare TypeScript identifier. Includes the
 * strict-mode reserved words and the contextual ones, because generated code is
 * always a module and modules are always strict.
 */
export const TS_RESERVED_WORDS: ReadonlySet<string> = new Set([
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);

/**
 * Python 3 hard keywords plus the soft keywords. `match`, `case` and `type` are
 * legal identifiers today, but shadowing them in generated code is a trap, so
 * they are renamed too.
 */
export const PY_RESERVED_WORDS: ReadonlySet<string> = new Set([
  'False',
  'None',
  'True',
  'and',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'case',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'match',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'try',
  'type',
  'while',
  'with',
  'yield',
]);

/* -------------------------------------------------------------------------- */
/* Identifiers                                                                 */
/* -------------------------------------------------------------------------- */

const TS_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
/** ASCII only. Python allows unicode identifiers; generated code stays portable. */
const PY_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ARRAY_INDEX = /^(?:0|[1-9][0-9]*)$/;

export function isValidTsIdentifier(name: string): boolean {
  return TS_IDENTIFIER.test(name) && !TS_RESERVED_WORDS.has(name);
}

export function isValidPyIdentifier(name: string): boolean {
  return PY_IDENTIFIER.test(name) && !PY_RESERVED_WORDS.has(name);
}

function sanitize(name: string, reserved: ReadonlySet<string>, fallback: string): string {
  let out = name.replace(/[^A-Za-z0-9_$]/g, '_');
  if (out === '' || /^[0-9]/.test(out)) out = `_${out}`;
  if (reserved.has(out)) out = `${out}_`;
  return out === '_' ? fallback : out;
}

/** Turns an arbitrary wire name into something safe to write as a TS identifier. */
export function sanitizeTsIdentifier(name: string, fallback = 'value'): string {
  return sanitize(name, TS_RESERVED_WORDS, fallback);
}

/**
 * Same for Python, except `$` is not a legal character there, so it is folded to
 * an underscore before the shared pass runs.
 */
export function sanitizePyIdentifier(name: string, fallback = 'value'): string {
  return sanitize(name.replace(/\$/g, '_'), PY_RESERVED_WORDS, fallback);
}

/**
 * Splits an arbitrary string into words, treating punctuation and camelCase
 * humps alike as boundaries so that `getHTTPResponse` becomes
 * `['get', 'HTTP', 'Response']`.
 */
function words(input: string): string[] {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word.length > 0);
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

export function toPascalCase(input: string): string {
  const parts = words(input).map(capitalize);
  if (parts.length === 0) return 'Value';
  const joined = parts.join('');
  return /^[0-9]/.test(joined) ? `_${joined}` : joined;
}

export function toCamelCase(input: string): string {
  const parts = words(input);
  const first = parts[0];
  if (first === undefined) return 'value';
  const joined = `${first.toLowerCase()}${parts.slice(1).map(capitalize).join('')}`;
  return /^[0-9]/.test(joined) ? `_${joined}` : joined;
}

export function toSnakeCase(input: string): string {
  const parts = words(input).map((word) => word.toLowerCase());
  if (parts.length === 0) return 'value';
  const joined = parts.join('_');
  return /^[0-9]/.test(joined) ? `_${joined}` : joined;
}

/** Allocates `base`, or `base2`, `base3`, ... if it is already spoken for. */
export function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  let counter = 2;
  while (taken.has(`${base}${counter}`)) counter += 1;
  const name = `${base}${counter}`;
  taken.add(name);
  return name;
}

/* -------------------------------------------------------------------------- */
/* String literals                                                             */
/* -------------------------------------------------------------------------- */

function escapeBody(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/** A single-quoted TypeScript string literal, matching the repo's Prettier style. */
export function quoteTs(value: string): string {
  return `'${escapeBody(value).replace(/'/g, "\\'")}'`;
}

/** A double-quoted Python string literal, matching Black's preference. */
export function quotePy(value: string): string {
  return `"${escapeBody(value).replace(/"/g, '\\"')}"`;
}

/* -------------------------------------------------------------------------- */
/* JSON pointers                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Splits an RFC 6901 pointer into its unescaped segments. `""` addresses the
 * whole document and yields no segments; `"/"` addresses the empty-string key.
 */
export function parseJsonPointer(pointer: string): string[] {
  if (pointer === '') return [];
  const body = pointer.startsWith('/') ? pointer.slice(1) : pointer;
  return body.split('/').map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
}

export function isArrayIndexSegment(segment: string): boolean {
  return ARRAY_INDEX.test(segment);
}

/**
 * Turns a JSON pointer into an access chain that can be appended to an
 * expression: `/user/id` becomes `.user.id`, `/items/0` becomes `.items[0]` and
 * a key that is not a legal identifier in the target language falls back to
 * bracket notation.
 *
 * The Python models generated by this package expose `__getitem__` over their
 * wire names, so bracket notation reads the same field there as it does in
 * TypeScript even when the attribute itself had to be renamed.
 */
export function pointerToAccessPath(pointer: string, style: 'ts' | 'py'): string {
  let path = '';
  for (const segment of parseJsonPointer(pointer)) {
    if (isArrayIndexSegment(segment)) {
      path += `[${segment}]`;
      continue;
    }
    const legal = style === 'ts' ? isValidTsIdentifier(segment) : isValidPyIdentifier(segment);
    path += legal ? `.${segment}` : `[${style === 'ts' ? quoteTs(segment) : quotePy(segment)}]`;
  }
  return path;
}

/* -------------------------------------------------------------------------- */
/* Topological sort                                                            */
/* -------------------------------------------------------------------------- */

export interface TopologicalSortResult {
  /** Nodes in dependency order. Partial when `cycle` is set. */
  order: GraphNode[];
  /** Node ids forming one cycle, with the entry point repeated last. */
  cycle?: string[];
}

/**
 * Kahn's algorithm over the document's nodes.
 *
 * Ties are broken by the document's own node order, so the same document always
 * produces byte-identical generated code. A cycle is reported rather than
 * thrown: the caller decides whether that is fatal.
 */
export function topologicalSort(doc: ToolGraphDocument): TopologicalSortResult {
  const nodesById = new Map(doc.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, string[]>(doc.nodes.map((node) => [node.id, []]));
  const indegree = new Map<string, number>(doc.nodes.map((node) => [node.id, 0]));
  /** Deduped so a pair of nodes wired by two edges still has indegree 1. */
  const seenEdges = new Set<string>();

  for (const edge of doc.edges) {
    // An edge naming a node the document does not contain cannot constrain the
    // order, so it is dropped rather than allowed to corrupt the indegrees.
    if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) continue;
    const key = `${edge.source} ${edge.target}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    outgoing.get(edge.source)?.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  const queue = doc.nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const order: GraphNode[] = [];

  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) break;
    const node = nodesById.get(id);
    if (node) order.push(node);
    for (const next of outgoing.get(id) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }

  if (order.length === doc.nodes.length) return { order };

  const unresolved = new Set(
    doc.nodes.filter((node) => (indegree.get(node.id) ?? 0) > 0).map((node) => node.id),
  );
  const cycle = findCycle(doc, unresolved, outgoing);
  return cycle ? { order, cycle } : { order };
}

/** Depth-first walk of the nodes Kahn's algorithm could not drain. */
function findCycle(
  doc: ToolGraphDocument,
  unresolved: Set<string>,
  outgoing: Map<string, string[]>,
): string[] | undefined {
  const onStack = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const walk = (id: string): string[] | undefined => {
    visited.add(id);
    onStack.add(id);
    stack.push(id);
    for (const next of outgoing.get(id) ?? []) {
      if (!unresolved.has(next)) continue;
      if (onStack.has(next)) return [...stack.slice(stack.indexOf(next)), next];
      if (!visited.has(next)) {
        const found = walk(next);
        if (found) return found;
      }
    }
    onStack.delete(id);
    stack.pop();
    return undefined;
  };

  for (const node of doc.nodes) {
    if (!unresolved.has(node.id) || visited.has(node.id)) continue;
    const found = walk(node.id);
    if (found) return found;
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* Value trees                                                                 */
/* -------------------------------------------------------------------------- */

interface ValueBranch {
  kind: 'branch';
  children: Map<string, ValueTree>;
}

interface ValueLeaf {
  kind: 'leaf';
  expr: string;
}

/**
 * A partially-built literal. Leaves hold already-rendered target-language
 * expressions, so the structure is shared and only the spelling is not.
 */
export type ValueTree = ValueLeaf | ValueBranch;

export interface ValueTreeEntry {
  /** RFC 6901 pointer into the value being built. `''` is the whole value. */
  pointer: string;
  expr: string;
}

export interface ValueTreeResult {
  /** Undefined when there was nothing to assign. */
  tree: ValueTree | undefined;
  warnings: string[];
}

function newBranch(): ValueBranch {
  return { kind: 'branch', children: new Map() };
}

/**
 * Folds pointer/expression pairs into one nested literal.
 *
 * Later entries win any collision, and every collision is reported: two edges
 * landing on the same field is a graph the user probably did not mean to draw,
 * and silently dropping one of them would be the worst possible answer.
 */
export function buildValueTree(entries: ValueTreeEntry[]): ValueTreeResult {
  const warnings: string[] = [];
  let root: ValueTree | undefined;

  for (const entry of entries) {
    const segments = parseJsonPointer(entry.pointer);
    const last = segments.at(-1);

    if (last === undefined) {
      if (root !== undefined) {
        warnings.push('Two sources feed the whole value; the later one was used.');
      }
      root = { kind: 'leaf', expr: entry.expr };
      continue;
    }

    if (root === undefined) {
      root = newBranch();
    } else if (root.kind === 'leaf') {
      warnings.push(
        `A source feeds the whole value and another feeds "${entry.pointer}"; the field assignments were used.`,
      );
      root = newBranch();
    }

    let cursor: ValueBranch = root;
    for (const segment of segments.slice(0, -1)) {
      const existing = cursor.children.get(segment);
      if (existing?.kind === 'branch') {
        cursor = existing;
        continue;
      }
      if (existing?.kind === 'leaf') {
        warnings.push(
          `"${entry.pointer}" writes inside a field another source already fills whole; the nested assignment was used.`,
        );
      }
      const branch = newBranch();
      cursor.children.set(segment, branch);
      cursor = branch;
    }

    if (cursor.children.has(last)) {
      warnings.push(`Two sources feed "${entry.pointer}"; the later one was used.`);
    }
    cursor.children.set(last, { kind: 'leaf', expr: entry.expr });
  }

  return { tree: root, warnings };
}

/** True when every key of a branch is an array index, so it renders as a list. */
export function isArrayBranch(children: ReadonlyMap<string, ValueTree>): boolean {
  if (children.size === 0) return false;
  for (const key of children.keys()) {
    if (!isArrayIndexSegment(key)) return false;
  }
  return true;
}

/**
 * How long the list an array branch renders to has to be. Gaps are the caller's
 * problem: it knows what "nothing here" looks like in its own language.
 */
export function arrayBranchLength(children: ReadonlyMap<string, ValueTree>): number {
  let max = -1;
  for (const key of children.keys()) max = Math.max(max, Number(key));
  return max + 1;
}
