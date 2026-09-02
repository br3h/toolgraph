/**
 * `POST /api/export` — generate a standalone bundle for a graph.
 *
 * Runs on the Node runtime because `@toolgraph/codegen` depends on
 * `json-schema-to-typescript`, which touches the filesystem. Calling it from a
 * client component would not merely fail at runtime — it would break the build.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { generate } from '@toolgraph/codegen';
import type { McpToolDescriptor, ToolGraphDocument } from '@toolgraph/schema-core';

import { getCurrentUser } from '@/lib/supabase/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { publicEnv } from '@/lib/public-env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A graph carries every tool's full schema, so bodies are large but bounded. */
const MAX_BODY_BYTES = 4_194_304; // 4 MB

/**
 * Third-party JSON Schemas are accepted structurally rather than validated as a
 * dialect: MCP servers legitimately emit keywords we do not model, and
 * rejecting them would break real servers. The generators are defensive about
 * what they read. This mirrors `apps/engine/src/schemas.ts` — keep the two in
 * step.
 */
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

const toolSchema = z.object({
  serverId: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  title: z.string().max(200).optional(),
  description: z.string().max(4000).optional(),
  inputSchema: jsonSchemaShape,
  outputSchema: jsonSchemaShape.optional(),
});

const bodySchema = z.object({
  target: z.enum(['typescript', 'python']),
  document: z.object({
    version: z.literal(1),
    name: z.string().max(200),
    nodes: z.array(nodeSchema).max(100),
    edges: z.array(edgeSchema).max(300),
    servers: z.array(serverSchema).max(20),
  }),
  tools: z.array(toolSchema).max(400),
});

/**
 * Explicit same-origin check.
 *
 * Route handlers get none of the protection server actions have, so a
 * state-changing or resource-intensive POST needs its own. Code generation is
 * expensive enough to be worth protecting from cross-site invocation.
 */
function originAllowed(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return process.env.NODE_ENV !== 'production';

  const allowed = new Set<string>();
  try {
    allowed.add(new URL(publicEnv.siteUrl).origin);
  } catch {
    /* a malformed configured URL contributes nothing */
  }

  const host = request.headers.get('host');
  if (host) {
    allowed.add(`https://${host}`);
    if (process.env.NODE_ENV !== 'production') allowed.add(`http://${host}`);
  }
  if (process.env.VERCEL_URL) allowed.add(`https://${process.env.VERCEL_URL}`);

  return allowed.has(origin);
}

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' } as const;

export async function POST(request: NextRequest) {
  if (!originAllowed(request)) {
    return NextResponse.json(
      { error: 'forbidden', message: 'This request could not be verified.' },
      { status: 403, headers: NO_STORE },
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: 'unauthenticated', message: 'Sign in to export a graph.' },
      { status: 401, headers: NO_STORE },
    );
  }

  /*
   * This endpoint previously had no rate limit at all, which made it the most
   * expensive thing an authenticated user could ask this app to do without
   * bound: `generate()` runs `json-schema-to-typescript` synchronously over
   * every schema in the graph, on a shared serverless CPU, for a body of up to
   * 4 MB. A loop over it is a denial of service against every other request on
   * the instance.
   *
   * Placed before the body is read, so a refused caller does not get to spend
   * memory on the upload either.
   */
  const verdict = await checkRateLimit('export', `user:${user.id}`);
  if (!verdict.allowed) {
    return rateLimitResponse(
      verdict,
      'You have exported a lot of graphs in the last minute. Try again shortly — nothing has been lost.',
    );
  }

  // Cheap rejection before the body is read into memory at all.
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: 'payload_too_large', message: 'That graph is too large to export.' },
      { status: 413, headers: NO_STORE },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'invalid_request', message: 'The request body was not valid JSON.' },
      { status: 400, headers: NO_STORE },
    );
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 5)
      .map((issue) => {
        const path = issue.path.join('.');
        return path ? `${path}: ${issue.message}` : issue.message;
      })
      .join('; ');

    return NextResponse.json(
      { error: 'invalid_request', message: detail },
      { status: 400, headers: NO_STORE },
    );
  }

  const { target, document, tools } = parsed.data;

  try {
    const result = await generate(
      target,
      document as ToolGraphDocument,
      tools as McpToolDescriptor[],
    );

    return NextResponse.json(
      { target: result.target, files: result.files, warnings: result.warnings },
      { status: 200, headers: NO_STORE },
    );
  } catch (error) {
    // A cyclic graph, or a node naming a tool that is not present, throws here.
    // Both are the user's graph being wrong, not the server failing.
    return NextResponse.json(
      {
        error: 'generation_failed',
        message:
          error instanceof Error ? error.message : 'That graph could not be turned into code.',
      },
      { status: 400, headers: NO_STORE },
    );
  }
}
