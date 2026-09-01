/**
 * Single import point for the shared contract types.
 *
 * These types live in `@toolgraph/schema-core`, whose barrel re-exports them.
 * Routing every generator through this one module means a change to the
 * contract's import path is a one-line edit here rather than a sweep.
 *
 * This is a type-only re-export, so it disappears entirely at runtime.
 */
export type {
  CodegenResult,
  ExportTarget,
  GeneratedFile,
  GraphEdge,
  GraphNode,
  GraphNodeData,
  JsonSchema,
  JsonSchemaType,
  McpToolDescriptor,
  ToolGraphDocument,
} from '@toolgraph/schema-core';
