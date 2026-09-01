/**
 * Validation and defaults for the persisted graph document.
 *
 * `graphs.graph_json` is a jsonb column, so what comes back from the database is
 * whatever was written — including by an older version of the app. Everything
 * read from it passes through here, so a malformed or outdated document
 * degrades to an empty canvas rather than crashing the editor.
 */

import { z } from 'zod';
import type { ToolGraphDocument } from '@toolgraph/schema-core';

const jsonSchemaShape = z.record(z.string(), z.unknown());

const serverSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(120),
  transport: z.enum(['stdio', 'sse', 'http']),
  url: z.string().max(2048).optional(),
  command: z.string().max(500).optional(),
  args: z.array(z.string().max(500)).max(50).optional(),
});

const nodeSchema = z.object({
  id: z.string().min(1).max(200),
  kind: z.enum(['mcpTool', 'input', 'output']),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }),
  data: z.object({
    label: z.string().max(200),
    serverId: z.string().max(200).optional(),
    toolName: z.string().max(200).optional(),
    inputSchema: jsonSchemaShape.optional(),
    outputSchema: jsonSchemaShape.optional(),
    staticInputs: z.record(z.string().max(500), z.unknown()).optional(),
  }),
});

const edgeSchema = z.object({
  id: z.string().min(1).max(200),
  source: z.string().min(1).max(200),
  sourceHandle: z.string().max(500),
  target: z.string().min(1).max(200),
  targetHandle: z.string().max(500),
});

export const graphDocumentSchema = z.object({
  version: z.literal(1),
  name: z.string().max(200),
  nodes: z.array(nodeSchema).max(100),
  edges: z.array(edgeSchema).max(300),
  servers: z.array(serverSchema).max(20),
});

export function emptyDocument(name = 'Untitled graph'): ToolGraphDocument {
  return { version: 1, name, nodes: [], edges: [], servers: [] };
}

/**
 * Coerce whatever is in the column into a usable document.
 *
 * Never throws: a user whose saved graph cannot be parsed should still be able
 * to open the editor and start again, not be locked out by a 500.
 */
export function parseDocument(raw: unknown, fallbackName = 'Untitled graph'): ToolGraphDocument {
  const parsed = graphDocumentSchema.safeParse(raw);
  if (parsed.success) return parsed.data as ToolGraphDocument;
  return emptyDocument(fallbackName);
}

/** Whether the stored value round-trips cleanly, for surfacing a warning. */
export function isValidDocument(raw: unknown): boolean {
  return graphDocumentSchema.safeParse(raw).success;
}
