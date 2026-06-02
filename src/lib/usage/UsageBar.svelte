<script lang="ts">
  // The two-row usage DASHBOARD (Milestone 3, design D3 / section 4.3). Pinned at
  // the bottom of the app, full width below the body.
  //
  //   TOP row   — one card per session snapshot: model name, a context bar (from
  //               context_pct), the detected task label, and a live/idle dot
  //               driven by the snapshot `ts` heartbeat. Clicking a card best-
  //               effort focuses/activates that pane.
  //   BOTTOM row — the account summary: 5h / 7d rate-limit percentages (a dim
  //               dash when absent), the summed cost across panes, and the
  //               currently-focused pane's git (branch + dirty).
  //
  // ALL math lives in the PURE `rollup(...)` module (unit-tested). This component
  // is the thin reactive shell: it reads the snapshots store + workspace focus,
  // ticks a 1s clock so the live/idle dots go stale on their own, and renders.

  import { snapshots } from './snapshots.svelte';
  import { foreign } from './foreign.svelte';
  import { rollup, IDLE_AFTER_SECONDS } from './rollup';
  import { workspace } from '$lib/layout/workspace.svelte';

  // A 1-second heartbeat clock so a card flips to "idle" when its snapshot stops
  // arriving, without needing a new event. Unix SECONDS to match snapshot `ts`.
  let nowSeconds = $state(Math.floor(Date.now() / 1000));
  $effect(() => {
    const id = setInterval(() => {
      nowSeconds = Math.floor(Date.now() / 1000);
    }, 1000);
    return () => clearInterval(id);
  });

  // The whole dashboard view-model, recomputed when snapshots, focus, or the
  // clock change. `focusedPaneId` picks which pane's git fills the bottom row.
  const view = $derived(
    rollup(snapshots.byPane, workspace.focusedPaneId, nowSeconds)
  );

  // EXTERNAL (foreign) sessions — running outside the app, already filtered to
  // exclude our own pane session ids. Rendered as muted cards after the app
  // panes, clearly distinguished as "external".
  const external = $derived(foreign.list);

  function focusCard(paneId: string) {
    workspace.focusPane(paneId);
  }

  /** A foreign session's short id (first 8 chars) for a compact card heading. */
  function shortId(sessionId: string): string {
    return sessionId.length > 8 ? sessionId.slice(0, 8) : sessionId;
  }

  /** Whether a foreign session's heartbeat `ts` is fresh (live) at `nowSeconds`.
   *  A null/future ts is treated like the app cards: absent -> idle, future -> live. */
  function foreignLive(ts: number | null): boolean {
    if (ts === null) return false;
    return nowSeconds - ts <= IDLE_AFTER_SECONDS;
  }

  /** Trim a model id to a compact display label (verbatim if already short). */
  function modelLabel(model: string | null): string {
    return model && model.trim() ? model : 'unknown';
  }

  /** A rate-limit window cell: "33%" or a dim dash when absent. */
  function pct(value: number | null): string {
    return value === null ? '—' : `${Math.round(value)}%`;
  }

  /** Summed cost as "$1.75", or a dim dash when no pane reported a cost. */
  function cost(value: number | null): string {
    return value === null ? '—' : `$${value.toFixed(2)}`;
  }
</script>

<footer class="usage-bar" aria-label="Usage dashboard">
  <!-- TOP ROW: per-session cards. Empty state when no app pane AND no external
       session is reporting. App panes first, then muted "external" cards. -->
  <div class="cards">
    {#if view.cards.length === 0 && external.length === 0}
      <div class="empty">No active sessions reporting yet</div>
    {:else}
      {#each view.cards as card (card.paneId)}
        <button
          type="button"
          class="card"
          class:focused={card.paneId === workspace.focusedPaneId}
          onclick={() => focusCard(card.paneId)}
          title={card.task ?? modelLabel(card.model)}
        >
          <div class="card-head">
            <span class="live-dot" class:on={card.live} aria-hidden="true"></span>
            <span class="model">{modelLabel(card.model)}</span>
          </div>

          <!-- Context bar: a known fill, or an empty/unknown track when null. -->
          <div
            class="context"
            class:unknown={card.contextPct === null}
            title={card.contextPct === null
              ? 'context unknown'
              : `context ${Math.round(card.contextPct)}%`}
          >
            {#if card.contextPct !== null}
              <div
                class="context-fill"
                style:width={`${Math.max(0, Math.min(100, card.contextPct))}%`}
              ></div>
            {/if}
          </div>

          <span class="task">{card.task ?? '—'}</span>
        </button>
      {/each}

      <!-- EXTERNAL sessions: not app panes, so non-clickable + visually muted.
           Clearly distinguished by the "ext" tag + dashed border. -->
      {#each external as ext (ext.session_id)}
        {@const live = foreignLive(ext.ts)}
        <div class="card external" title={ext.task ?? `external session ${ext.session_id}`}>
          <div class="card-head">
            <span class="live-dot" class:on={live} aria-hidden="true"></span>
            <span class="model" title={ext.session_id}>{shortId(ext.session_id)}</span>
            <span class="ext-tag">ext</span>
          </div>

          <div
            class="context"
            class:unknown={ext.context_pct === null}
            title={ext.context_pct === null
              ? 'context unknown'
              : `context ${Math.round(ext.context_pct)}%`}
          >
            {#if ext.context_pct !== null}
              <div
                class="context-fill"
                style:width={`${Math.max(0, Math.min(100, ext.context_pct))}%`}
              ></div>
            {/if}
          </div>

          <span class="task">{ext.task ?? '—'}</span>
        </div>
      {/each}
    {/if}
  </div>

  <!-- BOTTOM ROW: account-wide rate limits + summed cost + focused-pane git. -->
  <div class="account">
    <div class="metric" title="5-hour rate-limit window used">
      <span class="metric-label">5h</span>
      <span class="metric-value" class:dim={view.account.fiveHour.usedPct === null}>
        {pct(view.account.fiveHour.usedPct)}
      </span>
    </div>
    <div class="metric" title="7-day rate-limit window used">
      <span class="metric-label">7d</span>
      <span class="metric-value" class:dim={view.account.sevenDay.usedPct === null}>
        {pct(view.account.sevenDay.usedPct)}
      </span>
    </div>

    <span class="sep" aria-hidden="true"></span>

    <div class="metric" title="Summed cost across all panes">
      <span class="metric-label">cost</span>
      <span class="metric-value" class:dim={view.account.totalCost === null}>
        {cost(view.account.totalCost)}
      </span>
    </div>

    <span class="sep" aria-hidden="true"></span>

    <div class="metric git" title="Focused pane git status">
      <span class="metric-label">git</span>
      {#if view.account.git && view.account.git.branch}
        <span class="branch">{view.account.git.branch}</span>
        {#if view.account.git.dirty === true}
          <span class="dirty" title="uncommitted changes">●</span>
        {:else if view.account.git.dirty === false}
          <span class="clean" title="clean">✓</span>
        {/if}
      {:else}
        <span class="metric-value dim">—</span>
      {/if}
    </div>
  </div>
</footer>

<style>
  .usage-bar {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    width: 100%;
    background: #0b0f14;
    border-top: 1px solid #21262d;
    user-select: none;
    -webkit-user-select: none;
    font-family:
      ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }

  /* ---- Top row: session cards -------------------------------------------- */
  .cards {
    display: flex;
    flex-direction: row;
    gap: 8px;
    padding: 8px 10px;
    overflow-x: auto;
    overflow-y: hidden;
    min-height: 0;
  }

  .empty {
    font-size: 11px;
    color: #6e7681;
    padding: 6px 4px;
    font-style: italic;
  }

  .card {
    flex: 0 0 auto;
    width: 180px;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    padding: 8px 10px;
    border: none;
    border-radius: 8px;
    background: #161b22;
    box-shadow: inset 0 0 0 1px #21262d;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    appearance: none;
    -webkit-appearance: none;
    transition:
      background 0.12s ease,
      box-shadow 0.12s ease;
  }
  .card:hover {
    background: #1c2128;
  }
  .card.focused {
    box-shadow: inset 0 0 0 1px #58a6ff;
  }
  .card:focus-visible {
    outline: 2px solid #58a6ff;
    outline-offset: 1px;
  }

  /* External (foreign) sessions: muted, not clickable, dashed border + lower
     opacity so they read as "not one of mine" at a glance. */
  .card.external {
    background: #11161d;
    box-shadow: inset 0 0 0 1px transparent;
    border: 1px dashed #30363d;
    cursor: default;
    opacity: 0.82;
  }
  .card.external:hover {
    background: #11161d;
    opacity: 1;
  }
  .card.external .model {
    color: #adbac7;
    font-family:
      ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
    font-weight: 500;
  }

  /* The "ext" tag pinned at the head's right edge. */
  .ext-tag {
    flex: 0 0 auto;
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #6e7681;
    background: #21262d;
    border-radius: 4px;
    padding: 1px 5px;
  }

  .card-head {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }

  .live-dot {
    flex: 0 0 auto;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #484f58; /* idle: grey */
    transition: background 0.15s ease;
  }
  .live-dot.on {
    background: #3fb950; /* live: green */
    box-shadow: 0 0 0 2px rgba(63, 185, 80, 0.18);
  }

  .model {
    flex: 1 1 auto;
    font-size: 12px;
    font-weight: 600;
    color: #e6edf3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Context bar: a thin track with a coloured fill, or a striped unknown state. */
  .context {
    height: 5px;
    border-radius: 3px;
    background: #21262d;
    overflow: hidden;
  }
  .context.unknown {
    background: repeating-linear-gradient(
      -45deg,
      #21262d,
      #21262d 4px,
      #1a1f26 4px,
      #1a1f26 8px
    );
  }
  .context-fill {
    height: 100%;
    border-radius: 3px;
    background: linear-gradient(90deg, #3fb950, #58a6ff);
    transition: width 0.2s ease;
  }

  .task {
    font-size: 11px;
    color: #adbac7;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ---- Bottom row: account summary --------------------------------------- */
  .account {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 14px;
    padding: 6px 12px;
    border-top: 1px solid #161b22;
    background: #0d1117;
    font-size: 11px;
    font-family:
      ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  }

  .metric {
    display: flex;
    align-items: baseline;
    gap: 5px;
    min-width: 0;
  }

  .metric-label {
    color: #6e7681;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 10px;
  }

  .metric-value {
    color: #e6edf3;
    font-weight: 600;
  }
  .metric-value.dim {
    color: #484f58;
    font-weight: 400;
  }

  .sep {
    width: 1px;
    height: 14px;
    background: #21262d;
  }

  .git {
    flex: 0 1 auto;
    overflow: hidden;
  }
  .branch {
    color: #58a6ff;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 220px;
  }
  .dirty {
    color: #d29922; /* amber: uncommitted */
    font-size: 9px;
  }
  .clean {
    color: #3fb950; /* green: clean */
    font-size: 10px;
  }
</style>
