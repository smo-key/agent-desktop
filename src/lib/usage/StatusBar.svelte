<script lang="ts">
  // A thin track + colored fill. The fill width is the clamped percent and its
  // color comes from the shared `barColor` (green/yellow/red by fullness). A null
  // percent renders an "unknown" striped track. Used by LimitBars + ContextBar.
  import { barColor } from './barColor';
  import { tooltip } from '$lib/ui/tooltip';

  let { pct, label }: { pct: number | null; label?: string } = $props();

  const known = $derived(pct !== null && Number.isFinite(pct));
  const width = $derived(known ? Math.max(0, Math.min(100, pct as number)) : 0);
</script>

<div class="bar" class:unknown={!known} use:tooltip={label ?? ''}>
  {#if known}
    <div class="fill" style:width={`${width}%`} style:background={barColor(pct)}></div>
  {/if}
</div>

<style>
  .bar {
    flex: 1 1 auto;
    min-width: 48px;
    height: 5px;
    border-radius: 3px;
    background: var(--space-600);
    overflow: hidden;
  }
  .bar.unknown {
    background: repeating-linear-gradient(
      -45deg,
      var(--space-600),
      var(--space-600) 4px,
      var(--space-700) 4px,
      var(--space-700) 8px
    );
  }
  .fill {
    height: 100%;
    border-radius: 3px;
    transition:
      width var(--dur-base),
      background var(--dur-base);
  }
</style>
