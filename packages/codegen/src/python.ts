/**
 * The Python generator.
 *
 * Mirrors `typescript.ts`: same plan, same execution order, same field wiring —
 * only the spelling differs. Where the TypeScript side leans on
 * json-schema-to-typescript, this walks the schemas by hand, because there is no
 * Python toolchain in this repo to shell out to and a wrong-but-plausible
 * Pydantic model is worse than none.
 *
 * The generated bundle imports `pydantic` and `mcp` and nothing else. It has no
 * dependency on toolgraph, and never will — that is the whole promise of the
 * export feature.
 */

import type {
  CodegenResult,
  GeneratedFile,
  JsonSchema,
  McpToolDescriptor,
  ToolGraphDocument,
} from './contract';
import {
  parseJsonPointer,
  quotePy,
  sanitizePyIdentifier,
  toPascalCase,
  toSnakeCase,
  uniqueName,
} from './graph';
import { planGraph } from './plan';

/** Nested models deeper than this collapse to `dict[str, Any]`. */
const MAX_MODEL_DEPTH = 6;

interface ModelRegistry {
  /** Emitted class source, in declaration order. */
  classes: string[];
  taken: Set<string>;
}

/* -------------------------------------------------------------------------- */
/* Schema to Python type                                                       */
/* -------------------------------------------------------------------------- */

function resolveLocalRef(schema: JsonSchema, root: JsonSchema | undefined): JsonSchema {
  let current = schema;
  let hops = 0;

  while (typeof current.$ref === 'string' && hops < 16) {
    hops += 1;
    const ref = current.$ref;
    if (!root || !ref.startsWith('#/')) return {};

    let target: unknown = root;
    for (const token of parseJsonPointer(ref.slice(1))) {
      if (!target || typeof target !== 'object') return {};
      if (!Object.prototype.hasOwnProperty.call(target, token)) return {};
      target = (target as Record<string, unknown>)[token];
    }
    if (!target || typeof target !== 'object') return {};
    current = target as JsonSchema;
  }

  return current;
}

type SchemaTypeName =
  NonNullable<JsonSchema['type']> extends infer T
    ? T extends readonly (infer U)[]
      ? U
      : T
    : never;

function schemaTypes(schema: JsonSchema): SchemaTypeName[] {
  if (typeof schema.type === 'string') return [schema.type];
  if (Array.isArray(schema.type)) return schema.type;
  return [];
}

/**
 * Render a schema as a Python type annotation, emitting any nested models it
 * needs into `registry` as a side effect.
 */
function pythonType(
  schema: JsonSchema | undefined,
  root: JsonSchema | undefined,
  registry: ModelRegistry,
  nameHint: string,
  warnings: string[],
  depth = 0,
): string {
  if (!schema) return 'Any';
  if (depth > MAX_MODEL_DEPTH) return 'dict[str, Any]';

  const resolved = resolveLocalRef(schema, root);

  // A literal is the most precise thing we can say.
  if (resolved.const !== undefined) {
    return `Literal[${pythonLiteral(resolved.const)}]`;
  }

  if (Array.isArray(resolved.enum) && resolved.enum.length > 0) {
    const members = resolved.enum.map(pythonLiteral);
    return `Literal[${members.join(', ')}]`;
  }

  const branches = resolved.anyOf ?? resolved.oneOf;
  if (Array.isArray(branches) && branches.length > 0) {
    const rendered = branches.map((branch, index) =>
      pythonType(branch, root, registry, `${nameHint}Option${index + 1}`, warnings, depth + 1),
    );
    const unique = [...new Set(rendered)];
    return unique.length === 1 ? (unique[0] ?? 'Any') : unique.join(' | ');
  }

  if (Array.isArray(resolved.allOf) && resolved.allOf.length > 0) {
    // Merge shallowly, matching how schema-core normalises composition.
    const merged: JsonSchema = { type: 'object', properties: {}, required: [] };
    for (const branch of resolved.allOf) {
      const part = resolveLocalRef(branch, root);
      Object.assign(merged.properties as Record<string, JsonSchema>, part.properties ?? {});
      (merged.required as string[]).push(...(part.required ?? []));
    }
    return pythonType(merged, root, registry, nameHint, warnings, depth);
  }

  const types = schemaTypes(resolved);

  if (types.length > 1) {
    const rendered = types.map((type) =>
      pythonType({ ...resolved, type }, root, registry, nameHint, warnings, depth + 1),
    );
    return [...new Set(rendered)].join(' | ');
  }

  const type = types[0];

  switch (type) {
    case 'string':
      return 'str';
    case 'integer':
      return 'int';
    case 'number':
      return 'float';
    case 'boolean':
      return 'bool';
    case 'null':
      return 'None';
    case 'array': {
      const items = resolved.items;
      if (!items) return 'list[Any]';
      const inner = pythonType(items, root, registry, `${nameHint}Item`, warnings, depth + 1);
      return `list[${inner}]`;
    }
    case 'object': {
      if (resolved.properties && Object.keys(resolved.properties).length > 0) {
        return emitModel(resolved, root, registry, nameHint, warnings, depth);
      }
      const additional = resolved.additionalProperties;
      if (additional && typeof additional === 'object') {
        const inner = pythonType(
          additional,
          root,
          registry,
          `${nameHint}Value`,
          warnings,
          depth + 1,
        );
        return `dict[str, ${inner}]`;
      }
      return 'dict[str, Any]';
    }
    default:
      if (!type) {
        // No declared type at all: legal JSON Schema, just unhelpful.
        return 'Any';
      }
      warnings.push(`Python export: unrecognised type "${type}" on ${nameHint}, emitted as Any.`);
      return 'Any';
  }
}

/** Emit a BaseModel class and return its name. */
function emitModel(
  schema: JsonSchema,
  root: JsonSchema | undefined,
  registry: ModelRegistry,
  nameHint: string,
  warnings: string[],
  depth: number,
): string {
  const className = uniqueName(toPascalCase(nameHint) || 'Model', registry.taken);

  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);

  const lines: string[] = [`class ${className}(BaseModel):`];

  const description = typeof schema.description === 'string' ? schema.description.trim() : '';
  if (description) {
    lines.push(`    """${description.replace(/"""/g, '\\"\\"\\"')}"""`, '');
  }

  const entries = Object.entries(properties);
  if (entries.length === 0) {
    lines.push('    pass');
  }

  for (const [key, rawChild] of entries) {
    const fieldName = sanitizePyIdentifier(toSnakeCase(key), 'field');
    const annotation = pythonType(
      rawChild,
      root,
      registry,
      `${className}${toPascalCase(key)}`,
      warnings,
      depth + 1,
    );

    const isRequired = required.has(key);
    // A field whose Python name differs from the wire name needs an alias, or
    // the model would silently serialise the wrong key.
    const needsAlias = fieldName !== key;

    const fieldArgs: string[] = [];
    if (!isRequired) fieldArgs.push('default=None');
    if (needsAlias) fieldArgs.push(`alias=${quotePy(key)}`);

    const childDescription =
      rawChild && typeof rawChild === 'object' && typeof rawChild.description === 'string'
        ? rawChild.description.trim()
        : '';
    if (childDescription) {
      fieldArgs.push(`description=${quotePy(childDescription.slice(0, 300))}`);
    }

    const annotated = isRequired ? annotation : `${annotation} | None`;

    if (fieldArgs.length > 0) {
      lines.push(`    ${fieldName}: ${annotated} = Field(${fieldArgs.join(', ')})`);
    } else {
      lines.push(`    ${fieldName}: ${annotated}`);
    }
  }

  // Accept the wire names on input as well as the Python ones.
  lines.push('', '    model_config = ConfigDict(populate_by_name=True, extra="ignore")');

  registry.classes.push(lines.join('\n'));
  return className;
}

function pythonLiteral(value: unknown): string {
  if (value === null) return 'None';
  if (typeof value === 'string') return quotePy(value);
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'float("nan")';
  if (Array.isArray(value)) return `[${value.map(pythonLiteral).join(', ')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([key, item]) => `${quotePy(key)}: ${pythonLiteral(item)}`,
    );
    return `{${entries.join(', ')}}`;
  }
  return 'None';
}

/* -------------------------------------------------------------------------- */
/* Argument construction                                                       */
/* -------------------------------------------------------------------------- */

interface ArgNode {
  children: Map<string, ArgNode>;
  expression?: string;
}

function emptyArgNode(): ArgNode {
  return { children: new Map() };
}

function insertArg(root: ArgNode, pointer: string, expression: string): void {
  const tokens = parseJsonPointer(pointer);
  if (tokens.length === 0) {
    root.expression = expression;
    return;
  }

  let cursor = root;
  for (const token of tokens) {
    let next = cursor.children.get(token);
    if (!next) {
      next = emptyArgNode();
      cursor.children.set(token, next);
    }
    cursor = next;
  }
  cursor.expression = expression;
}

/** Render an argument tree as a Python dict literal. */
function renderArgs(node: ArgNode, indent: string): string {
  if (node.expression !== undefined && node.children.size === 0) return node.expression;
  if (node.children.size === 0) return '{}';

  const inner = `${indent}    `;
  const parts: string[] = [];
  for (const [key, child] of node.children) {
    parts.push(`${inner}${quotePy(key)}: ${renderArgs(child, inner)},`);
  }
  return `{\n${parts.join('\n')}\n${indent}}`;
}

/* -------------------------------------------------------------------------- */
/* Generator                                                                   */
/* -------------------------------------------------------------------------- */

interface ToolNames {
  inputModel: string;
  outputModel: string;
  fn: string;
}

export function generatePython(doc: ToolGraphDocument, tools: McpToolDescriptor[]): CodegenResult {
  const seen = new Set<string>();
  const unique = tools.filter((tool) => {
    const key = `${tool.serverId} ${tool.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const plan = planGraph(doc, unique);
  const warnings = [...plan.warnings];

  const registry: ModelRegistry = { classes: [], taken: new Set() };
  const names = new Map<string, ToolNames>();
  const takenFunctions = new Set<string>();

  for (const tool of unique) {
    const base = toPascalCase(tool.name) || 'Tool';

    const inputModel = emitModel(
      normaliseObject(tool.inputSchema),
      tool.inputSchema,
      registry,
      `${base}Input`,
      warnings,
      0,
    );

    let outputModel: string;
    if (tool.outputSchema) {
      outputModel = emitModel(
        normaliseObject(tool.outputSchema),
        tool.outputSchema,
        registry,
        `${base}Output`,
        warnings,
        0,
      );
    } else {
      // A server that declares no output schema gets an open model rather than
      // a fabricated one, and the caller is told why.
      outputModel = 'dict[str, Any]';
      warnings.push(
        `\`${tool.name}\` declares no output schema, so its Python return type is dict[str, Any].`,
      );
    }

    names.set(`${tool.serverId} ${tool.name}`, {
      inputModel,
      outputModel,
      fn: uniqueName(sanitizePyIdentifier(toSnakeCase(tool.name), 'call_tool'), takenFunctions),
    });
  }

  const files: GeneratedFile[] = [
    modelsFile(registry),
    clientFile(unique, names),
    runFile(plan, names, warnings),
    requirementsFile(),
    readmeFile(plan, names),
  ];

  return { target: 'python', files, warnings };
}

/** A tool schema that is not an object still has to become a model. */
function normaliseObject(schema: JsonSchema | undefined): JsonSchema {
  if (!schema) return { type: 'object', properties: {} };
  if (schema.properties) return schema;
  if (schemaTypes(schema).includes('object')) return schema;
  return { type: 'object', properties: {}, ...schema };
}

function modelsFile(registry: ModelRegistry): GeneratedFile {
  const header = [
    '"""',
    "Pydantic models generated from the MCP tools' own JSON Schemas.",
    '',
    'This file has no dependency on toolgraph. It is yours: edit it, vendor it,',
    'or regenerate it — nothing here phones home.',
    '"""',
    '',
    'from __future__ import annotations',
    '',
    'from typing import Any, Literal',
    '',
    'from pydantic import BaseModel, ConfigDict, Field',
    '',
    '',
  ].join('\n');

  const body = registry.classes.length > 0 ? registry.classes.join('\n\n\n') : 'pass';
  return { path: 'models.py', contents: `${header}${body}\n` };
}

function clientFile(tools: McpToolDescriptor[], names: Map<string, ToolNames>): GeneratedFile {
  const lines: string[] = [
    '"""',
    'One typed function per MCP tool.',
    '',
    'Each validates its arguments with the generated Pydantic model before the',
    'call, so a bad payload fails here rather than inside the server.',
    '"""',
    '',
    'from __future__ import annotations',
    '',
    'from typing import Any',
    '',
    'from mcp import ClientSession',
    '',
    'from models import (',
  ];

  const imported = new Set<string>();
  for (const tool of tools) {
    const entry = names.get(`${tool.serverId} ${tool.name}`);
    if (!entry) continue;
    imported.add(entry.inputModel);
    if (entry.outputModel !== 'dict[str, Any]') imported.add(entry.outputModel);
  }
  for (const name of [...imported].sort()) lines.push(`    ${name},`);
  lines.push(')', '', '');

  lines.push(
    'def _unwrap(result: Any) -> Any:',
    '    """Prefer a server\'s structured content, falling back to its content blocks."""',
    '    structured = getattr(result, "structuredContent", None)',
    '    if structured is not None:',
    '        return structured',
    '',
    '    content = getattr(result, "content", None)',
    '    if not content:',
    '        return {}',
    '',
    '    first = content[0]',
    '    text = getattr(first, "text", None)',
    '    if text is None:',
    '        return content',
    '',
    '    import json',
    '',
    '    try:',
    '        return json.loads(text)',
    '    except (ValueError, TypeError):',
    '        return text',
    '',
    '',
  );

  for (const tool of tools) {
    const entry = names.get(`${tool.serverId} ${tool.name}`);
    if (!entry) continue;

    const returns = entry.outputModel === 'dict[str, Any]' ? 'Any' : entry.outputModel;
    const description = (tool.description ?? '').trim().replace(/\s+/g, ' ').slice(0, 240);

    lines.push(
      `async def ${entry.fn}(session: ClientSession, payload: ${entry.inputModel}) -> ${returns}:`,
      `    """${description || `Call the \`${tool.name}\` tool.`}"""`,
      `    validated = ${entry.inputModel}.model_validate(payload, from_attributes=True)`,
      `    result = await session.call_tool(${quotePy(tool.name)}, validated.model_dump(by_alias=True, exclude_none=True))`,
      '    raw = _unwrap(result)',
    );

    if (returns === 'Any') {
      lines.push('    return raw', '', '');
    } else {
      lines.push(`    return ${returns}.model_validate(raw)`, '', '');
    }
  }

  return { path: 'client.py', contents: `${lines.join('\n')}\n` };
}

function runFile(
  plan: ReturnType<typeof planGraph>,
  names: Map<string, ToolNames>,
  warnings: string[],
): GeneratedFile {
  const lines: string[] = [
    '"""',
    `Runs the \`${plan.name}\` graph, in the order toolgraph resolved.`,
    '',
    'Straight-line code on purpose: every step and every field is visible, so you',
    'can read it, change it, or lift one call out of it.',
    '"""',
    '',
    'from __future__ import annotations',
    '',
    'from typing import Any',
    '',
    'from mcp import ClientSession',
    '',
    'import client',
    '',
    '',
    'async def run_graph(session: ClientSession, graph_input: dict[str, Any] | None = None) -> dict[str, Any]:',
    '    values: dict[str, Any] = {}',
    '    graph_input = graph_input or {}',
    '',
  ];

  if (plan.inputs.length === 0 && plan.steps.length === 0) {
    lines.push('    return {}', '');
    return { path: 'run.py', contents: `${lines.join('\n')}\n` };
  }

  for (const entry of plan.inputs) {
    lines.push(`    values[${quotePy(entry.nodeId)}] = graph_input.get(${quotePy(entry.label)})`);
  }
  if (plan.inputs.length > 0) lines.push('');

  for (const step of plan.steps) {
    const entry = names.get(`${step.tool.serverId} ${step.tool.name}`);
    if (!entry) {
      warnings.push(
        `Python export: no generated function for \`${step.tool.name}\`; step skipped.`,
      );
      continue;
    }

    const args = emptyArgNode();
    for (const assignment of step.assignments) {
      if (assignment.kind === 'static') {
        insertArg(args, assignment.pointer, pythonLiteral(assignment.value));
      } else {
        const source = `values[${quotePy(assignment.sourceNodeId)}]`;
        insertArg(args, assignment.pointer, accessPy(source, assignment.sourceHandle));
      }
    }

    lines.push(
      `    # ${step.label}`,
      `    ${entry.fn}_args = ${entry.inputModel}.model_validate(${renderArgs(args, '    ')})`,
      `    values[${quotePy(step.nodeId)}] = await client.${entry.fn}(session, ${entry.fn}_args)`,
      '',
    );
  }

  if (plan.steps.length > 0) {
    // Imported lazily at the bottom of the import block above would be wrong;
    // this is the set of models run_graph itself constructs.
    const modelImports = [
      ...new Set(
        plan.steps
          .map((step) => names.get(`${step.tool.serverId} ${step.tool.name}`)?.inputModel)
          .filter((name): name is string => Boolean(name)),
      ),
    ].sort();

    const importIndex = lines.indexOf('import client');
    if (importIndex !== -1 && modelImports.length > 0) {
      lines.splice(importIndex, 0, `from models import ${modelImports.join(', ')}`);
    }
  }

  lines.push('    return {');
  for (const output of plan.outputs) {
    const assignment = output.assignments[0];
    if (assignment && assignment.kind === 'edge') {
      const source = `values[${quotePy(assignment.sourceNodeId)}]`;
      lines.push(`        ${quotePy(output.label)}: ${accessPy(source, assignment.sourceHandle)},`);
    } else if (assignment && assignment.kind === 'static') {
      lines.push(`        ${quotePy(output.label)}: ${pythonLiteral(assignment.value)},`);
    }
  }
  if (plan.outputs.length === 0 && plan.steps.length > 0) {
    const last = plan.steps[plan.steps.length - 1];
    if (last) lines.push(`        "result": values[${quotePy(last.nodeId)}],`);
  }
  lines.push('    }', '');

  return { path: 'run.py', contents: `${lines.join('\n')}\n` };
}

/**
 * Read a pointer off a runtime value in Python.
 *
 * Uses `.get()` for object steps so a missing key yields None instead of
 * raising, which matches how the engine treats a missing optional.
 */
function accessPy(base: string, pointer: string): string {
  const tokens = parseJsonPointer(pointer);
  let expression = base;

  for (const token of tokens) {
    if (/^(?:0|[1-9][0-9]*)$/.test(token)) {
      expression = `${expression}[${token}]`;
      continue;
    }
    expression = `(${expression} or {}).get(${quotePy(token)})`;
  }

  return expression;
}

function requirementsFile(): GeneratedFile {
  return {
    path: 'requirements.txt',
    contents: ['pydantic>=2.0', 'mcp>=1.0', ''].join('\n'),
  };
}

function readmeFile(
  plan: ReturnType<typeof planGraph>,
  names: Map<string, ToolNames>,
): GeneratedFile {
  const steps = plan.steps
    .map((step, index) => {
      const entry = names.get(`${step.tool.serverId} ${step.tool.name}`);
      return `${index + 1}. \`${entry?.fn ?? step.tool.name}\` — ${step.label}`;
    })
    .join('\n');

  return {
    path: 'README.md',
    contents: `# ${plan.name}

Generated by [toolgraph](https://toolgraph.dev) from a graph of MCP tools.

## This code is yours

It depends on \`pydantic\` and \`mcp\`, and on nothing else. There is no toolgraph
runtime, no SDK, and no account check. If toolgraph disappeared tomorrow this
would keep working exactly as it does today.

## Install

\`\`\`bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
\`\`\`

## Files

| File              | What it is                                                   |
| ----------------- | ------------------------------------------------------------ |
| \`models.py\`       | Pydantic models generated from each tool's real JSON Schema  |
| \`client.py\`       | One typed \`async def\` per tool, validating before it calls   |
| \`run.py\`          | The graph itself, as straight-line code in execution order   |

## Run it

\`\`\`python
import asyncio
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

from run import run_graph


async def main() -> None:
    async with streamablehttp_client("https://your-mcp-server.example/mcp") as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            print(await run_graph(session, {}))


asyncio.run(main())
\`\`\`

## Execution order

${steps || '_This graph has no tool steps yet._'}
`,
  };
}
