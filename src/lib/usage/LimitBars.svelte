<script lang="ts">
  // The combined account-wide rate-limit bars (5h + 7d) grouped as one unit. Each
  // reads, left to right: the TIME REMAINING until that window resets (compact
  // "12M"/"5H"/"6D", colored the SAME as its bar), then the StatusBar (fill colored
  // by fullness), then the USED percentage in plain white. A dash when unknown. The
  // StatusBar tooltip spells out the used percent AND when the window resets.
  import StatusBar from './StatusBar.svelte';
  import { barColor } from './barColor';
  import { timeRemainingShort, usageLimitTooltip } from './timeRemaining';
  import type { RateWindow } from './rollup';

  let {
    fiveHour,
    sevenDay,
    now
  }: { fiveHour: RateWindow; sevenDay: RateWindow; now: number } = $props();

  /** Used percent or a dash when unknown. */
  function usedLabel(value: number | null): string {
    return value === null ? '—' : `${Math.round(value)}%`;
  }
</script>

<div class="limits" aria-label="Account rate limits">
  <div class="limit">
    <span class="time" style:color={barColor(fiveHour.usedPct)}>
      {timeRemainingShort(fiveHour.resetsAt, now)}
    </span>
    <StatusBar
      pct={fiveHour.usedPct}
      label={usageLimitTooltip('5-hour', fiveHour.usedPct, fiveHour.resetsAt, now)}
    />
    <span class="pct">{usedLabel(fiveHour.usedPct)}</span>
  </div>
  <div class="limit">
    <span class="time" style:color={barColor(sevenDay.usedPct)}>
      {timeRemainingShort(sevenDay.resetsAt, now)}
    </span>
    <StatusBar
      pct={sevenDay.usedPct}
      label={usageLimitTooltip('7-day', sevenDay.usedPct, sevenDay.resetsAt, now)}
    />
    <span class="pct">{usedLabel(sevenDay.usedPct)}</span>
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
  .limit :global(.bar) {
    width: 64px;
    flex: 0 0 64px;
  }
  /* Time remaining (left) — colored to match its bar. */
  .time {
    font-size: 11px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    font-family: var(--font-mono);
    min-width: 30px;
    text-align: right;
  }
  /* Used percent (right) — plain white. */
  .pct {
    color: var(--fg-1);
    font-size: 11px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    font-family: var(--font-mono);
    min-width: 34px;
    text-align: right;
  }
</style>
