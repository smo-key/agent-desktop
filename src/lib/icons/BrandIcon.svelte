<script lang="ts">
  // A tiny inline-SVG brand icon, drawn from the vendored `BRAND_ICONS` set (offline,
  // no dependency). Unlike `Icon.svelte` (stroke-based, multi-element glyphs via
  // `{@html}`), each brand glyph is a SINGLE FILLED path, so we render a real
  // `<path d=…>` element directly (the data is bare `d` path data, not markup).
  // Sized + colored via props. Used by the Settings "Open files with" dropdowns.
  import { brandPath } from './brandIcons';

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
  <path d={brandPath(name)} />
</svg>

<style>
  .brand-icon {
    display: block;
    flex: none;
  }
</style>
