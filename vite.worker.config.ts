import { defineConfig } from 'vite';

// MV3 service worker: single ES module file, no splitting.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome116',
    sourcemap: false,
    lib: {
      entry: 'src/background/service-worker.ts',
      formats: ['es'],
      fileName: () => 'service-worker.js',
    },
  },
});
