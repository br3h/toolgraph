import { defineConfig } from 'vitest/config';

/**
 * Row level security isolation suite.
 *
 * Deliberately separate from the per-package `vitest.config.ts` files: these
 * tests need a live Postgres behind PostgREST, so they must never be swept into
 * `pnpm test`. Only `pnpm test:rls` runs them, and CI gives that its own job
 * with a Supabase stack attached.
 */
export default defineConfig({
  test: {
    include: ['supabase/tests/**/*.test.ts'],
    environment: 'node',

    // Every test in the suite reads and writes the same two seeded accounts, so
    // they are ordered and must not overlap.
    fileParallelism: false,
    sequence: { concurrent: false },

    // A cold `supabase start` answers the first admin-API call slowly. The
    // default 10s hook budget is not enough to create and sign in two users and
    // seed eight rows, and a timeout here looks exactly like an RLS failure.
    hookTimeout: 120_000,
    testTimeout: 60_000,

    // No retries. A flaky RLS assertion is a security signal; retrying until it
    // passes is the one thing that must not happen to this suite.
    retry: 0,

    // Name each assertion in the log — when this suite fails, which policy gave
    // way is the whole message.
    reporters: ['verbose'],
  },
});
