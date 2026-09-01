/**
 * Process bootstrap for the toolgraph execution engine.
 */

import { loadConfig, ConfigError, hasUpstash } from './config';
import { buildServer } from './server';
import { initSentry } from './lib/sentry';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      // A misconfigured engine must fail loudly and immediately rather than
      // serve traffic in an unsafe state.
      console.error(`\n${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  const sentryEnabled = initSentry(config);
  const app = await buildServer(config);

  app.log.info(
    {
      commit: config.commit,
      rateLimiting: hasUpstash(config) ? 'redis' : 'in-memory',
      sentry: sentryEnabled,
      allowedOrigins: config.allowedOrigins.length,
      privateNetworkAllowed: config.allowPrivateNetwork,
    },
    'starting toolgraph engine',
  );

  if (config.allowPrivateNetwork) {
    app.log.warn(
      'ENGINE_ALLOW_PRIVATE_NETWORK is enabled. The SSRF guard is relaxed and this ' +
        'engine can reach private addresses. This must never be set in a deployment.',
    );
  }

  // Render assigns the port and expects the process to bind 0.0.0.0.
  await app.listen({ port: config.port, host: config.host });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
      process.exit(0);
    } catch {
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  console.error('The engine failed to start:', error);
  process.exit(1);
});
