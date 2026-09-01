/**
 * Shared types for toolgraph.
 *
 * This module is the contract between every other package: the engine, the web
 * app, the code generators and the MCP client all speak these shapes. It has no
 * runtime dependencies and no side effects, so it is safe to import from a
 * browser bundle, a serverless function or a long-running Node process alike.
 */

/* -------------------------------------------------------------------------- */
/* JSON Schema                                                                 */
/* -------------------------------------------------------------------------- */

/** The primitive `type` values JSON Schema allows. */
export type JsonSchemaType =
  'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';

/**
 * A structurally-typed view of the JSON Schema dialect MCP servers actually
 * emit (Draft 2020-12, in practice a small subset of it).
 *
 * Deliberately permissive: an MCP server is a third party and may send keywords
 * we do not model. Unknown keywords are preserved by the index signature rather
 * than dropped, so codegen can pass them through even when the type checker
 * ignores them.
 */
export interface JsonSchema {
  $schema?: string;
  $id?: string;
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  /** Draft-07 spelling of `$defs`; MCP servers in the wild still emit it. */
  definitions?: Record<string, JsonSchema>;

  type?: JsonSchemaType | JsonSchemaType[];
  title?: string;
  description?: string;
  default?: unknown;
  examples?: unknown[];
  deprecated?: boolean;

  // Object
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  patternProperties?: Record<string, JsonSchema>;
  minProperties?: number;
  maxProperties?: number;

  // Array
  items?: JsonSchema;
  prefixItems?: JsonSchema[];
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;

  // String
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;

  // Number
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;

  // Enumerations and constants
  enum?: unknown[];
  const?: unknown;

  // Composition
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  not?: JsonSchema;

  // Conditionals — modelled so they survive a round trip, not evaluated.
  if?: JsonSchema;
  then?: JsonSchema;
  else?: JsonSchema;

  /** Unknown keywords are preserved rather than discarded. */
  [key: string]: unknown;
}

/* -------------------------------------------------------------------------- */
/* MCP servers and tools                                                       */
/* -------------------------------------------------------------------------- */

/** How the engine reaches an MCP server. */
export type McpTransportType = 'stdio' | 'sse' | 'http';

/**
 * A server the user has asked toolgraph to talk to.
 *
 * Auth material is intentionally NOT part of this type. Credentials are
 * supplied per request at connect time and never persisted alongside the
 * connection record. See `McpConnectionSecrets`.
 */
export interface McpServerConnection {
  id: string;
  name: string;
  transport: McpTransportType;
  /** Present for `sse` and `http` transports. */
  url?: string;
  /** Present for the `stdio` transport: the executable to spawn. */
  command?: string;
  /** Arguments for the `stdio` command. */
  args?: string[];
}

/**
 * Per-connection credentials. Supplied by the client on each request and passed
 * straight through to the transport. Never written to a plaintext column; if
 * persistence is ever required, it goes through Supabase Vault.
 */
export interface McpConnectionSecrets {
  /** Extra HTTP headers, e.g. `{ Authorization: 'Bearer ...' }`. */
  headers?: Record<string, string>;
  /** Extra environment variables for a stdio server. */
  env?: Record<string, string>;
}

/** One tool advertised by an MCP server, with its real schemas. */
export interface McpToolDescriptor {
  /** Id of the `McpServerConnection` this tool came from. */
  serverId: string;
  /** The tool's protocol name, unique within its server. */
  name: string;
  title?: string;
  description?: string;
  /** Always present — the MCP spec requires `inputSchema` on every tool. */
  inputSchema: JsonSchema;
  /**
   * Optional per the MCP spec. When a server omits it, toolgraph treats the
   * output as `unknown` and every outgoing connection from this tool is a
   * warning rather than a hard error.
   */
  outputSchema?: JsonSchema;
}

/* -------------------------------------------------------------------------- */
/* The graph document                                                          */
/* -------------------------------------------------------------------------- */

export interface GraphNodePosition {
  x: number;
  y: number;
}

/**
 * `mcpTool` nodes call a real tool. `input` and `output` nodes are the graph's
 * boundary: values the caller supplies, and values the graph returns.
 */
export type GraphNodeKind = 'mcpTool' | 'input' | 'output';

export interface GraphNodeData {
  label: string;
  /** Set on `mcpTool` nodes. */
  serverId?: string;
  /** Set on `mcpTool` nodes. */
  toolName?: string;
  /** The tool's input schema, or for an `input` node the schema it declares. */
  inputSchema?: JsonSchema;
  /** The tool's output schema, or for an `output` node the schema it expects. */
  outputSchema?: JsonSchema;
  /**
   * Literal values bound to input fields that no edge feeds, keyed by JSON
   * pointer (e.g. `"/limit": 10`).
   */
  staticInputs?: Record<string, unknown>;
}

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  position: GraphNodePosition;
  data: GraphNodeData;
}

/**
 * An edge feeds one field of a source node's output into one field of a target
 * node's input. Handles are RFC 6901 JSON pointers into the respective schemas.
 * The empty string `""` means "the whole value".
 */
export interface GraphEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}

/** The persisted document. `graphs.graph_json` holds exactly this shape. */
export interface ToolGraphDocument {
  version: 1;
  name: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Server connections referenced by the nodes. Never contains secrets. */
  servers: McpServerConnection[];
}

/* -------------------------------------------------------------------------- */
/* Compatibility checking                                                      */
/* -------------------------------------------------------------------------- */

/** Why a connection was rejected, or flagged. */
export type CompatibilityIssueCode =
  /** Source produces a type the target cannot accept at all. */
  | 'type_mismatch'
  /** Target requires a field the source never produces. */
  | 'missing_required_property'
  /** Source may omit a property the target requires. */
  | 'optional_feeds_required'
  /** Source `enum`/`const` includes values outside the target's allowed set. */
  | 'enum_not_subset'
  /** Array element types are incompatible. */
  | 'array_item_mismatch'
  /** Tuple arity differs in a way the target cannot accept. */
  | 'tuple_arity_mismatch'
  /** Target forbids additional properties the source would supply. */
  | 'additional_properties_forbidden'
  /** A numeric or string constraint on the target cannot be guaranteed. */
  | 'constraint_not_guaranteed'
  /** `format` differs in a way that may lose meaning. */
  | 'format_mismatch'
  /** A `$ref` could not be resolved within the document. */
  | 'unresolved_ref'
  /** No branch of a union on the source satisfies the target. */
  | 'union_no_compatible_branch'
  /** The pointer does not address anything in the schema. */
  | 'pointer_not_found'
  /** The source tool declares no output schema, so nothing can be proven. */
  | 'unknown_source_schema'
  /** Recursion or `$ref` depth exceeded the checker's limit. */
  | 'depth_limit_exceeded';

/**
 * `error` blocks the connection. `warning` allows it but surfaces a caveat —
 * used where a schema is under-specified rather than actually wrong.
 */
export type CompatibilitySeverity = 'error' | 'warning';

export interface CompatibilityIssue {
  code: CompatibilityIssueCode;
  severity: CompatibilitySeverity;
  /**
   * JSON pointer to the offending location, relative to the connection's target
   * field. `""` refers to the connected field itself.
   */
  path: string;
  /** Human-readable type the target needs, e.g. `"string"` or `"{ id: string }"`. */
  expected: string;
  /** Human-readable type the source supplies. */
  actual: string;
  /** A complete sentence naming the field, expected type and actual type. */
  message: string;
}

export interface CompatibilityResult {
  /** True when there are no `error`-severity issues. */
  compatible: boolean;
  issues: CompatibilityIssue[];
}

/** One addressable field discovered by walking a schema. */
export interface SchemaField {
  /** RFC 6901 pointer, e.g. `"/user/id"`. */
  pointer: string;
  /** Leaf name, e.g. `"id"`. `""` for the root. */
  name: string;
  /** Compact human-readable type, e.g. `"string"`, `"Array<number>"`. */
  typeLabel: string;
  schema: JsonSchema;
  required: boolean;
  /** Nesting depth; the root is 0. */
  depth: number;
  description?: string;
}

/* -------------------------------------------------------------------------- */
/* Execution                                                                   */
/* -------------------------------------------------------------------------- */

export type ExecutionStepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';

export interface ExecutionStepResult {
  nodeId: string;
  toolName?: string;
  status: ExecutionStepStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  /** Arguments actually sent to the tool, after edges and static inputs merge. */
  input?: unknown;
  output?: unknown;
  error?: string;
}

/**
 * Events the engine streams over SSE during a run. The client can render
 * progress from these alone; nothing depends on a persistent socket.
 */
export type ExecutionEvent =
  | { type: 'run:start'; runId: string; totalSteps: number; at: string }
  | { type: 'step:start'; runId: string; nodeId: string; toolName?: string; at: string }
  | { type: 'step:finish'; runId: string; step: ExecutionStepResult }
  | {
      type: 'run:finish';
      runId: string;
      status: 'succeeded' | 'failed';
      steps: ExecutionStepResult[];
      at: string;
    }
  | { type: 'run:error'; runId: string; message: string; at: string }
  | { type: 'ping'; at: string };

/* -------------------------------------------------------------------------- */
/* Code generation                                                             */
/* -------------------------------------------------------------------------- */

export type ExportTarget = 'typescript' | 'python';

export interface GeneratedFile {
  /** Path relative to the root of the exported bundle, e.g. `"src/tools.ts"`. */
  path: string;
  contents: string;
}

export interface CodegenResult {
  target: ExportTarget;
  files: GeneratedFile[];
  /** Notes worth showing the user, e.g. a tool whose output schema was missing. */
  warnings: string[];
}
