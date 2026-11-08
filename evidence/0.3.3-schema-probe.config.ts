import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['evidence/0.3.3-schema-probe.test.ts'], testTimeout: 0, disableConsoleIntercept: true } });
