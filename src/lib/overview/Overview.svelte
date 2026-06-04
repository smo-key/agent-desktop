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
  import {
    buildRoster,
    groupByLane,
    LANE_ORDER,
    type AgentStatus,
    type AgentLane
  } from './roster';
  import { toRosterWorkspaces, toNavWorkspaces } from './rosterInputs';
  import { runtimeMap } from './runtime';
  import { aggregate } from './usage';
  import { messageAgent } from './message';
  import { answerWithOption, answerWithText } from './answer';
  import { navigateTarget } from './navigate';
  import { subagents, type Subagent } from './subagents.svelte';
  import { activity } from './activity.svelte';
  import { events } from './events.svelte';
  import { view } from './view.svelte';
  import { projects } from '$lib/projects/projects.svelte';
  import { projectFilter } from '$lib/projects/projectFilter.svelte';
  import { filterRowsByProject } from '$lib/projects/projectRollup';
  import { projectForId } from '$lib/projects/projects';
  import ProjectPanel from '$lib/projects/ProjectPanel.svelte';
  import ProjectIcon from '$lib/icons/ProjectIcon.svelte';
  import ContextMenu, { type MenuItem } from '$lib/ui/ContextMenu.svelte';

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

  // Project the live workspace store into the framework-free roster + nav inputs
  // (shared with the Windows overview): each pane tagged with cwd / isApp /
  // projectId, and each workspace's root tree for click-to-navigate.
  const rosterWorkspaces = $derived(toRosterWorkspaces(workspace.workspaces));
  const navWorkspaces = $derived(toNavWorkspaces(workspace.workspaces));

  // The FULL live roster (every agent), recomputed when workspaces, snapshots, or
  // the clock change. `runtimeMap()` is a plain (non-reactive) read of the
  // imperative PTY-activity registry; the 1-second `nowMs` tick re-runs this so
  // each agent's status stays current without per-byte reactivity. `allRows` feeds
  // the project panel's counts; `rows` is the panel-filtered subset we render.
  const allRows = $derived(
    buildRoster(
      snapshots.byPane,
      rosterWorkspaces,
      runtimeMap(),
      nowMs,
      activity.bySession,
      undefined,
      events.activityMap()
    )
  );
  const rows = $derived(filterRowsByProject(allRows, projectFilter.selected));

  // The roster partitioned into the three control-room lanes (pure), ordered
  // top->bottom by how much each agent needs you. Empty lanes are skipped in the
  // template. Static lane metadata (title + glyph) drives each lane header.
  const grouped = $derived(groupByLane(rows));
  const LANES: Record<AgentLane, { title: string; glyph: string }> = {
    attn: { title: 'Needs attention', glyph: '!' },
    done: { title: 'Completed', glyph: '✓' },
    flight: { title: 'In flight', glyph: '▸' }
  };

  // Count of agents demanding the user's attention — surfaced in the header
  // subtitle (orange) as the at-a-glance "do I need to act" signal.
  const attnCount = $derived(grouped.attn.length);

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

  // Per-agent draft FREE-TEXT answer to a pending question, keyed by paneId.
  let answerDrafts = $state<Record<string, string>>({});

  /** Answer the agent's pending question by selecting option `i` (0-based). The
   *  hook clears the sidecar on answer, so the callout disappears on the next poll. */
  function pickOption(paneId: string, optionIndex: number) {
    answerWithOption(paneId, optionIndex);
  }

  /** Answer the agent's pending question with the user's own typed text. */
  function sendAnswer(paneId: string, optionCount: number) {
    const text = answerDrafts[paneId] ?? '';
    if (answerWithText(paneId, optionCount, text)) {
      answerDrafts = { ...answerDrafts, [paneId]: '' };
    }
  }

  function onAnswerKey(e: KeyboardEvent, paneId: string, optionCount: number) {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendAnswer(paneId, optionCount);
    }
  }

  // Per-lane collapse state. Completed agents are collapsed by DEFAULT (the user
  // doesn't want to see finished sessions' detail); click a lane head to toggle.
  let collapsedLanes = $state<Record<AgentLane, boolean>>({
    attn: false,
    flight: false,
    done: true
  });

  /** Whether an agent is alive (has a PTY to message) — not finished/errored. */
  function isAlive(status: AgentStatus): boolean {
    return status !== 'finished' && status !== 'error';
  }

  // Right-click context menu for an agent card.
  let menu = $state<{ open: boolean; x: number; y: number; items: MenuItem[] }>({
    open: false,
    x: 0,
    y: 0,
    items: []
  });

  function openAgentMenu(e: MouseEvent, paneId: string, name: string) {
    e.preventDefault();
    menu = {
      open: true,
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Open terminal', onClick: () => openAgent(paneId) },
        {
          label: 'Close session',
          danger: true,
          onClick: () => {
            const ok =
              typeof confirm === 'function'
                ? confirm(`Close "${name}"? Its terminal will be terminated.`)
                : true;
            if (ok) workspace.closeAgent(paneId);
          }
        }
      ]
    };
  }

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

  /** The card's activity line: the explicit in-progress task, else the agent's
   *  last message (transcript summary), else null (renders as "—"). */
  function activityLine(row: { task: string | null; summary: string | null }): string | null {
    return row.task ?? row.summary;
  }

  /** The {icon,color} for an agent's project avatar (neutral folder when none). */
  function projAvatar(projectId: string | null): { icon: string; color: string } {
    const p = projectForId(projects.list, projectId);
    return p ? { icon: p.icon, color: p.color } : { icon: 'folder', color: '#7B8499' };
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

  /** The status-badge variant class (mission-control semantic colors). */
  function badgeClass(status: AgentStatus): string {
    switch (status) {
      case 'working':
        return 'b-active';
      case 'waiting':
        return 'b-review';
      case 'finished':
        return 'b-nominal';
      case 'error':
        return 'b-abort';
      default:
        return 'b-standby';
    }
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

<div class="overview-shell">
  <!-- Shared project panel: filter the fleet by project + create projects. -->
  <ProjectPanel rows={allRows} />

  <section class="overview" aria-label="Agent overview">
  <!-- Control-room header: title + live agent count, an attention subtitle (the
       at-a-glance "do I need to act" signal, orange), the aggregate cost rollup,
       and the launch action (⌘N). Sticky so it stays put while lanes scroll. -->
  <header class="cr-head">
    <div class="cr-head-in">
      <img class="cr-logo" src="/logomark.svg" alt="" aria-hidden="true" />
      <div class="cr-titles">
        <h1 class="cr-title">Agents <span class="cr-count">{rows.length}</span></h1>
        <div class="cr-sub">
          {#if attnCount > 0}
            <b>{attnCount} need{attnCount === 1 ? 's' : ''} you</b>
          {:else}
            All agents running on their own
          {/if}
        </div>
      </div>

      <div class="cr-actions">
        <div class="rollup" title="Total cost across all agents and subagents">
          <span class="rollup-label">total</span>
          <span class="rollup-value" class:dim={totals.totalCost === null}>
            {cost(totals.totalCost)}
          </span>
        </div>
        <button type="button" class="btn btn-primary launch-btn" onclick={newAgent}>
          <span class="plus" aria-hidden="true">＋</span>
          Launch mission
          <span class="kbd">⌘N</span>
        </button>
      </div>
    </div>
  </header>

  <!-- The lanes. Empty state when no app pane exists yet, else one lane block per
       non-empty lane in attention -> completed -> in-flight order. -->
  {#if rows.length === 0}
    <div class="empty">
      <div class="empty-ic" aria-hidden="true">
        <img src="/logomark.svg" alt="" />
      </div>
      <h3>No agents yet</h3>
      <p>Launch a mission to dispatch your first agent.</p>
      <button type="button" class="btn btn-primary" onclick={newAgent}>
        <span class="plus" aria-hidden="true">＋</span>
        Launch mission
      </button>
    </div>
  {:else}
    <div class="lanes">
      {#each LANE_ORDER as lane (lane)}
        {@const laneRows = grouped[lane]}
        {#if laneRows.length > 0}
          {@const collapsed = collapsedLanes[lane]}
          <div class="lane {lane}">
            <button
              type="button"
              class="lane-head"
              aria-expanded={!collapsed}
              onclick={() => (collapsedLanes = { ...collapsedLanes, [lane]: !collapsed })}
            >
              <span class="lane-chevron" class:collapsed aria-hidden="true">▾</span>
              <span class="lane-ic" aria-hidden="true">{LANES[lane].glyph}</span>
              <span class="lane-title">{LANES[lane].title}</span>
              <span class="lane-ct">{laneRows.length}</span>
              <span class="lane-line" aria-hidden="true"></span>
            </button>

            {#if !collapsed}
            <div class="agrid">
              {#each laneRows as row (row.paneId)}
                {@const subs = subagentsFor(row.paneId)}
                {@const av = projAvatar(row.projectId)}
                <!-- The card is a clickable region that navigates; the message box
                     stops propagation so typing/sending never navigates. -->
                <div
                  class="acard {lane}"
                  class:error={row.status === 'error'}
                  role="button"
                  tabindex="0"
                  onclick={() => openAgent(row.paneId)}
                  oncontextmenu={(e) => openAgentMenu(e, row.paneId, row.name)}
                  onkeydown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openAgent(row.paneId);
                    }
                  }}
                >
                  <div class="ac-top">
                    <ProjectIcon icon={av.icon} color={av.color} size={30} />
                    <span class="name" title={row.name}>{row.name}</span>
                    <span class="badge {badgeClass(row.status)}">
                      <span class="sdot" aria-hidden="true"></span>
                      {statusLabel(row.status)}
                    </span>
                  </div>

                  <!-- A pending AskUserQuestion: the agent asked YOU and is waiting.
                       Shown as a prominent callout with its options (click to answer)
                       and a free-text field. Clicks/keys here stop propagation so
                       answering never navigates the card. The structured form drives
                       the FIRST pending question (the one on screen in the TUI); when
                       only the compact text is available we fall back to a plain
                       callout. -->
                  {#if row.questions && row.questions.length > 0}
                    {@const q = row.questions[0]}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div
                      class="qask"
                      onclick={(e) => e.stopPropagation()}
                      onkeydown={(e) => e.stopPropagation()}
                    >
                      <div class="qask-head">
                        <span class="qask-ic" aria-hidden="true">?</span>
                        {#if q.header}<span class="qask-tag">{q.header}</span>{/if}
                        <span class="qask-text">{q.question}</span>
                      </div>
                      {#if q.options.length > 0}
                        <div class="qopts">
                          {#each q.options as opt, i (i)}
                            <button
                              type="button"
                              class="qopt"
                              title={opt.description || opt.label}
                              onclick={() => pickOption(row.paneId, i)}
                            >
                              <span class="qopt-num" aria-hidden="true">{i + 1}</span>
                              <span class="qopt-body">
                                <span class="qopt-label">{opt.label}</span>
                                {#if opt.description}
                                  <span class="qopt-desc">{opt.description}</span>
                                {/if}
                              </span>
                            </button>
                          {/each}
                        </div>
                      {/if}
                      <div class="qreply">
                        <input
                          type="text"
                          placeholder="Or type your own answer…"
                          aria-label="Type your own answer"
                          bind:value={
                            () => answerDrafts[row.paneId] ?? '',
                            (v) => (answerDrafts = { ...answerDrafts, [row.paneId]: v })
                          }
                          onkeydown={(e) => onAnswerKey(e, row.paneId, q.options.length)}
                        />
                        <button
                          type="button"
                          class="icon-send"
                          aria-label="Send answer"
                          disabled={(answerDrafts[row.paneId] ?? '').trim().length === 0}
                          onclick={() => sendAnswer(row.paneId, q.options.length)}
                        >
                          ↥
                        </button>
                      </div>
                    </div>
                  {:else if row.question}
                    <div class="qask" title={row.question}>
                      <div class="qask-head">
                        <span class="qask-ic" aria-hidden="true">?</span>
                        <span class="qask-text">{row.question}</span>
                      </div>
                    </div>
                  {/if}

                  <!-- Activity: the in-progress task, else the agent's last message. -->
                  <div class="task" title={activityLine(row) ?? ''}>{activityLine(row) ?? '—'}</div>

                  <!-- Context bar (the segmented task strip's single-bar fallback). -->
                  <div class="bar" class:unknown={row.contextPct === null}>
                    {#if row.contextPct !== null}
                      <i
                        style:width={`${Math.max(0, Math.min(100, row.contextPct))}%`}
                      ></i>
                    {/if}
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

                  <!-- Telemetry footer: context % + session cost (mono). -->
                  <div class="ac-foot">
                    <span title="Context window used">ctx {pct(row.contextPct)}</span>
                    <span class="grow"></span>
                    <span class="cost" title="Session cost">{cost(row.cost)}</span>
                  </div>

                  <!-- Inline message box — only for LIVE agents (a finished or
                       errored agent has no PTY to message). Clicks/keys here are
                       stopped so they never navigate the card. -->
                  {#if isAlive(row.status)}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div
                      class="ac-reply"
                      onclick={(e) => e.stopPropagation()}
                      onkeydown={(e) => e.stopPropagation()}
                    >
                      <input
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
                        class="icon-send"
                        aria-label="Send message"
                        disabled={(drafts[row.paneId] ?? '').trim().length === 0}
                        onclick={() => sendTo(row.paneId)}
                      >
                        ↥
                      </button>
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
            {/if}
          </div>
        {/if}
      {/each}
    </div>
  {/if}
  </section>

  <ContextMenu
    open={menu.open}
    x={menu.x}
    y={menu.y}
    items={menu.items}
    onClose={() => (menu = { ...menu, open: false })}
  />
</div>

<style>
  /* Shell: project panel (fixed) + the overview surface (fills the rest). */
  .overview-shell {
    display: flex;
    flex-direction: row;
    flex: 1 1 auto;
    width: 100%;
    min-height: 0;
  }
  .overview-shell :global(.ppanel) {
    flex: 0 0 220px;
    width: 220px;
  }

  .overview {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-width: 0;
    height: 100%;
    min-height: 0;
    background: var(--space-850);
    color: var(--fg-1);
    overflow: hidden;
    font-family: var(--font-sans);
  }

  /* ---- Control-room header (sticky) -------------------------------------- */
  .cr-head {
    position: sticky;
    top: 0;
    z-index: 20;
    flex: 0 0 auto;
    background: rgba(13, 16, 23, 0.85);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--line-subtle);
    padding: 18px 32px;
  }
  .cr-head-in {
    max-width: 1080px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .cr-logo {
    width: 30px;
    height: 30px;
    flex: none;
  }
  .cr-titles {
    min-width: 0;
  }
  .cr-title {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 22px;
    letter-spacing: var(--tracking-tight);
    color: var(--fg-1);
    display: flex;
    align-items: baseline;
    gap: 9px;
    white-space: nowrap;
  }
  .cr-count {
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 500;
    color: var(--fg-3);
    background: var(--space-750);
    border: 1px solid var(--line-subtle);
    border-radius: var(--r-full);
    padding: 2px 9px;
  }
  .cr-sub {
    color: var(--fg-3);
    font-size: 13px;
    margin-top: 3px;
    white-space: nowrap;
  }
  .cr-sub b {
    color: var(--orange-300);
    font-weight: 600;
  }
  .cr-actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .rollup {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-family: var(--font-mono);
  }
  .rollup-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--fg-4);
  }
  .rollup-value {
    font-size: 14px;
    font-weight: 600;
    color: var(--nominal-500);
    font-variant-numeric: tabular-nums;
  }
  .rollup-value.dim {
    color: var(--fg-4);
    font-weight: 400;
  }

  /* ---- Buttons (shared mission-control look) ----------------------------- */
  .btn {
    font-family: var(--font-sans);
    font-weight: 600;
    font-size: 13px;
    border-radius: var(--r-md);
    padding: 9px 16px;
    border: 1px solid transparent;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    line-height: 1;
    white-space: nowrap;
    transition:
      background var(--dur-fast),
      border-color var(--dur-fast),
      transform var(--dur-fast);
  }
  .btn:active {
    transform: translateY(1px);
  }
  .btn-primary {
    background: var(--blue-500);
    color: #fff;
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.12) inset;
  }
  .btn-primary:hover {
    background: var(--blue-600);
  }
  .launch-btn .plus {
    font-size: 13px;
    line-height: 1;
  }
  .kbd {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.02em;
    background: rgba(255, 255, 255, 0.18);
    color: #fff;
    border-radius: 4px;
    padding: 2px 6px;
    margin-left: 1px;
  }

  /* ---- Empty state -------------------------------------------------------- */
  .empty {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    text-align: center;
    color: var(--fg-3);
    padding: 80px 20px;
  }
  .empty-ic {
    width: 56px;
    height: 56px;
    border-radius: var(--r-xl);
    background: var(--space-750);
    border: 1px solid var(--line-subtle);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .empty-ic img {
    width: 30px;
    height: 30px;
  }
  .empty h3 {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 600;
    color: var(--fg-1);
    font-size: 16px;
  }
  .empty p {
    margin: 0;
    font-size: 13px;
    max-width: 320px;
    color: var(--fg-3);
  }

  /* ---- Lanes -------------------------------------------------------------- */
  .lanes {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    max-width: 1080px;
    width: 100%;
    margin: 0 auto;
    padding: 6px 32px 60px;
  }
  .lane {
    margin-top: 30px;
  }
  .lane:first-child {
    margin-top: 18px;
  }
  .lane-head {
    display: flex;
    align-items: center;
    gap: 11px;
    margin-bottom: 14px;
    width: 100%;
    background: none;
    border: none;
    padding: 4px 0;
    cursor: pointer;
    text-align: left;
  }
  .lane-chevron {
    flex: none;
    color: var(--fg-4);
    font-size: 11px;
    line-height: 1;
    transition: transform var(--dur-fast);
  }
  .lane-chevron.collapsed {
    transform: rotate(-90deg);
  }
  .lane-head:hover .lane-title {
    color: var(--fg-1);
  }
  .lane-ic {
    width: 24px;
    height: 24px;
    border-radius: var(--r-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
    font-size: 13px;
    font-weight: 700;
    line-height: 1;
  }
  .lane.attn .lane-ic {
    background: var(--orange-tint);
    color: var(--orange-400);
  }
  .lane.done .lane-ic {
    background: rgba(255, 255, 255, 0.05);
    color: var(--fg-3);
  }
  .lane.flight .lane-ic {
    background: var(--blue-tint);
    color: var(--blue-300);
  }
  .lane-title {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 15px;
    letter-spacing: var(--tracking-tight);
    color: var(--fg-1);
    white-space: nowrap;
  }
  .lane-ct {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-4);
  }
  .lane-line {
    flex: 1;
    height: 1px;
    background: var(--line-faint);
  }

  .agrid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    align-items: start;
  }
  @media (max-width: 840px) {
    .agrid {
      grid-template-columns: 1fr;
    }
  }

  /* ---- Agent card --------------------------------------------------------- */
  .acard {
    background: var(--space-750);
    border: 1px solid var(--line-subtle);
    border-radius: var(--r-lg);
    padding: 16px 17px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    cursor: pointer;
    transition:
      border-color var(--dur-fast),
      background var(--dur-fast),
      transform var(--dur-fast);
  }
  .acard:hover {
    border-color: var(--line-default);
    background: var(--space-700);
    transform: translateY(-1px);
  }
  .acard:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  /* needs-attention: orange ring + a soft top gradient so it jumps out. */
  .acard.attn {
    border-color: rgba(238, 126, 77, 0.3);
    background: linear-gradient(180deg, rgba(238, 126, 77, 0.055), transparent 130px),
      var(--space-750);
  }
  .acard.attn:hover {
    border-color: rgba(238, 126, 77, 0.45);
  }
  /* errored agent: red ring instead of orange (still in the attention lane). */
  .acard.attn.error {
    border-color: rgba(242, 86, 75, 0.4);
    background: linear-gradient(180deg, rgba(242, 86, 75, 0.06), transparent 130px),
      var(--space-750);
  }
  .acard.done {
    background: var(--space-800);
  }
  .acard.flight {
    box-shadow: inset 0 0 0 1px rgba(61, 123, 255, 0.1);
  }

  .ac-top {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  /* Session name sits next to the project icon and takes the row, pushing the
     status badge to the right. */
  .ac-top .name {
    flex: 1;
    min-width: 0;
    font-weight: 600;
    font-size: 14px;
    color: var(--fg-1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Status badge (mono uppercase, semantic tint). */
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 4px 9px;
    border-radius: var(--r-full);
    white-space: nowrap;
  }
  .badge .sdot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
    flex: none;
  }
  .b-nominal {
    background: var(--nominal-tint);
    color: #6fe0a6;
  }
  .b-active {
    background: var(--blue-tint);
    color: var(--blue-300);
  }
  .b-review {
    background: var(--orange-tint);
    color: var(--orange-300);
  }
  .b-standby {
    background: rgba(255, 255, 255, 0.05);
    color: var(--fg-3);
  }
  .b-abort {
    background: var(--abort-tint);
    color: #ff8077;
  }

  /* Pending question callout (the agent is waiting on the user's answer). A column:
     the question head, the selectable options, then a free-text answer field. */
  .qask {
    display: flex;
    flex-direction: column;
    gap: 9px;
    padding: 10px 11px;
    border-radius: var(--r-md);
    background: var(--orange-tint);
    border: 1px solid rgba(238, 126, 77, 0.3);
  }
  .qask-head {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }
  .qask-ic {
    flex: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--orange-400);
    color: var(--space-900);
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 700;
    line-height: 16px;
    text-align: center;
  }
  .qask-tag {
    flex: none;
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--orange-300);
    background: rgba(238, 126, 77, 0.16);
    border-radius: 4px;
    padding: 2px 6px;
    line-height: 1.3;
  }
  .qask-text {
    font-size: 12.5px;
    line-height: 1.4;
    color: var(--orange-200);
    font-weight: 600;
  }

  /* The selectable options (click to answer). */
  .qopts {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .qopt {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    width: 100%;
    text-align: left;
    padding: 7px 9px;
    border-radius: var(--r-sm);
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--line-subtle);
    cursor: pointer;
    transition:
      background var(--dur-fast),
      border-color var(--dur-fast);
  }
  .qopt:hover {
    background: rgba(238, 126, 77, 0.12);
    border-color: rgba(238, 126, 77, 0.45);
  }
  .qopt:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .qopt-num {
    flex: none;
    width: 16px;
    height: 16px;
    border-radius: 4px;
    background: rgba(238, 126, 77, 0.2);
    color: var(--orange-200);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    line-height: 16px;
    text-align: center;
  }
  .qopt-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .qopt-label {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--fg-1);
    line-height: 1.3;
  }
  .qopt-desc {
    font-size: 11px;
    line-height: 1.35;
    color: var(--fg-3);
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  /* Free-text answer field inside the question callout. */
  .qreply {
    display: flex;
    gap: 8px;
  }
  .qreply input {
    flex: 1 1 auto;
    min-width: 0;
    font-family: var(--font-sans);
    font-size: 12.5px;
    color: var(--fg-1);
    background: rgba(20, 14, 10, 0.35);
    border: 1px solid rgba(238, 126, 77, 0.3);
    border-radius: var(--r-sm);
    padding: 7px 10px;
    outline: none;
    transition:
      border-color var(--dur-fast),
      box-shadow var(--dur-fast);
  }
  .qreply input::placeholder {
    color: var(--orange-300);
    opacity: 0.7;
  }
  .qreply input:focus {
    border-color: var(--orange-400);
    box-shadow: 0 0 0 3px rgba(238, 126, 77, 0.18);
  }

  .task {
    font-size: 13px;
    color: var(--fg-2);
    line-height: 1.45;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    min-height: 19px;
  }

  /* Context bar (single-bar fallback for the segmented task strip). */
  .bar {
    height: 5px;
    border-radius: 2px;
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
  .bar i {
    display: block;
    height: 100%;
    border-radius: 2px;
    background: linear-gradient(90deg, var(--blue-500), var(--blue-400));
    transition: width var(--dur-slow) var(--ease-out);
  }

  /* ---- Subagents ---------------------------------------------------------- */
  .subagents {
    list-style: none;
    margin: 0;
    padding: 10px 0 0;
    border-top: 1px solid var(--line-subtle);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .subagent {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 11px;
    color: var(--fg-2);
    min-width: 0;
  }
  .sub-dot {
    flex: none;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--blue-400);
  }
  .sub-label {
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
  }
  .sub-status {
    flex: none;
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fg-3);
    background: var(--space-700);
    border-radius: 4px;
    padding: 1px 5px;
  }
  .sub-usage {
    flex: none;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--fg-4);
    font-variant-numeric: tabular-nums;
  }

  /* ---- Telemetry footer --------------------------------------------------- */
  .ac-foot {
    display: flex;
    align-items: center;
    gap: 11px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
  }
  .ac-foot .grow {
    flex: 1;
  }
  .ac-foot .cost {
    color: var(--fg-1);
    font-weight: 500;
  }

  /* ---- Inline reply (message the agent) ----------------------------------- */
  .ac-reply {
    display: flex;
    gap: 8px;
    cursor: default;
  }
  .ac-reply input {
    flex: 1 1 auto;
    min-width: 0;
    font-family: var(--font-sans);
    font-size: 13px;
    color: var(--fg-1);
    background: rgba(56, 65, 85, 0.35);
    border: 1px solid var(--line-default);
    border-radius: var(--r-md);
    padding: 9px 12px;
    outline: none;
    transition:
      border-color var(--dur-fast),
      box-shadow var(--dur-fast);
  }
  .ac-reply input::placeholder {
    color: var(--fg-4);
  }
  .ac-reply input:focus {
    border-color: var(--blue-500);
    box-shadow: var(--focus-ring);
  }
  .icon-send {
    width: 38px;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--r-md);
    background: var(--blue-500);
    color: #fff;
    border: none;
    cursor: pointer;
    font-size: 15px;
    line-height: 1;
    transition: background var(--dur-fast);
  }
  .icon-send:hover:not(:disabled) {
    background: var(--blue-600);
  }
  .icon-send:disabled {
    background: var(--space-600);
    color: var(--fg-4);
    cursor: not-allowed;
  }
</style>
