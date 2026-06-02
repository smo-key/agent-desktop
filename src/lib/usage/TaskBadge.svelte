<script lang="ts">
  // A subtle, non-intrusive per-pane task BADGE (Milestone 4, design D7;
  // requirement "Surface Task Per Pane"). Rendered as an overlay in the top-right
  // corner of a leaf, it shows the pane's current task as a small pill with a
  // live/idle dot — the SAME task + heartbeat the dashboard card reads (both from
  // the snapshots store keyed by paneId), so badge and card never disagree.
  //
  // It must NEVER steal pointer events from the terminal beneath it
  // (pointer-events:none, set on the host + every child), and it renders NOTHING
  // when there is no task (`taskBadge(...)` returns null). A 1s clock ticks the
  // live/idle dot stale on its own, matching the usage bar's heartbeat.

  import { snapshots } from './snapshots.svelte';
  import { taskBadge } from './taskBadge';

  let { paneId }: { paneId: string } = $props();

  // A 1-second heartbeat clock (unix seconds, to match snapshot `ts`) so the dot
  // flips to idle when the snapshot stops arriving, without a new event.
  let nowSeconds = $state(Math.floor(Date.now() / 1000));
  $effect(() => {
    const id = setInterval(() => {
      nowSeconds = Math.floor(Date.now() / 1000);
    }, 1000);
    return () => clearInterval(id);
  });

  // The badge view-model from this pane's snapshot, or null (render nothing). All
  // logic is in the PURE `taskBadge(...)` (unit-tested); this is the thin shell.
  const view = $derived(taskBadge(snapshots.get(paneId), nowSeconds));
</script>

{#if view}
  <div class="task-badge" class:idle={!view.live} aria-hidden="true">
    <span class="dot" class:on={view.live}></span>
    <span class="label">{view.label}</span>
  </div>
{/if}

<style>
  /* Top-right overlay. pointer-events:none so the terminal underneath keeps every
     click/selection/scroll — the badge is purely informational. */
  .task-badge {
    position: absolute;
    top: 6px;
    right: 6px;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: 60%;
    padding: 3px 8px;
    border-radius: 999px;
    background: rgba(13, 17, 23, 0.82);
    box-shadow: inset 0 0 0 1px rgba(88, 166, 255, 0.35);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    pointer-events: none;
    user-select: none;
    -webkit-user-select: none;
    font-family:
      ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    /* Slightly recede when idle so a live pane reads as the active one. */
    opacity: 0.95;
    transition: opacity 0.15s ease;
  }
  .task-badge.idle {
    box-shadow: inset 0 0 0 1px rgba(110, 118, 129, 0.4);
    opacity: 0.6;
  }

  .dot {
    flex: 0 0 auto;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #484f58; /* idle: grey */
    pointer-events: none;
    transition: background 0.15s ease;
  }
  .dot.on {
    background: #3fb950; /* live: green */
    box-shadow: 0 0 0 2px rgba(63, 185, 80, 0.18);
  }

  .label {
    font-size: 11px;
    line-height: 1.2;
    color: #adbac7;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    pointer-events: none;
  }
</style>
