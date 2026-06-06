<script lang="ts">
  // A project's tinted icon tile — the agent avatar (mirrors `ui.jsx`'s
  // ProjectIcon). Background + border are the project color at low alpha; the
  // glyph itself is the full color. When no project is resolved, falls back to a
  // neutral folder tile so an unassigned agent still reads cleanly. When a `logo`
  // is set, the logo image fills the tile instead of the glyph.
  import Icon from './Icon.svelte';
  import { hexA } from '../projects/projects';

  let {
    icon = 'folder',
    color = '#7B8499',
    size = 34,
    radius = 'var(--r-md)',
    logo = undefined
  }: { icon?: string; color?: string; size?: number; radius?: string; logo?: string } = $props();
</script>

<div
  class="proj-ic"
  style:width={`${size}px`}
  style:height={`${size}px`}
  style:border-radius={radius}
  style:background={hexA(color, 0.14)}
  style:border-color={hexA(color, 0.3)}
  style:color
  style:padding={logo ? `${Math.max(2, Math.round(size * 0.16))}px` : undefined}
>
  {#if logo}
    <img class="proj-logo" src={logo} alt="" style:border-radius="var(--r-xs)" />
  {:else}
    <Icon name={icon} size={Math.round(size * 0.5)} {color} />
  {/if}
</div>

<style>
  .proj-ic {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid;
    flex: none;
    overflow: hidden;
  }
  /* The logo is inset via inline px padding (proportional to `size`) so it floats
     inside the tile rather than filling it edge-to-edge. */
  .proj-logo {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }
</style>
