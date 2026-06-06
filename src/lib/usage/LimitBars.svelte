<script lang="ts">
  // The combined account-wide rate-limit bars (5h + 7d) grouped as one unit. Each
  // is a label + StatusBar (colored by fullness) + percent, or a dim dash when
  // the window is unknown.
  import StatusBar from './StatusBar.svelte';
  import type { RateWindow } from './rollup';

  let { fiveHour, sevenDay }: { fiveHour: RateWindow; sevenDay: RateWindow } = $props();

  function pct(value: number | null): string {
    return value === null ? '—' : `${Math.round(value)}%`;
  }
</script>

<div class="limits" aria-label="Account rate limits">
  <div class="limit">
    <span class="label">5h</span>
    <StatusBar pct={fiveHour.usedPct} label={`5-hour limit ${pct(fiveHour.usedPct)}`} />
    <span class="val" class:dim={fiveHour.usedPct === null}>{pct(fiveHour.usedPct)}</span>
  </div>
  <div class="limit">
    <span class="label">7d</span>
    <StatusBar pct={sevenDay.usedPct} label={`7-day limit ${pct(sevenDay.usedPct)}`} />
    <span class="val" class:dim={sevenDay.usedPct === null}>{pct(sevenDay.usedPct)}</span>
  </div>
</div>

<style>
  .limits {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 14px;
    padding: 4px 10px;
    border-radius: var(--r-sm);
    background: var(--space-850);
    box-shadow: inset 0 0 0 1px var(--line-faint);
  }
  .limit {
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
  .limit :global(.bar) {
    width: 64px;
    flex: 0 0 64px;
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
