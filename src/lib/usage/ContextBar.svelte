<script lang="ts">
  // The focused pane's context window usage: a "ctx" label + a StatusBar (colored
  // by fullness) + the percent. A dim dash + striped bar when unknown.
  import StatusBar from './StatusBar.svelte';

  let { pct }: { pct: number | null } = $props();

  function fmt(value: number | null): string {
    return value === null ? '—' : `${Math.round(value)}%`;
  }
</script>

<div class="ctx" aria-label="Focused pane context window used">
  <span class="label">ctx</span>
  <StatusBar
    {pct}
    label={pct === null ? 'context unknown' : `context ${Math.round(pct)}%`}
  />
  <span class="val" class:dim={pct === null}>{fmt(pct)}</span>
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
    color: var(--fg-1);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    font-family: var(--font-mono);
    min-width: 30px;
    text-align: right;
  }
  .val.dim {
    color: var(--fg-4);
  }
</style>
