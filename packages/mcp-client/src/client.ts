/**
 * The MCP client toolgraph actually dials servers with.
 *
 * The SDK's `Client` is transport-agnostic and perfectly happy to be pointed at
 * anything; this module is the layer that decides what "anything" is allowed to
 * mean when the URL came from a form on the public internet. Three rules shape
 * everything below:
 *
 *  - The SSRF guard runs to completion *before* a transport object exists. A
 *    transport that is constructed and then thrown away may already have opened
 *    a socket or spawned a process, so "construct then validate" is not a
 *    reordering — it is a hole.
 *  - `stdio` spawns a process. That is a local-development convenience and is
 *    refused outright unless the policy has explicitly opted into private
 *    network access.
 *  - Every await is bounded. A server that accepts a connection and then says
 *    nothing must not be able to pin a request handler open indefinitely.
 *
 * Secrets (`headers`, `env`) are handed straight to the transport and never
 * appear in a log line, an error message or a thrown object.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type {
  JsonSchema,
  McpConnectionSecrets,
  McpServerConnection,
  McpToolDescriptor,
} from '@toolgraph/schema-core';

import { createGuardedFetch, requireUrlAllowed } from './guarded-fetch';
import type { DnsLookupFn, SsrfPolicy } from './ssrf';
import {
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_TOOL_CALL_TIMEOUT_MS,
  DEFAULT_TOTAL_TIMEOUT_MS,
  withTimeout,
} from './timeouts';

/** Identity this client reports to every server during `initialize`. */
export const MCP_CLIENT_NAME = 'toolgraph';
export const MCP_CLIENT_VERSION = '0.1.0';

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

export type McpClientErrorCode =
  /** The connection asks for stdio but the policy forbids spawning processes. */
  | 'stdio_not_allowed'
  /** An `http`/`sse` connection carries no URL. */
  | 'missing_url'
  /** A `stdio` connection carries no command. */
  | 'missing_command'
  /** The server answered `tools/call` with `isError: true`. */
  | 'tool_call_failed';

/**
 * A refusal or failure that originates in this client rather than in the
 * transport. Carries a machine-readable code so the API layer can map it to a
 * status without matching on prose.
 */
export class McpClientError extends Error {
  readonly code: McpClientErrorCode;

  constructor(code: McpClientErrorCode, message: string) {
    super(message);
    this.name = 'McpClientError';
    this.code = code;
  }
}

/* -------------------------------------------------------------------------- */
/* Public surface                                                              */
/* -------------------------------------------------------------------------- */

export interface ConnectOptions {
  connection: McpServerConnection;
  secrets?: McpConnectionSecrets;
  policy: SsrfPolicy;
  /** Ceiling for the transport handshake plus `initialize`. */
  connectTimeoutMs?: number;
  /** Ceiling for a whole introspection round trip, and for one `tools/list`. */
  totalTimeoutMs?: number;
  /** Test seam: replaces the DNS resolver the SSRF guard uses. */
  lookup?: DnsLookupFn;
  /** Test seam: replaces the `fetch` the HTTP and SSE transports are given. */
  fetchImpl?: typeof fetch;
}

export interface ConnectedMcpClient {
  listTools(): Promise<McpToolDescriptor[]>;
  callTool(name: string, args: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
  close(): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* Tool descriptors                                                            */
/* -------------------------------------------------------------------------- */

type SdkTool = Awaited<ReturnType<Client['listTools']>>['tools'][number];

/** A schema-shaped value, or `null` when the server sent something else. */
function asSchema(value: unknown): JsonSchema | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as JsonSchema;
}

/**
 * The MCP spec requires `inputSchema`, but servers in the wild omit it or send
 * `{}` for a no-argument tool. Downstream code walks the schema to render input
 * fields, so an unusable value becomes the empty object schema rather than
 * something every consumer has to special-case.
 */
function normalizeInputSchema(value: unknown): JsonSchema {
  const schema = asSchema(value);
  if (schema === null || Object.keys(schema).length === 0) {
    return { type: 'object', properties: {} };
  }
  // An object schema with no `properties` is legal but leaves the field lister
  // nothing to walk, so it gets the empty map it implies.
  if (schema.type === 'object' && schema.properties === undefined) {
    return { ...schema, properties: {} };
  }
  return schema;
}

function toDescriptor(serverId: string, tool: SdkTool): McpToolDescriptor {
  const descriptor: McpToolDescriptor = {
    serverId,
    name: tool.name,
    inputSchema: normalizeInputSchema(tool.inputSchema),
  };

  const title = tool.title ?? tool.annotations?.title;
  if (typeof title === 'string' && title !== '') descriptor.title = title;
  if (typeof tool.description === 'string' && tool.description !== '') {
    descriptor.description = tool.description;
  }

  const output = asSchema(tool.outputSchema);
  if (output !== null && Object.keys(output).length > 0) descriptor.outputSchema = output;

  return descriptor;
}

/* -------------------------------------------------------------------------- */
/* Transport construction                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Builds the transport for a connection, guard first.
 *
 * Nothing in here may construct a transport before the URL has been cleared:
 * see the module comment.
 */
async function createTransport(opts: ConnectOptions): Promise<Transport> {
  const { connection, policy, secrets } = opts;

  if (connection.transport === 'stdio') {
    if (!policy.allowPrivateNetwork) {
      throw new McpClientError(
        'stdio_not_allowed',
        `Server "${connection.name}" uses the stdio transport, which starts a program on the ` +
          'machine running toolgraph. Stdio servers are a local-development feature and cannot ' +
          'be used from a hosted deployment; connect over http or sse instead.',
      );
    }

    const command = connection.command?.trim() ?? '';
    if (command === '') {
      throw new McpClientError(
        'missing_command',
        `Server "${connection.name}" uses the stdio transport but names no command to run.`,
      );
    }

    return new StdioClientTransport({
      command,
      args: connection.args ?? [],
      // Secrets are layered over the SDK's allow-list of inherited variables so
      // the child gets a PATH without inheriting the whole hosting environment.
      env: { ...getDefaultEnvironment(), ...(secrets?.env ?? {}) },
    });
  }

  const rawUrl = connection.url?.trim() ?? '';
  if (rawUrl === '') {
    throw new McpClientError(
      'missing_url',
      `Server "${connection.name}" uses the ${connection.transport} transport but has no URL.`,
    );
  }

  // Throws before any transport exists. Order is load-bearing.
  const url = await requireUrlAllowed(rawUrl, policy, opts.lookup);

  // The guard runs again on every request and every redirect hop, which is what
  // closes the window between this check and the socket actually being opened.
  const guardedFetch = createGuardedFetch({
    policy,
    ...(opts.lookup ? { lookup: opts.lookup } : {}),
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  });

  const requestInit: RequestInit = {};
  const headers = secrets?.headers;
  if (headers && Object.keys(headers).length > 0) requestInit.headers = { ...headers };

  if (connection.transport === 'sse') {
    return new SSEClientTransport(url, { requestInit, fetch: guardedFetch });
  }
  return new StreamableHTTPClientTransport(url, { requestInit, fetch: guardedFetch });
}

/* -------------------------------------------------------------------------- */
/* Connecting                                                                  */
/* -------------------------------------------------------------------------- */

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Minimal view of the SDK client, so the shutdown path is easy to reason about. */
interface ClosableClient {
  close(): Promise<void>;
}

/**
 * Tears both halves down and swallows the outcome.
 *
 * `Client.close()` already closes its transport, but a handshake that failed
 * part way through may have left the client without one, so the transport is
 * closed directly as well. Both are idempotent; neither failure is actionable.
 */
async function closeQuietly(client: ClosableClient, transport: Transport): Promise<void> {
  try {
    await client.close();
  } catch {
    // The connection is being abandoned either way.
  }
  try {
    await transport.close();
  } catch {
    // Same.
  }
}

export async function connectMcpServer(opts: ConnectOptions): Promise<ConnectedMcpClient> {
  const { connection } = opts;
  const connectTimeoutMs = positiveOr(opts.connectTimeoutMs, DEFAULT_CONNECT_TIMEOUT_MS);
  const listTimeoutMs = positiveOr(opts.totalTimeoutMs, DEFAULT_TOTAL_TIMEOUT_MS);

  const transport = await createTransport(opts);
  const client = new Client(
    { name: MCP_CLIENT_NAME, version: MCP_CLIENT_VERSION },
    { capabilities: {} },
  );

  try {
    await withTimeout(
      client.connect(transport),
      connectTimeoutMs,
      `a handshake with "${connection.name}"`,
    );
  } catch (error) {
    // Losing the race does not cancel the handshake, so the socket or the child
    // process outlives the failure unless it is torn down here.
    await closeQuietly(client, transport);
    throw error;
  }

  let closing: Promise<void> | undefined;

  return {
    async listTools() {
      const result = await withTimeout(
        client.listTools(),
        listTimeoutMs,
        `the tool list from "${connection.name}"`,
      );
      return result.tools.map((tool) => toDescriptor(connection.id, tool));
    },

    async callTool(name, args, timeoutMs) {
      const ms = positiveOr(timeoutMs, DEFAULT_TOOL_CALL_TIMEOUT_MS);
      const result = await withTimeout(
        // The SDK's own deadline cancels the in-flight request; the outer race
        // is what guarantees this call returns even if the SDK's timer does not.
        client.callTool({ name, arguments: args }, undefined, { timeout: ms }),
        ms,
        `a call to "${name}" on "${connection.name}"`,
      );

      if (result.isError === true) {
        throw new McpClientError(
          'tool_call_failed',
          `Tool "${name}" on "${connection.name}" reported an error: ${describeContent(result.content)}`,
        );
      }

      // `structuredContent` is the typed result when a tool declares an output
      // schema; the content blocks are the untyped fallback. Both are inert
      // data — nothing here interprets or executes what the server sent.
      if (result.structuredContent !== undefined) return result.structuredContent;
      return result.content;
    },

    close() {
      // Memoised so a second call joins the first instead of closing twice.
      closing ??= closeQuietly(client, transport);
      return closing;
    },
  };
}

/** Flattens text blocks into one line for an error message. Never evaluated. */
function describeContent(content: unknown): string {
  if (!Array.isArray(content)) return 'no details were given';
  const texts: string[] = [];
  for (const block of content) {
    if (typeof block === 'object' && block !== null && 'text' in block) {
      const { text } = block as { text: unknown };
      if (typeof text === 'string' && text !== '') texts.push(text);
    }
  }
  return texts.length > 0 ? texts.join(' ') : 'no details were given';
}

/**
 * Connects, lists the tools and disconnects, all inside one deadline.
 *
 * The handshake budget is clamped to the total so a slow connect cannot eat the
 * whole allowance and leave a live client behind when the outer timer fires.
 */
export async function introspectServer(opts: ConnectOptions): Promise<McpToolDescriptor[]> {
  const totalTimeoutMs = positiveOr(opts.totalTimeoutMs, DEFAULT_TOTAL_TIMEOUT_MS);
  const connectTimeoutMs = Math.min(
    positiveOr(opts.connectTimeoutMs, DEFAULT_CONNECT_TIMEOUT_MS),
    totalTimeoutMs,
  );
  const deadline = Date.now() + totalTimeoutMs;

  const client = await connectMcpServer({ ...opts, connectTimeoutMs, totalTimeoutMs });
  try {
    return await withTimeout(
      client.listTools(),
      Math.max(deadline - Date.now(), 1),
      `the tool list from "${opts.connection.name}"`,
    );
  } finally {
    await client.close();
  }
}
