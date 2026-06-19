import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Default rysh-server base URL baked into the build. Set by the Makefile
// (build-prod / build-test) via VITE_RYSH_SERVER_URL; defaults to production.
//   make build-prod → https://rysh.ai
//   make build-test → http://localhost:8080 (local rysh-server)
const SERVER_URL = (
  process.env.VITE_RYSH_SERVER_URL ||
  process.env.RYSH_SERVER_URL ||
  'https://rysh.ai'
).trim().replace(/\/$/, '');

// Placeholder token substituted into the static (non-bundled) files at copy
// time — these plain JS/HTML files aren't processed by the bundler, so the
// `define` below can't reach them.
const SERVER_URL_TOKEN = '__RYSH_DEFAULT_SERVER_URL__';

/** Copies static Chrome extension files (background, auth, icons, manifest) into dist/. */
function copyExtensionFiles(): Plugin {
  return {
    name: 'copy-chrome-ext-files',
    closeBundle() {
      const root = resolve(__dirname);
      const dist = resolve(__dirname, 'dist');

      // Icons
      mkdirSync(resolve(dist, 'icons'), { recursive: true });
      for (const size of ['16', '48', '128']) {
        try {
          copyFileSync(
            resolve(root, `icons/icon${size}.png`),
            resolve(dist, `icons/icon${size}.png`),
          );
        } catch { /* icon may not exist yet */ }
      }

      // Service worker + its dependencies (plain ES modules, copied as-is).
      const staticFiles = [
        'background.js',
        'authService.js',
        'storage.js',
        'auth.css',
        'manifest.json',
      ];
      for (const f of staticFiles) {
        try {
          copyFileSync(resolve(root, f), resolve(dist, f));
        } catch { /* file may not exist */ }
      }

      // Standalone auth page (not bundled): substitute the baked server URL
      // into the SERVER_URL_TOKEN placeholders before writing to dist/.
      const templatedFiles = ['auth.js', 'auth.html'];
      for (const f of templatedFiles) {
        try {
          const src = readFileSync(resolve(root, f), 'utf8');
          writeFileSync(resolve(dist, f), src.split(SERVER_URL_TOKEN).join(SERVER_URL));
        } catch { /* file may not exist */ }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), copyExtensionFiles()],
  define: {
    // Baked into the bundled React app (src/services/api.ts, auth.ts).
    __RYSH_DEFAULT_SERVER_URL__: JSON.stringify(SERVER_URL),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'popup.html'),
      output: {
        // Use stable filenames so manifest.json doesn't need updating.
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
});
