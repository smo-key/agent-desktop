import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // Static SPA: Tauri serves a local bundle, so prerendering is off and
    // every route falls back to a single index.html (client-side routing).
    adapter: adapter({
      fallback: 'index.html'
    })
  }
};

export default config;
