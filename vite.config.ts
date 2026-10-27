import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 1420, strictPort: true },
  clearScreen: false,
  // test-runner.mjs owns the hard 60-second process deadline; parallel load must not add a second 5-second per-test deadline.
  test: { environment: 'node', include: ['src/**/*.test.ts'], testTimeout: 0 },
});
