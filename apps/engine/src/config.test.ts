import { describe, expect, it } from 'vitest';

import { ConfigError, hasSupabase, hasUpstash, loadConfig } from './config';

const base = { ENGINE_ALLOWED_ORIGINS: 'https://toolgraph.dev' };

describe('loadConfig', () => {
  it('boots with sensible defaults and no configuration at all', () => {
    const config = loadConfig({});
    expect(config.port).toBe(8787);
    expect(config.host).toBe('0.0.0.0');
    expect(config.nodeEnv).toBe('development');
    expect(config.allowedOrigins).toContain('http://localhost:3000');
    expect(config.allowPrivateNetwork).toBe(false);
  });

  it('parses a comma-separated origin list', () => {
    const config = loadConfig({
      ENGINE_ALLOWED_ORIGINS: 'https://toolgraph.dev, https://www.toolgraph.dev',
    });
    expect(config.allowedOrigins).toEqual(['https://toolgraph.dev', 'https://www.toolgraph.dev']);
  });

  it('refuses a wildcard origin', () => {
    expect(() => loadConfig({ ENGINE_ALLOWED_ORIGINS: '*' })).toThrow(ConfigError);
    expect(() => loadConfig({ ENGINE_ALLOWED_ORIGINS: 'https://a.com,*' })).toThrow(ConfigError);
  });

  it('refuses an origin with no scheme', () => {
    expect(() => loadConfig({ ENGINE_ALLOWED_ORIGINS: 'toolgraph.dev' })).toThrow(ConfigError);
  });

  it('refuses to start with the SSRF guard relaxed in production', () => {
    expect(() =>
      loadConfig({ ...base, NODE_ENV: 'production', ENGINE_ALLOW_PRIVATE_NETWORK: 'true' }),
    ).toThrow(/SSRF/i);
  });

  it('allows the guard to be relaxed outside production', () => {
    const config = loadConfig({
      ...base,
      NODE_ENV: 'development',
      ENGINE_ALLOW_PRIVATE_NETWORK: 'true',
    });
    expect(config.allowPrivateNetwork).toBe(true);
  });

  it('treats only "true" and "1" as enabling the private network flag', () => {
    expect(loadConfig({ ...base, ENGINE_ALLOW_PRIVATE_NETWORK: 'false' }).allowPrivateNetwork).toBe(
      false,
    );
    expect(loadConfig({ ...base, ENGINE_ALLOW_PRIVATE_NETWORK: 'yes' }).allowPrivateNetwork).toBe(
      false,
    );
    expect(loadConfig({ ...base, ENGINE_ALLOW_PRIVATE_NETWORK: '1' }).allowPrivateNetwork).toBe(
      true,
    );
  });

  it('rejects a port outside the valid range', () => {
    expect(() => loadConfig({ ...base, PORT: '0' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, PORT: '99999' })).toThrow(ConfigError);
  });

  it('treats an empty optional value as absent rather than invalid', () => {
    const config = loadConfig({ ...base, SENTRY_DSN_BACKEND: '', UPSTASH_REDIS_REST_URL: '' });
    expect(config.sentryDsn).toBeUndefined();
    expect(hasUpstash(config)).toBe(false);
  });

  it('reports which integrations are configured', () => {
    const none = loadConfig(base);
    expect(hasUpstash(none)).toBe(false);
    expect(hasSupabase(none)).toBe(false);

    const wired = loadConfig({
      ...base,
      UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'token-value',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SECRET_KEY: 'secret-value',
    });
    expect(hasUpstash(wired)).toBe(true);
    expect(hasSupabase(wired)).toBe(true);
  });
});
