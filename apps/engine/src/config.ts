/**
 * Engine configuration, parsed and validated once at boot.
 *
 * Every value the engine reads from the environment passes through here, so
 * there is exactly one place to look for what it needs and exactly one place
 * that can refuse to start.
 */

import { z } from 'zod';

/**
 * A comma-separated origin list. Rejected outright if it contains `*` — the
 * engine talks to a browser holding a user's session, so a wildcard origin
 * would let any site on the internet drive it with that session.
 */
const originList = z
  .string()
  .min(1)
  .transform((raw) =>
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  .refine((list) => list.length > 0, { message: 'at least one origin is required' })
  .refine((list) => !list.includes('*'), {
    message: 'ENGINE_ALLOWED_ORIGINS must never be "*"',
  })
  .refine((list) => list.every((o) => /^https?:\/\//.test(o)), {
    message: 'every origin must include a scheme, e.g. https://toolgraph.dev',
  });

const booleanish = z
  .string()
  .optional()
  .transform((raw) => raw === 'true' || raw === '1');

const configSchema = z.object({
  nodeEnv: z.enum(['development', 'test', 'production']).default('development'),
  port: z.coerce.number().int().min(1).max(65535).default(8787),
  host: z.string().default('0.0.0.0'),
  allowedOrigins: originList,
  allowPrivateNetwork: booleanish,
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Optional integrations. The engine runs without any of them, which is what
  // lets a contributor start it from .env.example alone.
  sentryDsn: z
    .string()
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  upstashUrl: z
    .string()
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  upstashToken: z
    .string()
    .min(1)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  supabaseUrl: z
    .string()
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  supabaseSecretKey: z
    .string()
    .min(1)
    .optional()
    .or(z.literal('').transform(() => undefined)),

  commit: z.string().default('unknown'),
  buildTime: z.string().default(''),
});

export type EngineConfig = z.infer<typeof configSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): EngineConfig {
  const parsed = configSchema.safeParse({
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    host: env.HOST,
    // Defaulting to localhost keeps `pnpm dev` working with no configuration,
    // while a deployed engine must set this explicitly.
    allowedOrigins: env.ENGINE_ALLOWED_ORIGINS ?? 'http://localhost:3000,http://127.0.0.1:3000',
    allowPrivateNetwork: env.ENGINE_ALLOW_PRIVATE_NETWORK,
    logLevel: env.LOG_LEVEL,
    sentryDsn: env.SENTRY_DSN_BACKEND,
    upstashUrl: env.UPSTASH_REDIS_REST_URL,
    upstashToken: env.UPSTASH_REDIS_REST_TOKEN,
    supabaseUrl: env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseSecretKey: env.SUPABASE_SECRET_KEY,
    commit: env.RENDER_GIT_COMMIT ?? env.GIT_COMMIT ?? env.VERCEL_GIT_COMMIT_SHA,
    buildTime: env.BUILD_TIME,
  });

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new ConfigError(`Invalid engine configuration:\n${detail}`);
  }

  const config = parsed.data;

  // The single most dangerous misconfiguration this service has. The SSRF guard
  // is the only thing standing between a user-supplied URL and the private
  // network the engine sits in, and this flag turns it off. Refusing to boot is
  // the correct response — a running-but-unguarded engine is worse than one
  // that visibly failed to start.
  if (config.allowPrivateNetwork && config.nodeEnv === 'production') {
    throw new ConfigError(
      'ENGINE_ALLOW_PRIVATE_NETWORK is enabled while NODE_ENV=production. ' +
        'That disables the SSRF guard, which would let any user reach this ' +
        "service's private network. Refusing to start.",
    );
  }

  return config;
}

/** Whether rate limiting can be enforced, or must fall back to in-memory. */
export function hasUpstash(config: EngineConfig): boolean {
  return Boolean(config.upstashUrl && config.upstashToken);
}

/** Whether the engine can verify a caller's identity and log runs. */
export function hasSupabase(config: EngineConfig): boolean {
  return Boolean(config.supabaseUrl && config.supabaseSecretKey);
}
