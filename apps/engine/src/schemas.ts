/**
 * Request validation.
 *
 * Every endpoint parses its body through one of these before touching it. The
 * client's shape is never trusted, and a failure is a 400 with a specific
 * message rather than a stack trace.
 */

import { z } from 'zod';

/** Bodies are capped well below this; the limit is the last line of defence. */
export const MAX_BODY_BYTES = 1_048_576; // 1 MB
/** Graph export and run payloads carry whole schemas, so they get more room. */
export const MAX_RUN_BODY_BYTES = 4_194_304; // 4 MB

const identifier = z.string().min(1).max(200);

/**
 * A JSON Schema, accepted structurally rather than validated as a dialect.
 *
 * The schemas come from third-party MCP servers and legitimately contain
 * keywords we do not model. Rejecting them would break real servers; the
 * compatibility checker is what interprets them, and it is defensive.
 */
export const jsonSchemaShape: z.ZodType<Record<string, unknown>> = z.record(
  z.string(),
  z.unknown(),
);

export const mcpServerConnectionSchema = z
  .object({
    id: identifier,
    name: z.string().min(1).max(120),
    transport: z.enum(['stdio', 'sse', 'http']),
    url: z.string().url().max(2048).optional(),
    command: z.string().min(1).max(500).optional(),
    args: z.array(z.string().max(500)).max(50).optional(),
  })
  .refine((value) => (value.transport === 'stdio' ? Boolean(value.command) : Boolean(value.url)), {
    message: 'An sse or http server needs a url; a stdio server needs a command.',
  });

/**
 * Per-connection credentials.
 *
 * Present in the request and gone when it ends. Nothing here is logged, and
 * nothing here is written to the database — see the comment on the
 * `mcp_server_connections` table.
 */
export const mcpConnectionSecretsSchema = z.object({
  headers: z.record(z.string().max(200), z.string().max(8192)).optional(),
  env: z.record(z.string().max(200), z.string().max(8192)).optional(),
});

export const introspectBodySchema = z.object({
  connection: mcpServerConnectionSchema,
  secrets: mcpConnectionSecretsSchema.optional(),
});

export type IntrospectBody = z.infer<typeof introspectBodySchema>;

const graphNodeSchema = z.object({
  id: identifier,
  kind: z.enum(['mcpTool', 'input', 'output']),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }),
  data: z.object({
    label: z.string().max(200),
    serverId: identifier.optional(),
    toolName: z.string().max(200).optional(),
    inputSchema: jsonSchemaShape.optional(),
    outputSchema: jsonSchemaShape.optional(),
    staticInputs: z.record(z.string().max(500), z.unknown()).optional(),
  }),
});

const graphEdgeSchema = z.object({
  id: identifier,
  source: identifier,
  sourceHandle: z.string().max(500),
  target: identifier,
  targetHandle: z.string().max(500),
});

export const toolGraphDocumentSchema = z.object({
  version: z.literal(1),
  name: z.string().max(200),
  nodes: z.array(graphNodeSchema).max(100),
  edges: z.array(graphEdgeSchema).max(300),
  servers: z.array(mcpServerConnectionSchema).max(20),
});

export const runBodySchema = z.object({
  /** Optional: a run started from an unsaved graph has no id to log against. */
  graphId: z.string().uuid().optional(),
  document: toolGraphDocumentSchema,
  input: z.record(z.string().max(200), z.unknown()).optional(),
  secrets: z.record(z.string().max(200), mcpConnectionSecretsSchema).optional(),
});

export type RunBody = z.infer<typeof runBodySchema>;

/** Turn a zod failure into something a user can act on. */
export function formatZodError(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => {
      const path = issue.path.join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}
