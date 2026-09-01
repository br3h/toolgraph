/**
 * `POST /introspect`
 *
 * Connects to a user-supplied MCP server and returns its tools' real JSON
 * Schemas. This is the endpoint that makes the engine an SSRF target, so the
 * guard in `@toolgraph/mcp-client` runs before any socket is opened.
 */

import type { FastifyInstance } from 'fastify';
import { introspectServer } from '@toolgraph/mcp-client';

import type { EngineConfig } from '../config';
import { formatZodError, introspectBodySchema } from '../schemas';
import type { RateLimiter } from '../lib/rate-limit';
import { requireUser } from '../lib/auth-hook';

export interface IntrospectRouteDeps {
  config: EngineConfig;
  limiter: RateLimiter;
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
      const message = error instanceof Error ? error.message : 'Could not reach the server.';

      // A refusal by the SSRF guard is the user's mistake to correct, not an
      // engine fault, so it is a 400 with the specific reason rather than a 502.
      const isPolicyRefusal =
        message.includes('blocked') ||
        message.includes('not allowed') ||
        message.includes('local-development');

      request.log.warn(
        { transport: connection.transport, refused: isPolicyRefusal },
        'introspection failed',
      );

      return reply.code(isPolicyRefusal ? 400 : 502).send({
        error: isPolicyRefusal ? 'server_not_allowed' : 'introspection_failed',
        message,
      });
    }
  });
}
