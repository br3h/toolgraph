/**
 * Fastify app construction, kept separate from the process bootstrap so tests
 * can build an app without binding a port.
 */

import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';

import type { EngineConfig } from './config';
import { MAX_RUN_BODY_BYTES } from './schemas';
import { createRateLimiter, INTROSPECT_LIMIT, RUN_LIMIT } from './lib/rate-limit';
import { registerHealthRoute } from './routes/health';
import { registerIntrospectRoute } from './routes/introspect';
import { registerRunRoute } from './routes/run';
import { captureError } from './lib/sentry';

export async function buildServer(config: EngineConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      // The engine handles per-server credentials in request bodies and
      // Authorization headers. Redaction is not decoration here.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers.apikey',
          'req.body.secrets',
          'req.body.connection.url',
          'body.secrets',
        ],
        remove: true,
      },
      ...(config.nodeEnv === 'development'
        ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
        : {}),
    },
    // A graph carries every tool's full JSON Schema, so run bodies are large.
    // Still bounded: an unbounded body is a trivial memory exhaustion vector.
    bodyLimit: MAX_RUN_BODY_BYTES,
    trustProxy: true,
    disableRequestLogging: false,
  });

  // Never `*`. The engine acts on a user's behalf using their bearer token, so a
  // wildcard origin would let any page on the internet drive it.
  await app.register(cors, {
    origin(origin, callback) {
      // A request with no Origin is not a browser request (curl, a health probe,
      // Render's own checks). CORS does not apply to it.
      if (!origin) return callback(null, true);

      if (config.allowedOrigins.includes(origin)) return callback(null, true);

      // A plain Error here surfaces as a 500 "internal_error", which reads as
      // the engine being broken rather than the origin being refused — and
      // sends anyone debugging it looking in entirely the wrong place. Tagging
      // the status makes the refusal say what it is.
      const refusal = Object.assign(
        new Error(
          `Origin ${origin} is not allowed to call this engine. ` +
            'Add it to ENGINE_ALLOWED_ORIGINS if it is one of yours.',
        ),
        { statusCode: 403 },
      );
      return callback(refusal, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86_400,
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    // The engine serves JSON and event streams, never a document worth framing.
    reply.header('X-Frame-Options', 'DENY');
    return payload;
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = error.statusCode ?? 500;

    if (status >= 500) {
      request.log.error({ err: error }, 'unhandled error');
      captureError(error, { url: request.url, method: request.method });
    }

    // Never hand an internal message to a client; it can leak paths and config.
    return reply.code(status).send({
      error: status >= 500 ? 'internal_error' : 'request_failed',
      message:
        status >= 500 ? 'The engine hit an unexpected error.' : error.message || 'Request failed.',
    });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      error: 'not_found',
      message: `No route for ${request.method} ${request.url}.`,
    }),
  );

  const introspectLimiter = createRateLimiter(config, 'introspect', INTROSPECT_LIMIT);
  const runLimiter = createRateLimiter(config, 'run', RUN_LIMIT);

  registerHealthRoute(app, config);
  registerIntrospectRoute(app, { config, limiter: introspectLimiter });
  registerRunRoute(app, { config, limiter: runLimiter });

  return app;
}
