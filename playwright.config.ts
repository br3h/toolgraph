import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright runs against one of two targets:
 *
 *   - locally and in CI, against `pnpm dev` plus a local Supabase stack, using
 *     the CLI's fixed local development keys. No live secret is involved, which
 *     is what lets CI run this on a fork PR.
 *   - after a deploy, against the real URLs, by setting `E2E_BASE_URL`. In that
 *     mode Playwright starts no server of its own.
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
const isRemote = Boolean(process.env.E2E_BASE_URL);
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },

  reporter: isCI
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list']],

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    // The engine's cold start on Render's free plan can take ~50s; the smoke
    // test tolerates it rather than flaking.
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  // Against a deployed URL there is nothing to start.
  ...(isRemote
    ? {}
    : {
        /**
         * CI runs the PRODUCTION build, not the dev server.
         *
         * The dev server legitimately relaxes the CSP — Next's Fast Refresh
         * compiles at runtime and genuinely needs `unsafe-eval`. Testing against
         * it would make the security-header assertions meaningless, since they
         * would be checking a policy that never ships. CI builds both apps in an
         * earlier step, so this only has to start them.
         */
        webServer: [
          {
            command: isCI
              ? 'pnpm --filter @toolgraph/engine start'
              : 'pnpm --filter @toolgraph/engine dev',
            url: 'http://127.0.0.1:8787/health',
            reuseExistingServer: !isCI,
            timeout: 120_000,
            stdout: 'pipe',
            stderr: 'pipe',
          },
          {
            command: isCI
              ? 'pnpm --filter @toolgraph/web start'
              : 'pnpm --filter @toolgraph/web dev',
            url: 'http://127.0.0.1:3000/api/health',
            reuseExistingServer: !isCI,
            timeout: 180_000,
            stdout: 'pipe',
            stderr: 'pipe',
          },
        ],
      }),
});
