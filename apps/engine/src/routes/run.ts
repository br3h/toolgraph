/**
 * `POST /run` — execute a graph, streaming progress back over SSE.
 *
 * Why SSE on the same request, rather than a WebSocket:
 *
 * The engine runs on a plan that sleeps after fifteen minutes of inactivity and
 * drops open connections when it does. A design that opened a socket, then
 * expected it to still be there when the run produced its first result, would
 * fail exactly when a user came back after a break. Streaming on the request
 * that started the run removes that failure mode entirely — there is only ever
 * one connection, and if it dies the run dies with it, visibly.
 */

import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { connectMcpServer, type ConnectedMcpClient } from '@toolgraph/mcp-client';
import type {
  ExecutionEvent,
  McpConnectionSecrets,
  McpServerConnection,
} from '@toolgraph/schema-core';

import type { EngineConfig } from '../config';
import { formatZodError, runBodySchema } from '../schemas';
import type { RateLimiter } from '../lib/rate-limit';
import { requireUser } from '../lib/auth-hook';
import { executeGraph, type ToolInvoker } from '../lib/executor';
import { recordExecutionRun } from '../lib/supabase';

/** A comment line every 15s keeps proxies from closing an idle stream. */
const KEEPALIVE_MS = 15_000;

export interface RunRouteDeps {
  config: EngineConfig;
  limiter: RateLimiter;
}

/**
 * Opens at most one connection per server and reuses it across steps, then
 * closes everything once. Reconnecting per step would multiply latency on a
 * plan where the round trip already dominates.
 */
function createInvoker(config: EngineConfig): ToolInvoker {
  const clients = new Map<string, ConnectedMcpClient>();

  return {
    async call(
      connection: McpServerConnection,
      secrets: McpConnectionSecrets | undefined,
      toolName: string,
      args: Record<string, unknown>,
    ): Promise<unknown> {
      let client = clients.get(connection.id);
      if (!client) {
        client = await connectMcpServer({
          connection,
          ...(secrets ? { secrets } : {}),
          policy: { allowPrivateNetwork: config.allowPrivateNetwork },
        });
        clients.set(connection.id, client);
      }
      return client.callTool(toolName, args);
    },

    async dispose(): Promise<void> {
      await Promise.allSettled([...clients.values()].map((client) => client.close()));
      clients.clear();
    },
  };
}

export function registerRunRoute(app: FastifyInstance, { config, limiter }: RunRouteDeps): void {
  app.post('/run', async (request, reply) => {
    const user = await requireUser(request, reply, config);
    if (!user) return reply;

    const verdict = await limiter.check(`run:${user.id}`);
    if (!verdict.allowed) {
      return reply
        .code(429)
        .header('Retry-After', Math.max(1, Math.ceil((verdict.reset - Date.now()) / 1000)))
        .send({
          error: 'rate_limited',
          message: `You can start ${verdict.limit} runs a minute. Try again shortly.`,
        });
    }

    const parsed = runBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: formatZodError(parsed.error),
      });
    }

    const { document, input, secrets, graphId } = parsed.data;
    const runId = randomUUID();
    const startedAt = new Date().toISOString();

    // Take over the raw socket: Fastify's serialiser cannot express a stream.
    reply.hijack();
    const raw = reply.raw;

    raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Some proxies buffer streamed responses until they are complete, which
      // would defeat the whole point of streaming progress.
      'X-Accel-Buffering': 'no',
    });

    const send = (event: ExecutionEvent) => {
      if (raw.writableEnded) return;
      raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };

    const keepalive = setInterval(() => {
      if (raw.writableEnded) return;
      raw.write(`: keepalive\n\n`);
    }, KEEPALIVE_MS);

    // If the browser navigates away, stop doing work for a client that has gone.
    const abort = new AbortController();
    request.raw.on('close', () => abort.abort());

    const invoker = createInvoker(config);
    let status: 'succeeded' | 'failed' = 'failed';
    let stepCount = 0;
    let errorSummary: string | undefined;

    try {
      const result = await executeGraph({
        runId,
        document: document as Parameters<typeof executeGraph>[0]['document'],
        ...(input ? { input } : {}),
        ...(secrets ? { secrets } : {}),
        invoker,
        emit: send,
        signal: abort.signal,
      });

      status = result.status;
      stepCount = result.steps.length;
      if (result.status === 'failed') {
        errorSummary = result.steps.find((step) => step.status === 'failed')?.error;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The run failed.';
      errorSummary = message;
      request.log.error({ runId, err: error }, 'run failed');
      send({ type: 'run:error', runId, message, at: new Date().toISOString() });
    } finally {
      clearInterval(keepalive);

      // Logging the run must never fail the run, so this is best-effort and its
      // failure is logged rather than surfaced.
      if (graphId) {
        const logged = await recordExecutionRun(config, {
          graphId,
          owner: user.id,
          status,
          startedAt,
          finishedAt: new Date().toISOString(),
          stepCount,
          ...(errorSummary ? { errorSummary } : {}),
        });
        if (!logged.ok) {
          request.log.warn({ runId, reason: logged.error }, 'could not record execution run');
        }
      }

      if (!raw.writableEnded) raw.end();
    }

    return reply;
  });
}
