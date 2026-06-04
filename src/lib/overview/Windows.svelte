<script lang="ts">
  // The "TERMINAL WINDOWS" overview — an alternate to the card Overview. Instead of
  // cards it shows a wall of compact terminal-style windows, one per agent, each a
  // deliberately HIGH-LEVEL abstraction of Claude Code: a status badge, the project
  // identity, a LIMITED LIVE TAIL of the agent's terminal (the last few lines,
  // already ANSI-parsed by xterm via `getTerminal(paneId).readTail`), a telemetry
  // line, a message box (writes to the PTY), and a "dig in" action that opens the
  // real terminal in the grid. It never renders the full TUI and never instantiates
  // a terminal of its own (it reads the already-mounted grid xterm buffers), so the
  // WebGL context cap is irrelevant.
  //
  // It shares the project panel + filter + the roster projection with the card
  // Overview; all decision logic is the same PURE cores (buildRoster, laneOf,
  // filterRowsByProject, tailLines, messageAgent, navigateTarget).

  import { workspace } from '$lib/layout/workspace.svelte';
  import { snapshots } from '$lib/usage/snapshots.svelte';
  import { launcher } from '$lib/launcher/launcherStore.svelte';
  import { buildRoster, laneOf, type AgentStatus, type AgentRow } from './roster';
  import { toRosterWorkspaces, toNavWorkspaces } from './rosterInputs';
  import { runtimeMap } from './runtime';
  import { messageAgent } from './message';
  import { navigateTarget } from './navigate';
  import { activity } from './activity.svelte';
  import { events } from './events.svelte';
  import { view } from './view.svelte';
  import { getTerminal } from '$lib/layout/terminals';
  import { projects } from '$lib/projects/projects.svelte';
  import { projectFilter } from '$lib/projects/projectFilter.svelte';
  import { filterRowsByProject } from '$lib/projects/projectRollup';
  import { projectForId } from '$lib/projects/projects';
  import ProjectPanel from '$lib/projects/ProjectPanel.svelte';
  import ProjectIcon from '$lib/icons/ProjectIcon.svelte';
  import Icon from '$lib/icons/Icon.svelte';
  import ContextMenu, { type MenuItem } from '$lib/ui/ContextMenu.svelte';

  /** How many trailing terminal lines each window shows. */
  const TAIL_LINES = 6;

  // 1-second clock: re-derives status AND re-reads each agent's terminal tail so
  // the windows track the live terminals without per-byte reactivity.
  let nowMs = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => {
      nowMs = Date.now();
    }, 1000);
    return () => clearInterval(id);
  });

  const rosterWorkspaces = $derived(toRosterWorkspaces(workspace.workspaces));
  const navWorkspaces = $derived(toNavWorkspaces(workspace.workspaces));

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

  // Panel-filtered, then ordered by how much each agent needs you: needs-attention
  // first, then in-flight, then completed (so the live wall reads top-down).
  const LANE_PRIORITY: Record<'attn' | 'done' | 'flight', number> = {
    attn: 0,
    flight: 1,
    done: 2
  };
  const rows = $derived(
    [...filterRowsByProject(allRows, projectFilter.selected)].sort(
      (a, b) => LANE_PRIORITY[laneOf(a.status)] - LANE_PRIORITY[laneOf(b.status)]
    )
  );

  // Per-agent draft message text, keyed by paneId. Cleared on a successful send.
  let drafts = $state<Record<string, string>>({});

  // Finished windows are COLLAPSED by default (header only) so completed sessions'
  // detail is hidden; clicking a finished window's bar expands it. Other statuses
  // are always expanded.
  let expanded = $state<Record<string, boolean>>({});
  function isCollapsed(paneId: string, status: AgentStatus): boolean {
    return laneOf(status) === 'done' && !expanded[paneId];
  }
  function toggle(paneId: string) {
    expanded = { ...expanded, [paneId]: !expanded[paneId] };
  }

  /** Whether an agent is alive (has a PTY to message) — not finished/errored. */
  function isAlive(status: AgentStatus): boolean {
    return status !== 'finished' && status !== 'error';
  }

  // Right-click context menu for an agent window.
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
        { label: 'Open terminal', onClick: () => digIn(paneId) },
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

  /** The limited live tail for an agent (re-read every clock tick via `nowMs`). */
  function tailFor(paneId: string): string[] {
    void nowMs; // re-run each tick
    return getTerminal(paneId)?.readTail(TAIL_LINES) ?? [];
  }

  /** Dig in: open the agent's real terminal in the grid (activate + focus). */
  function digIn(paneId: string) {
    const target = navigateTarget(navWorkspaces, paneId);
    if (!target) return;
    workspace.setActiveWorkspace(target.workspaceId);
    workspace.setFocusIn(target.workspaceId, target.leafId);
    view.show('grid');
  }

  function sendTo(paneId: string) {
    const text = drafts[paneId] ?? '';
    if (messageAgent(paneId, text)) {
      drafts = { ...drafts, [paneId]: '' };
    }
  }

  function onMessageKey(e: KeyboardEvent, paneId: string) {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendTo(paneId);
    }
  }

  function newAgent() {
    launcher.show();
  }

  // ---- Display helpers ------------------------------------------------------
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
  function projAvatar(projectId: string | null): { icon: string; color: string } {
    const p = projectForId(projects.list, projectId);
    return p ? { icon: p.icon, color: p.color } : { icon: 'folder', color: '#7B8499' };
  }
  function shortCwd(cwd: string | null): string {
    if (!cwd) return '';
    return cwd.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? '';
  }
  function pct(value: number | null): string {
    return value === null ? '—' : `${Math.round(value)}%`;
  }
  function cost(value: number | null): string {
    return value === null ? '—' : `$${value.toFixed(2)}`;
  }
  const attnCount = $derived(allRows.filter((r: AgentRow) => laneOf(r.status) === 'attn').length);
</script>

<div class="overview-shell">
  <ProjectPanel rows={allRows} />

  <section class="windows" aria-label="Agent terminal windows">
    <header class="cr-head">
      <div class="cr-head-in">
        <img class="cr-logo" src="/logomark.svg" alt="" aria-hidden="true" />
        <div class="cr-titles">
          <h1 class="cr-title">Agents <span class="cr-count">{rows.length}</span></h1>
          <div class="cr-sub">
            {#if attnCount > 0}
              <b>{attnCount} need{attnCount === 1 ? 's' : ''} you</b>
            {:else}
              Live terminals · abstracted
            {/if}
          </div>
        </div>
        <div class="cr-actions">
          <button type="button" class="btn btn-primary launch-btn" onclick={newAgent}>
            <span class="plus" aria-hidden="true">＋</span>
            Launch mission
            <span class="kbd">⌘N</span>
          </button>
        </div>
      </div>
    </header>

    {#if rows.length === 0}
      <div class="empty">
        <div class="empty-ic" aria-hidden="true"><img src="/logomark.svg" alt="" /></div>
        <h3>No agents yet</h3>
        <p>Launch a mission to dispatch your first agent.</p>
        <button type="button" class="btn btn-primary" onclick={newAgent}>
          <span class="plus" aria-hidden="true">＋</span>
          Launch mission
        </button>
      </div>
    {:else}
      <div class="wall">
        {#each rows as row (row.paneId)}
          {@const av = projAvatar(row.projectId)}
          {@const collapsed = isCollapsed(row.paneId, row.status)}
          {@const done = laneOf(row.status) === 'done'}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="term"
            class:attn={laneOf(row.status) === 'attn'}
            class:collapsed
            oncontextmenu={(e) => openAgentMenu(e, row.paneId, row.name)}
          >
            <!-- Title bar (a finished window's bar toggles its collapse). -->
            <button
              type="button"
              class="term-bar"
              class:toggle={done}
              aria-expanded={done ? !collapsed : undefined}
              onclick={() => done && toggle(row.paneId)}
            >
              {#if done}
                <span class="bar-chevron" class:collapsed aria-hidden="true">▾</span>
              {:else}
                <span class="dots" aria-hidden="true">
                  <span class="d r"></span><span class="d y"></span><span class="d g"></span>
                </span>
              {/if}
              <ProjectIcon icon={av.icon} color={av.color} size={18} radius="var(--r-xs)" />
              <span class="who" title={row.cwd ?? row.name}>
                {row.name}{#if shortCwd(row.cwd)}<span class="cwd"> · {shortCwd(row.cwd)}</span>{/if}
              </span>
              <span class="badge {badgeClass(row.status)}">
                <span class="sdot" aria-hidden="true"></span>
                {statusLabel(row.status)}
              </span>
            </button>

            {#if !collapsed}
              {@const tail = tailFor(row.paneId)}
              <!-- A pending AskUserQuestion banner: the agent is waiting on you. -->
              {#if row.question}
                <div class="qask" title={row.question}>
                  <span class="qask-ic" aria-hidden="true">?</span>
                  <span class="qask-text">{row.question}</span>
                </div>
              {/if}
              <!-- Limited live tail (high-level glimpse; not the full TUI) -->
              <div class="term-body">
                {#if tail.length === 0}
                  <div class="tline mut">starting…</div>
                {:else}
                  {#each tail as line, i (i)}
                    <div class="tline">{line || ' '}</div>
                  {/each}
                {/if}
              </div>

              <!-- Telemetry -->
              <div class="term-foot">
                <span title="Context window used">ctx {pct(row.contextPct)}</span>
                <span class="grow"></span>
                <span class="cost" title="Session cost">{cost(row.cost)}</span>
              </div>

              <!-- Message (live agents only) + dig in -->
              <div class="term-input">
                {#if isAlive(row.status)}
                  <span class="chev" aria-hidden="true">›</span>
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
                    class="icon-btn send"
                    aria-label="Send message"
                    disabled={(drafts[row.paneId] ?? '').trim().length === 0}
                    onclick={() => sendTo(row.paneId)}
                  >
                    <Icon name="arrow-up" size={15} color="#fff" />
                  </button>
                {:else}
                  <span class="chev dim" aria-hidden="true">·</span>
                  <span class="ended">session ended</span>
                {/if}
                <button
                  type="button"
                  class="icon-btn dig"
                  aria-label="Open full terminal"
                  title="Open full terminal"
                  onclick={() => digIn(row.paneId)}
                >
                  <Icon name="arrow-up-right" size={15} />
                </button>
              </div>
            {/if}
          </div>
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

  .windows {
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

  /* ---- header (shared look with the card overview) ---- */
  .cr-head {
    position: sticky;
    top: 0;
    z-index: 20;
    flex: 0 0 auto;
    background: rgba(13, 16, 23, 0.85);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--line-subtle);
    padding: 18px 28px;
  }
  .cr-head-in {
    max-width: 1280px;
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
  .cr-title {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 22px;
    letter-spacing: var(--tracking-tight);
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
  }
  .kbd {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    background: rgba(255, 255, 255, 0.18);
    color: #fff;
    border-radius: 4px;
    padding: 2px 6px;
  }

  /* ---- empty state ---- */
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
  }

  /* ---- the wall of terminal windows ---- */
  .wall {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    max-width: 1280px;
    width: 100%;
    margin: 0 auto;
    padding: 18px 28px 60px;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
    gap: 16px;
    align-content: start;
  }

  .term {
    display: flex;
    flex-direction: column;
    background: #070a0f;
    border: 1px solid var(--line-default);
    border-radius: var(--r-lg);
    overflow: hidden;
    transition: border-color var(--dur-fast);
  }
  .term.attn {
    border-color: rgba(238, 126, 77, 0.4);
  }

  .term-bar {
    height: 36px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 0 12px;
    width: 100%;
    background: var(--space-900);
    border: none;
    border-bottom: 1px solid var(--line-subtle);
    text-align: left;
    font: inherit;
    color: inherit;
    cursor: default;
  }
  .term.collapsed .term-bar {
    border-bottom: none;
  }
  .term-bar.toggle {
    cursor: pointer;
  }
  .term-bar.toggle:hover {
    background: var(--space-850);
  }
  .bar-chevron {
    flex: none;
    color: var(--fg-4);
    font-size: 11px;
    line-height: 1;
    width: 18px;
    text-align: center;
    transition: transform var(--dur-fast);
  }
  .bar-chevron.collapsed {
    transform: rotate(-90deg);
  }
  .chev.dim {
    color: var(--fg-4);
  }
  .ended {
    flex: 1;
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--fg-4);
    font-style: italic;
  }
  .dots {
    display: flex;
    gap: 6px;
    flex: none;
  }
  .dots .d {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }
  .dots .r {
    background: #ed6a5e;
  }
  .dots .y {
    background: #f4be4f;
  }
  .dots .g {
    background: #61c554;
  }
  .who {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 13px;
    color: var(--fg-1);
  }
  .who .cwd {
    font-family: var(--font-mono);
    font-weight: 400;
    font-size: 11px;
    color: var(--fg-4);
  }

  /* Pending-question banner (the agent is waiting on the user's answer). */
  .qask {
    flex: none;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 9px 14px;
    background: var(--orange-tint);
    border-bottom: 1px solid rgba(238, 126, 77, 0.3);
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
  .qask-text {
    font-size: 12px;
    line-height: 1.4;
    color: var(--orange-200);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .term-body {
    flex: 1 1 auto;
    min-height: 96px;
    max-height: 150px;
    overflow: hidden;
    padding: 12px 14px;
    font-family: var(--font-mono);
    font-size: 11.5px;
    line-height: 1.6;
  }
  .tline {
    color: var(--fg-2);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    margin: 0;
  }
  .tline.mut {
    color: var(--fg-4);
    font-style: italic;
  }

  .term-foot {
    flex: none;
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 7px 14px;
    border-top: 1px solid var(--line-subtle);
    background: var(--space-900);
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
  }
  .term-foot .grow {
    flex: 1;
  }
  .term-foot .cost {
    color: var(--fg-1);
    font-weight: 500;
  }

  .term-input {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 12px;
    border-top: 1px solid var(--line-subtle);
    background: var(--space-900);
  }
  .term-input .chev {
    font-family: var(--font-mono);
    color: var(--blue-300);
    font-size: 14px;
    flex: none;
  }
  .term-input input {
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    outline: none;
    font-family: var(--font-mono);
    font-size: 12.5px;
    color: var(--fg-1);
  }
  .term-input input::placeholder {
    color: var(--fg-4);
  }
  .icon-btn {
    width: 30px;
    height: 28px;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--r-sm);
    border: 1px solid var(--line-default);
    background: var(--space-800);
    color: var(--fg-2);
    cursor: pointer;
    transition:
      background var(--dur-fast),
      border-color var(--dur-fast);
  }
  .icon-btn.send {
    background: var(--blue-500);
    border-color: transparent;
  }
  .icon-btn.send:hover:not(:disabled) {
    background: var(--blue-600);
  }
  .icon-btn.send:disabled {
    background: var(--space-600);
    cursor: not-allowed;
  }
  .icon-btn.dig:hover {
    background: var(--space-700);
    border-color: var(--blue-500);
    color: var(--fg-1);
  }

  /* ---- status badge (shared semantic look) ---- */
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: 9.5px;
    font-weight: 500;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 3px 8px;
    border-radius: var(--r-full);
    white-space: nowrap;
    flex: none;
  }
  .badge .sdot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: currentColor;
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
</style>
