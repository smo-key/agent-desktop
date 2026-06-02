<script lang="ts">
  // The OVERVIEW — the primary "mission control" surface (Stage 3 of
  // agent-overview; spec: Agent Roster Overview / Navigate To An Agent / Message
  // An Agent / Kick Off A New Agent / Surface Subagents / Agent Usage Tracking).
  //
  // It renders the live roster (one card per app/claude pane across every
  // workspace) with each agent's name/cwd, model, current task, a context bar,
  // cost, and a live/idle/needs-attention status pill (needs-attention is the
  // visually prominent one — it's an agent waiting on YOU). Under each card it
  // nests that agent's subagents (label · status · usage). A header rollup sums
  // cost across every agent + subagent. A per-agent inline message box delivers
  // text straight to the pane's PTY without navigating. Clicking a card (anywhere
  // but its message box) navigates: activate that workspace, focus that pane, and
  // switch the top-level view to the terminal grid. A "＋ New agent" button opens
  // the session launcher.
  //
  // ALL the decision logic is PURE + unit-tested elsewhere: `buildRoster` /
  // `statusOf` (roster.ts), `agentUsage` / `aggregate` (usage.ts), `messageAgent`
  // (message.ts), `navigateTarget` (navigate.ts), the view toggle (view.svelte.ts),
  // and the subagent normalize/flatten (subagents.svelte.ts). This component is the
  // thin reactive shell that projects the stores into those cores and renders.

  import { workspace } from '$lib/layout/workspace.svelte';
  import { snapshots } from '$lib/usage/snapshots.svelte';
  import { launcher } from '$lib/launcher/launcherStore.svelte';
  import { leavesInOrder } from '$lib/layout/tree';
  import { buildRoster, type RosterWorkspace, type AgentStatus } from './roster';
  import { runtimeMap } from './runtime';
  import { aggregate } from './usage';
  import { messageAgent } from './message';
  import { navigateTarget, type NavWorkspace } from './navigate';
  import { subagents, type Subagent } from './subagents.svelte';
  import { view } from './view.svelte';

  // A 1-second clock so a card flips working -> waiting (and reflects exits) as the
  // live terminal goes quiet, with no new event needed. Epoch MS to match the
  // runtime registry's `lastOutputAt`.
  let nowMs = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => {
      nowMs = Date.now();
    }, 1000);
    return () => clearInterval(id);
  });

  // Project the live workspace store into the framework-free roster input: one
  // RosterWorkspace per workspace, each pane tagged isApp iff its registry program
  // is `claude` (only app panes become agent rows — shells are skipped).
  const rosterWorkspaces = $derived.by<RosterWorkspace[]>(() =>
    workspace.workspaces.map((entry) => ({
      id: entry.id,
      name: entry.name,
      panes: leavesInOrder(entry.ws.root).map((leaf) => ({
        paneId: leaf.paneId,
        cwd: entry.registry[leaf.paneId]?.cwd ?? null,
        isApp: entry.registry[leaf.paneId]?.program === 'claude'
      }))
    }))
  );

  // The same workspaces projected for navigation (id + root tree); the real tree
  // nodes already satisfy NavNode (leaves carry id + paneId).
  const navWorkspaces = $derived.by<NavWorkspace[]>(() =>
    workspace.workspaces.map((entry) => ({ id: entry.id, root: entry.ws.root }))
  );

  // The live roster, recomputed when workspaces, snapshots, or the clock change.
  // `runtimeMap()` is a plain (non-reactive) read of the imperative PTY-activity
  // registry; the 1-second `nowMs` tick re-runs this derived, so each agent's
  // working/waiting/finished/error status stays current without per-byte reactivity.
  const rows = $derived(
    buildRoster(snapshots.byPane, rosterWorkspaces, runtimeMap(), nowMs)
  );

  // The header usage rollup: every agent's cost + every available subagent's
  // recorded usage, nulls skipped. Stage 1's `aggregate` consumes the decoupled
  // `{cost}` shape, so we project each Stage 2 subagent to its recorded cost (the
  // nested `usage.cost`; a subagent with no usage contributes a null -> skipped).
  const subagentCosts = $derived(
    subagents.usageList.map((s) => ({ cost: s.usage?.cost ?? null }))
  );
  const totals = $derived(aggregate(rows, subagentCosts));

  // Per-agent draft message text, keyed by paneId. Cleared on a successful send.
  let drafts = $state<Record<string, string>>({});

  /** The subagents nested under an agent: resolved by the agent's session id (the
   *  snapshot's `session_id`), since subagents are keyed by their parent session. */
  function subagentsFor(paneId: string): Subagent[] {
    const sessionId = snapshots.get(paneId)?.session_id ?? null;
    if (!sessionId) return [];
    return subagents.forSession(sessionId);
  }

  /** Navigate to an agent: activate its workspace, focus its pane, show the grid.
   *  Resolution is PURE (`navigateTarget`); a stale row (no live leaf) no-ops. */
  function openAgent(paneId: string) {
    const target = navigateTarget(navWorkspaces, paneId);
    if (!target) return;
    workspace.setActiveWorkspace(target.workspaceId);
    workspace.setFocusIn(target.workspaceId, target.leafId);
    view.show('grid');
  }

  /** Send the draft to an agent's PTY (verbatim + single \r). Clears on success. */
  function sendTo(paneId: string) {
    const text = drafts[paneId] ?? '';
    if (messageAgent(paneId, text)) {
      drafts = { ...drafts, [paneId]: '' };
    }
  }

  function onMessageKey(e: KeyboardEvent, paneId: string) {
    // Enter sends (Shift-Enter would insert a newline, but a single-line input
    // has none — so plain Enter is the send gesture).
    if (e.key === 'Enter') {
      e.preventDefault();
      sendTo(paneId);
    }
  }

  function newAgent() {
    launcher.show();
  }

  // ---- Display helpers (formatting only; no logic) -------------------------

  function modelLabel(model: string | null): string {
    return model && model.trim() ? model : 'unknown';
  }

  function cost(value: number | null): string {
    return value === null ? '—' : `$${value.toFixed(2)}`;
  }

  function pct(value: number | null): string {
    return value === null ? '—' : `${Math.round(value)}%`;
  }

  function statusLabel(status: AgentStatus): string {
    switch (status) {
      case 'working':
        return 'working';
      case 'waiting':
        return 'needs input';
      case 'finished':
        return 'finished';
      case 'error':
        return 'errored';
      default:
        return 'idle';
    }
  }

  /** Statuses that demand the user's attention (prominent card highlight). */
  function isAttention(status: AgentStatus): boolean {
    return status === 'waiting' || status === 'error';
  }

  /** A subagent's compact usage label: cost if present, else tokens, else "—". */
  function subUsage(s: Subagent): string {
    const u = s.usage;
    if (u) {
      if (typeof u.cost === 'number' && Number.isFinite(u.cost)) {
        return `$${u.cost.toFixed(2)}`;
      }
      if (typeof u.tokens === 'number' && Number.isFinite(u.tokens)) {
        return `${u.tokens.toLocaleString()} tok`;
      }
    }
    return '—';
  }
</script>

<section class="overview" aria-label="Agent overview">
  <!-- Header: title + aggregate cost rollup + new-agent action. -->
  <header class="head">
    <div class="head-left">
      <h1 class="head-title">Agents</h1>
      <span class="head-count">{rows.length}</span>
    </div>

    <div class="head-right">
      <div class="rollup" title="Total cost across all agents and subagents">
        <span class="rollup-label">total</span>
        <span class="rollup-value" class:dim={totals.totalCost === null}>
          {cost(totals.totalCost)}
        </span>
      </div>
      <button type="button" class="new-agent" onclick={newAgent}>
        <span class="plus" aria-hidden="true">＋</span>
        New agent
      </button>
    </div>
  </header>

  <!-- The roster grid. Empty state when no app pane exists yet. -->
  {#if rows.length === 0}
    <div class="empty">
      <p>No agents yet.</p>
      <button type="button" class="new-agent" onclick={newAgent}>
        <span class="plus" aria-hidden="true">＋</span>
        New agent
      </button>
    </div>
  {:else}
    <div class="grid">
      {#each rows as row (row.paneId)}
        {@const subs = subagentsFor(row.paneId)}
        <!-- The card is a clickable region that navigates; the message box stops
             propagation so typing/sending never triggers navigation. -->
        <div
          class="card"
          class:needs-attention={isAttention(row.status)}
          role="button"
          tabindex="0"
          onclick={() => openAgent(row.paneId)}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openAgent(row.paneId);
            }
          }}
        >
          <div class="card-head">
            <span
              class="status-pill"
              class:working={row.status === 'working'}
              class:waiting={row.status === 'waiting'}
              class:finished={row.status === 'finished'}
              class:error={row.status === 'error'}
              class:idle={row.status === 'idle'}
            >
              <span class="status-dot" aria-hidden="true"></span>
              {statusLabel(row.status)}
            </span>
            <span class="model">{modelLabel(row.model)}</span>
          </div>

          <div class="name" title={row.cwd ?? row.name}>{row.name}</div>
          {#if row.cwd}
            <div class="cwd" title={row.cwd}>{row.cwd}</div>
          {/if}

          <div class="task" title={row.task ?? ''}>{row.task ?? '—'}</div>

          <!-- Context bar + cost. -->
          <div class="meter-row">
            <div
              class="context"
              class:unknown={row.contextPct === null}
              title={row.contextPct === null
                ? 'context unknown'
                : `context ${Math.round(row.contextPct)}%`}
            >
              {#if row.contextPct !== null}
                <div
                  class="context-fill"
                  style:width={`${Math.max(0, Math.min(100, row.contextPct))}%`}
                ></div>
              {/if}
            </div>
            <span class="ctx-pct">{pct(row.contextPct)}</span>
            <span class="cost" title="Session cost">{cost(row.cost)}</span>
          </div>

          <!-- Subagents nested under the parent agent. -->
          {#if subs.length > 0}
            <ul class="subagents">
              {#each subs as sub (sub.id)}
                <li class="subagent" title={sub.label ?? sub.id}>
                  <span class="sub-dot" aria-hidden="true"></span>
                  <span class="sub-label">{sub.label ?? sub.id}</span>
                  {#if sub.status}<span class="sub-status">{sub.status}</span>{/if}
                  <span class="sub-usage">{subUsage(sub)}</span>
                </li>
              {/each}
            </ul>
          {/if}

          <!-- Inline message box: Enter or Send delivers to the PTY. Clicks/keys
               here are stopped so they never navigate the card. -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="message"
            onclick={(e) => e.stopPropagation()}
            onkeydown={(e) => e.stopPropagation()}
          >
            <input
              class="message-input"
              type="text"
              placeholder="Message this agent…"
              aria-label={`Message ${row.name}`}
              bind:value={
                () => drafts[row.paneId] ?? '',
                (v) => (drafts = { ...drafts, [row.paneId]: v })
              }
              onkeydown={(e) => onMessageKey(e, row.paneId)}
            />
            <button
              type="button"
              class="send"
              aria-label="Send message"
              disabled={(drafts[row.paneId] ?? '').trim().length === 0}
              onclick={() => sendTo(row.paneId)}
            >
              Send
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .overview {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    height: 100%;
    width: 100%;
    min-height: 0;
    background: #0d1117;
    color: #e6edf3;
    overflow: hidden;
    font-family:
      ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }

  /* ---- Header ------------------------------------------------------------- */
  .head {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 16px 20px 12px;
    border-bottom: 1px solid #21262d;
  }
  .head-left {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  .head-title {
    margin: 0;
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .head-count {
    font-size: 12px;
    font-weight: 600;
    color: #8b949e;
    background: #161b22;
    border: 1px solid #21262d;
    border-radius: 10px;
    padding: 1px 8px;
  }
  .head-right {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .rollup {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-family:
      ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  }
  .rollup-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #6e7681;
  }
  .rollup-value {
    font-size: 14px;
    font-weight: 700;
    color: #3fb950;
  }
  .rollup-value.dim {
    color: #484f58;
    font-weight: 400;
  }

  .new-agent {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 12px;
    border: 1px solid #2ea043;
    border-radius: 7px;
    background: #238636;
    color: #ffffff;
    font-size: 12px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition:
      background 0.12s ease,
      border-color 0.12s ease;
  }
  .new-agent:hover {
    background: #2ea043;
    border-color: #3fb950;
  }
  .new-agent .plus {
    font-size: 13px;
    line-height: 1;
  }

  /* ---- Empty state -------------------------------------------------------- */
  .empty {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    color: #6e7681;
  }
  .empty p {
    margin: 0;
    font-size: 14px;
  }

  /* ---- Roster grid -------------------------------------------------------- */
  .grid {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 14px;
    padding: 16px 20px 24px;
    align-content: start;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px;
    border-radius: 12px;
    background: #161b22;
    box-shadow: inset 0 0 0 1px #21262d;
    cursor: pointer;
    transition:
      background 0.12s ease,
      box-shadow 0.12s ease,
      transform 0.12s ease;
  }
  .card:hover {
    background: #1c2128;
    box-shadow: inset 0 0 0 1px #30363d;
  }
  .card:focus-visible {
    outline: 2px solid #58a6ff;
    outline-offset: 2px;
  }
  /* needs-attention is the prominent one: an amber ring + subtle glow so a
     waiting agent jumps out of the grid. */
  .card.needs-attention {
    box-shadow:
      inset 0 0 0 1px #d29922,
      0 0 0 1px rgba(210, 153, 34, 0.35),
      0 0 18px rgba(210, 153, 34, 0.15);
    background: #1d1a12;
  }
  .card.needs-attention:hover {
    background: #241f14;
  }

  .card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .status-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 2px 8px;
    border-radius: 10px;
  }
  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }
  /* working — green, actively streaming. */
  .status-pill.working {
    color: #3fb950;
    background: rgba(63, 185, 80, 0.12);
  }
  /* waiting (needs input) — amber, the prominent "look at me" state. */
  .status-pill.waiting {
    color: #f0b429;
    background: rgba(210, 153, 34, 0.16);
  }
  /* finished — blue, the session ended cleanly. */
  .status-pill.finished {
    color: #58a6ff;
    background: rgba(88, 166, 255, 0.12);
  }
  /* error — red, the process exited non-zero. */
  .status-pill.error {
    color: #f85149;
    background: rgba(248, 81, 73, 0.14);
  }
  /* idle — gray, no runtime info yet. */
  .status-pill.idle {
    color: #8b949e;
    background: rgba(139, 148, 158, 0.1);
  }

  /* The prominent error highlight reuses needs-attention's ring but in red. */
  .card.needs-attention:has(.status-pill.error) {
    box-shadow:
      inset 0 0 0 1px #f85149,
      0 0 0 1px rgba(248, 81, 73, 0.35),
      0 0 18px rgba(248, 81, 73, 0.15);
    background: #1d1413;
  }
  .card.needs-attention:has(.status-pill.error):hover {
    background: #241715;
  }

  .model {
    font-size: 11px;
    font-weight: 500;
    color: #8b949e;
    font-family:
      ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 55%;
  }

  .name {
    font-size: 14px;
    font-weight: 600;
    color: #e6edf3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cwd {
    font-size: 11px;
    color: #6e7681;
    font-family:
      ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-top: -4px;
  }

  .task {
    font-size: 12px;
    color: #adbac7;
    line-height: 1.35;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    min-height: 16px;
  }

  .meter-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .context {
    flex: 1 1 auto;
    height: 6px;
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
  .ctx-pct {
    flex: 0 0 auto;
    font-size: 11px;
    color: #8b949e;
    font-variant-numeric: tabular-nums;
    min-width: 32px;
    text-align: right;
  }
  .cost {
    flex: 0 0 auto;
    font-size: 12px;
    font-weight: 600;
    color: #e6edf3;
    font-variant-numeric: tabular-nums;
    min-width: 48px;
    text-align: right;
  }

  /* ---- Subagents ---------------------------------------------------------- */
  .subagents {
    list-style: none;
    margin: 2px 0 0;
    padding: 8px 0 0;
    border-top: 1px solid #21262d;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .subagent {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 11px;
    color: #adbac7;
    min-width: 0;
  }
  .sub-dot {
    flex: 0 0 auto;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: #58a6ff;
  }
  .sub-label {
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family:
      ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  }
  .sub-status {
    flex: 0 0 auto;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #6e7681;
    background: #21262d;
    border-radius: 4px;
    padding: 1px 5px;
  }
  .sub-usage {
    flex: 0 0 auto;
    font-size: 10px;
    color: #6e7681;
    font-variant-numeric: tabular-nums;
  }

  /* ---- Message box -------------------------------------------------------- */
  .message {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 2px;
    cursor: default;
  }
  .message-input {
    flex: 1 1 auto;
    min-width: 0;
    height: 30px;
    padding: 0 10px;
    border: 1px solid #30363d;
    border-radius: 7px;
    background: #0d1117;
    color: #e6edf3;
    font-size: 12px;
    font-family: inherit;
    outline: none;
    transition: border-color 0.12s ease;
  }
  .message-input::placeholder {
    color: #6e7681;
  }
  .message-input:focus {
    border-color: #58a6ff;
  }
  .send {
    flex: 0 0 auto;
    height: 30px;
    padding: 0 12px;
    border: 1px solid #30363d;
    border-radius: 7px;
    background: #21262d;
    color: #e6edf3;
    font-size: 12px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition:
      background 0.12s ease,
      border-color 0.12s ease,
      opacity 0.12s ease;
  }
  .send:hover:not(:disabled) {
    background: #30363d;
    border-color: #58a6ff;
  }
  .send:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>
