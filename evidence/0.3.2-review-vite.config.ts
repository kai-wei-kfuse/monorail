import { defineConfig } from 'vite';
// The review harness needs JSX transformation, not dev React Refresh/Babel.
// Production source files are imported as-is; no plugin or dependency is installed/changed.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  build: {
    outDir: 'dist-review',
    rollupOptions: {
      input: {
        gallery: 'gallery.html',
        wipe: 'evidence/0.3.2-review-wipe.html',
      },
    },
  },
  preview: { host: '127.0.0.1', port: 1428, strictPort: true },
  server: { host: '127.0.0.1', port: 1428, strictPort: true },
});
