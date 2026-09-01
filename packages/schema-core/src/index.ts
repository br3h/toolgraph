/**
 * `@toolgraph/schema-core` — JSON Schema compatibility checking.
 *
 * Zero runtime dependencies, no side effects, no Node built-ins. It runs
 * unchanged in a browser bundle, a serverless function and the engine.
 */

export type {
  CodegenResult,
  CompatibilityIssue,
  CompatibilityIssueCode,
  CompatibilityResult,
  CompatibilitySeverity,
  ExecutionEvent,
  ExecutionStepResult,
  ExecutionStepStatus,
  ExportTarget,
  GeneratedFile,
  GraphEdge,
  GraphNode,
  GraphNodeData,
  GraphNodeKind,
  GraphNodePosition,
  JsonSchema,
  JsonSchemaType,
  McpConnectionSecrets,
  McpServerConnection,
  McpToolDescriptor,
  McpTransportType,
  SchemaField,
  ToolGraphDocument,
} from './types';

export { checkConnection, isSubschema, type CheckConnectionArgs } from './compat';

export {
  formatPointer,
  mergeAllOf,
  mergeSchemas,
  normalizeSchema,
  parsePointer,
  resolvePointer,
  resolveRef,
} from './pointer';

export {
  listSchemaFields,
  normalizeTypes,
  typeLabel,
  type ListSchemaFieldsOptions,
} from './fields';
