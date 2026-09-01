/**
 * `GET /health`
 *
 * Unauthenticated, cheap, and never cached. Render polls it to decide the
 * service is up, `deploy.yml` polls it to confirm which commit is live, and it
 * is safe to point a free uptime monitor at.
 *
 * It reports which optional integrations are configured, but never any value
 * from them — knowing that rate limiting is Redis-backed is useful, knowing the
 * token is not.
 */

import type { FastifyInstance } from 'fastify';

import type { EngineConfig } from '../config';
import { hasSupabase, hasUpstash } from '../config';

export function registerHealthRoute(app: FastifyInstance, config: EngineConfig): void {
  const bootedAt = Date.now();

  app.get('/health', async (_request, reply) => {
    return reply.header('Cache-Control', 'no-store, max-age=0').send({
      status: 'ok',
      service: 'toolgraph-engine',
      commit: config.commit,
      buildTime: config.buildTime || null,
      uptimeSeconds: Math.round((Date.now() - bootedAt) / 1000),
      nodeEnv: config.nodeEnv,
      integrations: {
        rateLimiting: hasUpstash(config) ? 'redis' : 'in-memory',
        supabase: hasSupabase(config),
        sentry: Boolean(config.sentryDsn),
      },
      // Surfaced because an engine running with the guard relaxed is a
      // materially different service, and that should be visible.
      privateNetworkAllowed: config.allowPrivateNetwork,
    });
  });
}
