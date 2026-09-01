/**
 * `@toolgraph/codegen` — turns a graph into standalone source the user owns.
 *
 * NODE ONLY. `json-schema-to-typescript` reaches for the filesystem and a
 * formatter, so this package must be imported from a route handler or a server
 * component, never from anything that reaches a browser bundle.
 *
 * The one invariant worth stating plainly: **nothing this package emits imports
 * from toolgraph.** The generated TypeScript depends on `zod` and the MCP SDK;
 * the generated Python depends on `pydantic` and `mcp`. A test asserts it.
 */

import type { CodegenResult, ExportTarget, McpToolDescriptor, ToolGraphDocument } from './contract';
import { generateTypeScript } from './typescript';
import { generatePython } from './python';

export { generateTypeScript } from './typescript';
export { generatePython } from './python';
export { planGraph } from './plan';
export type {
  Assignment,
  EdgeAssignment,
  GraphPlan,
  PlannedInput,
  PlannedOutput,
  PlannedStep,
  StaticAssignment,
} from './plan';
export {
  isValidPyIdentifier,
  isValidTsIdentifier,
  parseJsonPointer,
  pointerToAccessPath,
  PY_RESERVED_WORDS,
  sanitizePyIdentifier,
  sanitizeTsIdentifier,
  toCamelCase,
  toPascalCase,
  toSnakeCase,
  topologicalSort,
  TS_RESERVED_WORDS,
  uniqueName,
} from './graph';
export type { TopologicalSortResult } from './graph';
export type { CodegenResult, ExportTarget, GeneratedFile } from './contract';

/** Generate for whichever target the user picked. */
export async function generate(
  target: ExportTarget,
  doc: ToolGraphDocument,
  tools: McpToolDescriptor[],
): Promise<CodegenResult> {
  if (target === 'python') return generatePython(doc, tools);
  return generateTypeScript(doc, tools);
}
