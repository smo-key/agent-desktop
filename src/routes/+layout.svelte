<script lang="ts">
  // Global design tokens (mission-control deep-space theme): color/type/spacing
  // custom properties + @font-face. Imported once here so every component's
  // scoped styles can reference the CSS variables.
  import '$lib/styles/tokens.css';
  // xterm's base stylesheet is imported once for the whole app; individual
  // terminal panes only need to construct the addon/renderer.
  import '@xterm/xterm/css/xterm.css';
  import { theme } from '$lib/settings/theme.svelte';

  let { children } = $props();

  // Stamp the resolved theme ('dark' | 'light') onto <html> so tokens.css's
  // `:root[data-theme='...']` blocks take effect. `app.html` ships
  // `data-theme="dark"` statically (today's unchanged default, no flash before
  // this effect runs); `theme.load()` (called from +page.svelte's onMount)
  // then corrects it reactively once the persisted preference resolves.
  $effect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.theme = theme.resolved;
  });
</script>

{@render children?.()}

<style>
  :global(html),
  :global(body) {
    margin: 0;
    padding: 0;
    height: 100%;
    background: var(--space-950);
    color: var(--fg-1);
    font-family: var(--font-sans);
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
</style>
