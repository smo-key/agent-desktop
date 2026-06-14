import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Tauri expects a fixed dev-server port it can point its webview at.
const host = process.env.TAURI_DEV_HOST;

// `package.json` is the single source of version truth (scripts/sync-version.sh
// propagates it into the Tauri / Cargo manifests at release time). Inline it at
// build time as the `__APP_VERSION__` literal so the Settings footer can show it
// without a runtime Tauri call (and so it works in the plain-web build too).
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8')
) as { version: string };

export default defineConfig({
  plugins: [sveltekit()],

  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },

  // Tauri requires a fixed, strict port and a clean console.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421
        }
      : undefined,
    watch: {
      // Don't watch the Rust backend; cargo does that.
      ignored: ['**/src-tauri/**']
    }
  }
});
