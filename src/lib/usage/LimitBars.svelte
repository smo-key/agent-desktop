<script lang="ts">
  // The combined account-wide rate-limit bars (5h + 7d) grouped as one unit. Each
  // is a label + StatusBar (fill colored by fullness) + the TIME REMAINING until
  // that window resets, as a compact shorthand ("12M" / "5H" / "6D"), colored with
  // the SAME color as its bar. A dim dash when the reset time is unknown.
  import StatusBar from './StatusBar.svelte';
  import { barColor } from './barColor';
  import { timeRemainingShort } from './timeRemaining';
  import type { RateWindow } from './rollup';

  let {
    fiveHour,
    sevenDay,
    now
  }: { fiveHour: RateWindow; sevenDay: RateWindow; now: number } = $props();

  /** The bar's tooltip: used percent or a dash when unknown. */
  function usedLabel(value: number | null): string {
    return value === null ? '—' : `${Math.round(value)}%`;
  }
</script>

<div class="limits" aria-label="Account rate limits">
  <div class="limit">
    <span class="label">5h</span>
    <StatusBar pct={fiveHour.usedPct} label={`5-hour limit ${usedLabel(fiveHour.usedPct)} used`} />
    <span class="val" style:color={barColor(fiveHour.usedPct)}>
      {timeRemainingShort(fiveHour.resetsAt, now)}
    </span>
  </div>
  <div class="limit">
    <span class="label">7d</span>
    <StatusBar pct={sevenDay.usedPct} label={`7-day limit ${usedLabel(sevenDay.usedPct)} used`} />
    <span class="val" style:color={barColor(sevenDay.usedPct)}>
      {timeRemainingShort(sevenDay.resetsAt, now)}
    </span>
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
    font-size: 11px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    font-family: var(--font-mono);
    min-width: 30px;
    text-align: right;
  }
</style>
