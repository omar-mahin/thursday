import { defineConfig } from 'vite';

/**
 * The content script is injected by chrome.scripting.executeScript, which needs
 * a single classic script with no imports -> IIFE, no code splitting.
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome116',
    sourcemap: false,
    lib: {
      entry: 'src/content/index.ts',
      formats: ['iife'],
      name: 'ThursdayContent',
      fileName: () => 'content.js',
    },
  },
});
