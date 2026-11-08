import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['evidence/0.3.3-p6-verification.test.ts'],
    testTimeout: 0,
  },
});
