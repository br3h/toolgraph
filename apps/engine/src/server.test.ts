import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { loadConfig } from './config';
import { buildServer } from './server';

/**
 * These use `app.inject()`, so no port is bound and nothing leaves the process.
 *
 * The CORS cases exist because a misconfigured origin list broke production
 * once: the site is served from `www` while the allowlist held only the apex,
 * and the refusal surfaced as a 500 "internal_error" — which reads as the
 * engine being broken rather than the origin being refused, and sent debugging
 * off in the wrong direction entirely.
 */
describe('the engine server', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer(
      loadConfig({
        NODE_ENV: 'test',
        ENGINE_ALLOWED_ORIGINS: 'https://toolgraph.dev,https://www.toolgraph.dev',
        LOG_LEVEL: 'fatal',
      }),
    );
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('health', () => {
    it('answers unauthenticated with build info', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);

      const body = res.json() as Record<string, unknown>;
      expect(body.status).toBe('ok');
      expect(body.service).toBe('toolgraph-engine');
      expect(body).toHaveProperty('commit');
    });

    it('is never cached, so deploy checks read the live commit', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.headers['cache-control']).toContain('no-store');
    });

    it('reports that the SSRF guard is not relaxed', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect((res.json() as { privateNetworkAllowed: boolean }).privateNetworkAllowed).toBe(false);
    });
  });

  describe('CORS', () => {
    it('accepts every configured origin, apex and www alike', async () => {
      for (const origin of ['https://toolgraph.dev', 'https://www.toolgraph.dev']) {
        const res = await app.inject({
          method: 'OPTIONS',
          url: '/introspect',
          headers: {
            origin,
            'access-control-request-method': 'POST',
            'access-control-request-headers': 'authorization,content-type',
          },
        });
        expect(res.statusCode, `${origin} should be allowed`).toBe(204);
        expect(res.headers['access-control-allow-origin']).toBe(origin);
      }
    });

    it('refuses an unknown origin with 403, not 500', async () => {
      const res = await app.inject({
        method: 'OPTIONS',
        url: '/introspect',
        headers: {
          origin: 'https://evil.example',
          'access-control-request-method': 'POST',
        },
      });

      // 500 would say the engine failed. It did not: the origin was refused.
      expect(res.statusCode).toBe(403);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();

      // The CORS plugin short-circuits preflight before the custom error
      // handler runs, so the body is Fastify's default shape. What matters is
      // that the status is a refusal and the message names the origin, so
      // whoever is debugging it knows exactly which value to fix.
      const body = res.json() as { message?: string };
      expect(body.message).toContain('evil.example');
      expect(body.message).toContain('ENGINE_ALLOWED_ORIGINS');
    });

    it('allows a request with no Origin at all', async () => {
      // curl, a health probe and Render's own checks send none, and CORS simply
      // does not apply to them.
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('authentication', () => {
    it('rejects /introspect without a bearer token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/introspect',
        payload: {
          connection: { id: 'a', name: 'a', transport: 'http', url: 'https://example.com/mcp' },
        },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'unauthenticated' });
    });

    it('rejects /run without a bearer token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/run',
        payload: { document: { version: 1, name: 'x', nodes: [], edges: [], servers: [] } },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('unknown routes', () => {
    it('returns a 404 that names the method and path', async () => {
      const res = await app.inject({ method: 'GET', url: '/nope' });
      expect(res.statusCode).toBe(404);
      expect((res.json() as { message: string }).message).toContain('/nope');
    });
  });

  describe('security headers', () => {
    it('sets nosniff and frame-deny on every response', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
    });
  });
});
