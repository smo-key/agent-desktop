<script lang="ts">
  // A tiny inline-SVG brand icon, drawn from the vendored `BRAND_ICONS` set (offline,
  // no dependency). Unlike `Icon.svelte` (stroke-based), these glyphs are FILLED
  // silhouettes, so the <svg> uses `fill` (not stroke). Sized + colored via props.
  // The glyph markup is trusted (ships in our own module — never user input), so
  // {@html} is safe here. Used by the Settings "Open files with" dropdowns.
  import { brandMarkup } from './brandIcons';

  let {
    name,
    size = 16,
    color = 'currentColor'
  }: { name: string; size?: number; color?: string } = $props();
</script>

<svg
  class="brand-icon"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill={color}
  aria-hidden="true"
>
  {@html brandMarkup(name)}
</svg>

<style>
  .brand-icon {
    display: block;
    flex: none;
  }
</style>
