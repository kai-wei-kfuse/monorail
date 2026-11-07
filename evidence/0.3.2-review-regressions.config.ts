import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['evidence/0.3.2-review-regressions.test.ts'], testTimeout: 0 } });
