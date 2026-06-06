<script lang="ts">
  // The focused pane's context window usage: a "ctx" label, the percent (colored
  // by fullness), then the colored StatusBar to the RIGHT of the percent. A dim
  // dash + striped bar when unknown.
  import StatusBar from './StatusBar.svelte';
  import { barColor } from './barColor';

  let { pct }: { pct: number | null } = $props();

  function fmt(value: number | null): string {
    return value === null ? '—' : `${Math.round(value)}%`;
  }
</script>

<div class="ctx" aria-label="Focused pane context window used">
  <span class="label">ctx</span>
  <span class="val" class:dim={pct === null} style:color={pct === null ? null : barColor(pct)}>
    {fmt(pct)}
  </span>
  <StatusBar
    {pct}
    label={pct === null ? 'context unknown' : `context ${Math.round(pct)}%`}
  />
</div>

<style>
  .ctx {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }
  .label {
    color: var(--fg-4);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 10px;
    font-family: var(--font-mono);
  }
  .ctx :global(.bar) {
    width: 96px;
    flex: 0 0 96px;
  }
  .val {
    font-size: 11px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    font-family: var(--font-mono);
    min-width: 30px;
    text-align: right;
  }
  .val.dim {
    color: var(--fg-4);
    font-weight: 400;
  }
</style>
