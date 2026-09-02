import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { manifest } from './manifest.config';
import { PRODUCT_NAME } from './src/shared/constants/product';

/** Emits manifest.json from the typed config so there is one source of truth. */
function emitManifest(): Plugin {
  return {
    name: 'thursday:emit-manifest',
    // Keeps the product name out of every HTML file (PLAN.md section 0).
    transformIndexHtml(html) {
      return html.replaceAll('%PRODUCT_NAME%', PRODUCT_NAME);
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: `${JSON.stringify(manifest, null, 2)}\n`,
      });
    },
  };
}

// Extension pages (popup, side panel, options) + manifest + static assets.
export default defineConfig({
  plugins: [react(), emitManifest()],
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome116',
    modulePreload: false,
    sourcemap: false,
    rollupOptions: {
      input: {
        popup: 'popup.html',
        sidepanel: 'sidepanel.html',
        options: 'options.html',
      },
      output: {
        // Named explicitly so the shipped bundle stays easy to read: a privacy
        // claim is only as good as an auditor's ability to check it.
        manualChunks: (id) => (id.includes('node_modules') ? 'vendor' : undefined),
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
