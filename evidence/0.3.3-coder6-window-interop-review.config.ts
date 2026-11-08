import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['evidence/0.3.3-coder6-window-interop-review.test.ts'], testTimeout: 0 } });
