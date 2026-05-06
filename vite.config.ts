import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

      // Service worker + its dependencies (plain ES modules, copied as-is)
      // Auth page (standalone tab, no React)
      // Manifest
      const staticFiles = [
        'background.js',
        'authService.js',
        'storage.js',
        'auth.html',
        'auth.js',
        'auth.css',
        'manifest.json',
      ];
      for (const f of staticFiles) {
        try {
          copyFileSync(resolve(root, f), resolve(dist, f));
        } catch { /* file may not exist */ }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), copyExtensionFiles()],
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
