/**
 * `POST /introspect`
 *
 * Connects to a user-supplied MCP server and returns its tools' real JSON
 * Schemas. This is the endpoint that makes the engine an SSRF target, so the
 * guard in `@toolgraph/mcp-client` runs before any socket is opened.
 */

import type { FastifyInstance } from 'fastify';
import { McpClientError, SsrfBlockedError, introspectServer } from '@toolgraph/mcp-client';

import type { EngineConfig } from '../config';
import { formatZodError, introspectBodySchema } from '../schemas';
import type { RateLimiter } from '../lib/rate-limit';
import { requireUser } from '../lib/auth-hook';

export interface IntrospectRouteDeps {
  config: EngineConfig;
  limiter: RateLimiter;
}

/** Collapse a sprawling upstream error into one readable line. */
function summarise(message: string): string {
  const firstLine = message.split('\n')[0] ?? message;
  // Strip any HTML a failing server folded into its response body.
  const withoutMarkup = firstLine
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return withoutMarkup.length > 200 ? `${withoutMarkup.slice(0, 200)}…` : withoutMarkup;
}

export function registerIntrospectRoute(
  app: FastifyInstance,
  { config, limiter }: IntrospectRouteDeps,
): void {
  app.post('/introspect', async (request, reply) => {
    const user = await requireUser(request, reply, config);
    if (!user) return reply;

    const verdict = await limiter.check(`introspect:${user.id}`);
    if (!verdict.allowed) {
      return reply
        .code(429)
        .header('Retry-After', Math.max(1, Math.ceil((verdict.reset - Date.now()) / 1000)))
        .send({
          error: 'rate_limited',
          message: `You can introspect ${verdict.limit} servers a minute. Try again shortly.`,
        });
    }

    const parsed = introspectBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: formatZodError(parsed.error),
      });
    }

    const { connection, secrets } = parsed.data;

    try {
      const tools = await introspectServer({
        connection,
        ...(secrets ? { secrets } : {}),
        policy: { allowPrivateNetwork: config.allowPrivateNetwork },
      });

      return reply.send({ tools, serverId: connection.id, toolCount: tools.length });
    } catch (error) {
      /*
       * Classify by error TYPE, not by matching words in the message.
       *
       * This previously tested the message for "blocked" / "not allowed", which
       * missed the guard's actual wording ("...is a literal address in
       * 169.254.0.0/16 (link-local, cloud metadata)"). The guard still refused
       * the connection, but the caller was told the engine had failed — a 502 —
       * when in fact their URL was rejected on purpose. Both packages already
       * export typed errors, so the classification uses those instead and
       * cannot drift when a message is reworded.
       */
      const isPolicyRefusal =
        error instanceof SsrfBlockedError ||
        (error instanceof McpClientError &&
          (error.code === 'stdio_not_allowed' ||
            error.code === 'missing_url' ||
            error.code === 'missing_command'));

      const rawMessage = error instanceof Error ? error.message : 'Could not reach the server.';

      // A failing server can answer with an entire HTML page, and the SDK folds
      // that body into its error. Echoing it back would hand the client a wall
      // of someone else's markup, so it is truncated to something readable.
      const message = isPolicyRefusal ? rawMessage : summarise(rawMessage);

      request.log.warn(
        {
          transport: connection.transport,
          refused: isPolicyRefusal,
          code: error instanceof SsrfBlockedError ? error.code : undefined,
        },
        'introspection failed',
      );

      return reply.code(isPolicyRefusal ? 400 : 502).send({
        error: isPolicyRefusal ? 'server_not_allowed' : 'introspection_failed',
        message,
      });
    }
  });
}
