import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Generating code, then compiling it with tsc and py_compile, is genuinely
    // slower than a unit test has any right to be.
    testTimeout: 60_000,
  },
});
