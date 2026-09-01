/**
 * Caller identification.
 *
 * Both real endpoints are per-user rate limited and both write to a user's
 * data, so both need to know who is calling. The token is verified against
 * Supabase rather than decoded locally — see `lib/supabase.ts` for why.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';

import type { EngineConfig } from '../config';
import { hasSupabase } from '../config';
import { bearerToken, verifyAccessToken, type AuthenticatedUser } from './supabase';

/**
 * Resolve the caller, or send the appropriate error and return null.
 *
 * Returning null rather than throwing keeps the happy path in the route
 * readable, and the caller returns the already-sent reply.
 */
export async function requireUser(
  request: FastifyRequest,
  reply: FastifyReply,
  config: EngineConfig,
): Promise<AuthenticatedUser | null> {
  const token = bearerToken(request.headers.authorization);

  if (!token) {
    void reply.code(401).send({
      error: 'unauthenticated',
      message: 'This endpoint needs a Supabase access token in the Authorization header.',
    });
    return null;
  }

  // Without Supabase configured the engine cannot verify anyone. It must not
  // fall through to treating every caller as trusted; local development gets a
  // stable synthetic identity instead, and only outside production.
  if (!hasSupabase(config)) {
    if (config.nodeEnv === 'production') {
      void reply.code(503).send({
        error: 'auth_unavailable',
        message: 'This engine has no Supabase configuration, so it cannot verify callers.',
      });
      return null;
    }
    return { id: 'local-development-user' };
  }

  const user = await verifyAccessToken(config, token);
  if (!user) {
    void reply.code(401).send({
      error: 'unauthenticated',
      message: 'That access token is not valid, or it has expired.',
    });
    return null;
  }

  return user;
}
