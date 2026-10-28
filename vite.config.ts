import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 1420, strictPort: true },
  clearScreen: false,
  // 小窗是独立窗口，入口是 mini.html（N6）；gallery.html 只在开发时用，不进构建
  build: { rollupOptions: { input: { main: 'index.html', mini: 'mini.html' } } },
  // test-runner.mjs owns the hard 60-second process deadline; parallel load must not add a second 5-second per-test deadline.
  test: { environment: 'node', include: ['src/**/*.test.ts'], testTimeout: 0 },
});
