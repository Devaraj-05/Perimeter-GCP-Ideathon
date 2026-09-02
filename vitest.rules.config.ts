import { defineConfig } from 'vitest/config';

/**
 * Rules tests run against the Firestore emulator and are therefore separated
 * from the pure unit suite, which must stay runnable with no infrastructure.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
