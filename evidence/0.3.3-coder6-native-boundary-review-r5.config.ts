import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['evidence/0.3.3-coder6-native-boundary-review-r5.test.ts'],
    // The shared review runner enforces the repository's 60-second process deadline.
    testTimeout: 0,
  },
});
