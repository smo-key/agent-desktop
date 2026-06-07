<script lang="ts">
  // A tiny inline-SVG icon, drawn from the vendored `PROJECT_ICONS` set (offline,
  // no dependency). Stroke-based, uniform 1.75 stroke to match the design system;
  // sized + colored via props. The glyph markup is trusted (it ships in our own
  // module — never user input), so {@html} is safe here.
  import { iconMarkup } from './projectIcons';

  let {
    name,
    size = 16,
    color = 'currentColor',
    stroke = 1.75
  }: { name: string; size?: number; color?: string; stroke?: number } = $props();
</script>

<svg
  class="mc-icon"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke={color}
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {@html iconMarkup(name)}
</svg>

<style>
  .mc-icon {
    display: block;
    flex: none;
  }
</style>
