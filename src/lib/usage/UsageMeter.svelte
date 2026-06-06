<script lang="ts">
  // Compact display-only usage meter for the title bar. Shows the 5-hour and
  // 7-day rate-limit windows as label + thin progress bar + percentage.
  //
  // DISPLAY ONLY — no click handlers, no inputs. `pointer-events: none` on root
  // so it never interferes with the draggable title bar region.
  //
  // Data path: reads `snapshots.byPane` → `accountSummary(byPane, null)` (same
  // source as UsageBar's `view.account`, but without needing the focused-pane git
  // or session cards — so we call `accountSummary` directly).

  import { snapshots } from './snapshots.svelte';
  import { accountSummary } from './rollup';

  // Derive the account summary reactively. `null` for git since we don't need it.
  const account = $derived(accountSummary(snapshots.byPane, null));

  // 1-second tick so the tooltip "resets in Nh Mm" stays fresh.
  let nowMs = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => {
      nowMs = Date.now();
    }, 1000);
    return () => clearInterval(id);
  });

  /** Format `usedPct` as "3%" or "—" when null. */
  function pct(value: number | null): string {
    return value === null ? '—' : `${Math.round(value)}%`;
  }

  /**
   * Build a tooltip string for a window.
   * If `resetsAt` (unix seconds) is present, shows "resets in Nh Mm"
   * (or "resets in <1m" when less than a minute remains).
   * Falls back to the absolute local time if the math is odd.
   */
  function resetTooltip(label: string, resetsAt: number | null): string {
    if (resetsAt === null) return `${label} rate-limit window`;
    const diffMs = resetsAt * 1000 - nowMs;
    if (diffMs <= 0) return `${label} window — resetting soon`;
    const totalMinutes = Math.floor(diffMs / 60_000);
    if (totalMinutes < 1) return `${label} window — resets in <1m`;
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    const parts = h > 0 ? `${h}h ${m}m` : `${m}m`;
    return `${label} window — resets in ${parts}`;
  }
</script>

<div class="usage-meter" aria-label="Rate-limit usage">
  <!-- 5-hour window -->
  <div class="window" title={resetTooltip('5h', account.fiveHour.resetsAt)}>
    <span class="label">5h</span>
    <div class="track" class:unknown={account.fiveHour.usedPct === null}>
      {#if account.fiveHour.usedPct !== null}
        <div
          class="fill"
          style:width={`${Math.max(0, Math.min(100, account.fiveHour.usedPct))}%`}
        ></div>
      {/if}
    </div>
    <span class="pct" class:dim={account.fiveHour.usedPct === null}>
      {pct(account.fiveHour.usedPct)}
    </span>
  </div>

  <span class="divider" aria-hidden="true"></span>

  <!-- 7-day window -->
  <div class="window" title={resetTooltip('7d', account.sevenDay.resetsAt)}>
    <span class="label">7d</span>
    <div class="track" class:unknown={account.sevenDay.usedPct === null}>
      {#if account.sevenDay.usedPct !== null}
        <div
          class="fill"
          style:width={`${Math.max(0, Math.min(100, account.sevenDay.usedPct))}%`}
        ></div>
      {/if}
    </div>
    <span class="pct" class:dim={account.sevenDay.usedPct === null}>
      {pct(account.sevenDay.usedPct)}
    </span>
  </div>
</div>

<style>
  .usage-meter {
    pointer-events: none;
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    user-select: none;
    -webkit-user-select: none;
  }

  /* One rate-limit window: label + bar + pct */
  .window {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  .label {
    color: var(--fg-4);
    text-transform: lowercase;
    letter-spacing: 0.03em;
    line-height: 1;
  }

  /* Progress track */
  .track {
    width: 46px;
    height: 4px;
    border-radius: 2px;
    background: var(--space-600);
    overflow: hidden;
    flex: 0 0 auto;
  }

  /* Striped unknown state — mirrors the context bar's unknown style */
  .track.unknown {
    background: repeating-linear-gradient(
      -45deg,
      var(--space-600),
      var(--space-600) 3px,
      var(--space-700) 3px,
      var(--space-700) 6px
    );
  }

  /* Coloured fill — same blue gradient as the context bars in UsageBar */
  .fill {
    height: 100%;
    border-radius: 2px;
    background: linear-gradient(90deg, var(--blue-500), var(--blue-400));
    transition: width 0.3s ease;
  }

  .pct {
    color: var(--fg-2);
    font-variant-numeric: tabular-nums;
    line-height: 1;
    min-width: 2.8ch;
    text-align: right;
  }

  .pct.dim {
    color: var(--fg-4);
  }

  /* Thin separator between the two windows */
  .divider {
    display: inline-block;
    width: 1px;
    height: 12px;
    background: var(--line-subtle);
    flex: 0 0 auto;
  }
</style>
