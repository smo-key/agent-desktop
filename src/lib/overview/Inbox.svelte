<!-- src/lib/overview/Inbox.svelte -->
<script lang="ts">
  // The INBOX — the primary overview surface (replaces the lane-of-cards
  // Overview). Left: a grouped roster of every agent (Needs you / In flight /
  // Completed), each a row with a status circle. Right: a single focus pane —
  // a thin header, then the SELECTED agent's live terminal (auto-focused +
  // scrolled to bottom; no footer), or an "All clear" panel when nothing needs
  // you and nothing is open.
  //
  // The live terminal is NOT re-mounted here: the single mounted workspace
  // surface (all PaneNodes/PTYs, owned by +page) is teleported into `focusSlot`
  // via surfaceSlot + the portal action. Selecting an agent is just
  // setActiveWorkspace + setFocusIn — the existing display:none workspace swap —
  // so no PTY is ever double-spawned. All selection logic is pure (inbox.ts).

  import { tick } from 'svelte';
  import { workspace } from '$lib/layout/workspace.svelte';
  import { snapshots } from '$lib/usage/snapshots.svelte';
  import { launcher } from '$lib/launcher/launcherStore.svelte';
  import { surfaceSlot } from '$lib/layout/surfaceSlot.svelte';
  import { focusTerminal, scrollTerminalToBottom } from '$lib/layout/terminals';
  import {
    buildRoster,
    groupByLane,
    LANE_ORDER,
    type AgentLane,
    type AgentRow,
    type AgentStatus
  } from './roster';
  import { isAttention, attentionQueue, resolveFocus, nextInQueue, shouldClearPin } from './inbox';
  import { toRosterWorkspaces, toNavWorkspaces } from './rosterInputs';
  import { runtimeMap } from './runtime';
  import { navigateTarget } from './navigate';
  import { activity } from './activity.svelte';
  import { events } from './events.svelte';
  import { titles } from './titles.svelte';
  import { view } from './view.svelte';
  import { projects } from '$lib/projects/projects.svelte';
  import { projectFilter } from '$lib/projects/projectFilter.svelte';
  import { filterRowsByProject } from '$lib/projects/projectRollup';
  import { projectForId } from '$lib/projects/projects';
  import ProjectPanel from '$lib/projects/ProjectPanel.svelte';
  import ProjectIcon from '$lib/icons/ProjectIcon.svelte';

  // 1-second clock so working -> waiting flips as the PTY goes quiet (matches the
  // old Overview). Epoch ms to match the runtime registry.
  let nowMs = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => (nowMs = Date.now()), 1000);
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
  const rows = $derived(filterRowsByProject(allRows, projectFilter.selected));

  const grouped = $derived(groupByLane(rows));
  const queue = $derived(attentionQueue(rows));
  const attnCount = $derived(queue.length);

  // Group metadata (label) for the left list, in attn -> flight -> done order.
  const LANES: Record<AgentLane, { title: string }> = {
    attn: { title: 'Needs you' },
    flight: { title: 'In flight' },
    done: { title: 'Completed' }
  };

  // The user's explicit selection (a watched agent), or null to let the queue drive.
  let userSelected = $state<string | null>(null);

  // The focused agent (pure): user selection > attention queue > none.
  const focus = $derived(resolveFocus(rows, userSelected));

  // Drive the live surface from the focused agent: activate its workspace + focus
  // its leaf (the existing display:none swap), then point the teleport target at
  // our focus slot. With no focus, clear the target so the surface goes home
  // (hidden) and the empty panel shows. Also auto-focus the terminal + scroll to
  // bottom on entry.
  let focusSlot = $state<HTMLDivElement | null>(null);
  let lastFocusId: string | null = null;
  let lastFocusStatus: AgentStatus | null = null;

  $effect(() => {
    const f = focus;
    if (!f || !focusSlot) {
      surfaceSlot.clear();
      lastFocusId = null;
      lastFocusStatus = null;
      return;
    }
    // Address-advance: if the pinned agent just left attention, drop the pin so
    // resolveFocus moves to the next in the queue on the next pass.
    if (
      lastFocusId === f.paneId &&
      lastFocusStatus !== null &&
      shouldClearPin(lastFocusStatus, f.status, userSelected === f.paneId)
    ) {
      userSelected = null;
    }

    // Point the surface at this agent's workspace/leaf and teleport it into the slot.
    const target = navigateTarget(navWorkspaces, f.paneId);
    if (target) {
      workspace.setActiveWorkspace(target.workspaceId);
      workspace.setFocusIn(target.workspaceId, target.leafId);
    }
    surfaceSlot.set(focusSlot);

    // On ENTRY to a new agent, focus its terminal + pin to the bottom (after the
    // display swap + fit settle).
    if (lastFocusId !== f.paneId) {
      const id = f.paneId;
      void tick().then(() =>
        requestAnimationFrame(() => {
          scrollTerminalToBottom(id);
          focusTerminal(id);
        })
      );
    }
    lastFocusId = f.paneId;
    lastFocusStatus = f.status;
  });

  // Release the teleport target when the inbox is torn down (view -> grid) so the
  // surface returns to the grid body.
  $effect(() => () => surfaceSlot.clear());

  /** Select (watch) an agent: pin it as the focused row. */
  function selectAgent(paneId: string) {
    userSelected = paneId;
  }

  /** Step through the attention queue from the header ↑/↓ controls. */
  function stepQueue(dir: 1 | -1) {
    const next = nextInQueue(rows, focus?.paneId ?? null, dir);
    if (next) userSelected = next;
  }

  /** Expand the focused agent into the full terminal grid. */
  function expandToGrid() {
    const f = focus;
    if (!f) return;
    const target = navigateTarget(navWorkspaces, f.paneId);
    if (!target) return;
    workspace.setActiveWorkspace(target.workspaceId);
    workspace.setFocusIn(target.workspaceId, target.leafId);
    view.show('grid');
  }

  function newAgent() {
    launcher.show();
  }

  // ---- Display helpers ------------------------------------------------------

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

  function badgeClass(status: AgentStatus): string {
    if (status === 'working') return 'b-active';
    if (status === 'error') return 'b-abort';
    if (isAttention(status)) return 'b-review';
    if (status === 'finished') return 'b-nominal';
    return 'b-standby';
  }

  /** The secondary line for a roster row: question / current action / cost·model. */
  function rowSub(r: AgentRow): string {
    if (isAttention(r.status)) {
      if (r.status === 'error') return 'Errored — needs you';
      if (r.questions && r.questions.length > 0) return r.questions[0].question;
      return r.question ?? 'Needs input';
    }
    if (r.status === 'finished') return cost(r.cost);
    return r.currentAction ?? r.summary ?? 'Working…';
  }

  /** The focus header's state chip text. */
  function focusChip(r: AgentRow): string {
    if (isAttention(r.status)) {
      const i = queue.findIndex((q) => q.paneId === r.paneId);
      return `needs you · ${i >= 0 ? i + 1 : 1}/${queue.length}`;
    }
    if (r.status === 'finished') return 'finished';
    return 'watching';
  }
</script>

<div class="inbox-shell">
  <ProjectPanel rows={allRows} />

  <section class="inbox" aria-label="Agent inbox">
    <!-- LEFT: grouped roster -->
    <div class="col-list">
      <div class="lh">
        <img class="logo" src="/logomark.svg" alt="" aria-hidden="true" />
        <h1>Agents <span class="count">{rows.length}</span></h1>
        <span class="sub">
          {#if attnCount > 0}{attnCount} need{attnCount === 1 ? 's' : ''} you{:else}all clear{/if}
        </span>
        <button type="button" class="launch" onclick={newAgent} title="Launch a new agent (⌘N)">＋</button>
      </div>

      {#if rows.length === 0}
        <div class="empty-list">
          <p>No agents yet.</p>
          <button type="button" class="btn-primary" onclick={newAgent}>＋ Launch mission</button>
        </div>
      {:else}
        <div class="list-scroll">
          {#each LANE_ORDER as lane (lane)}
            {@const items = grouped[lane]}
            {#if items.length > 0}
              <div class="group-h {lane}">
                {LANES[lane].title} <span class="gn">· {items.length}</span><span class="rule"></span>
              </div>
              {#each items as r (r.paneId)}
                <button
                  type="button"
                  class="row {lane}"
                  class:sel={focus?.paneId === r.paneId}
                  onclick={() => selectAgent(r.paneId)}
                >
                  <ProjectIcon {...projAvatar(r.projectId)} size={30} />
                  <span class="nm">
                    <span class="t">{titles.titleFor(r.paneId) ?? r.name}</span>
                    <span class="s" class:q={isAttention(r.status)} title={rowSub(r)}>{rowSub(r)}</span>
                  </span>
                  <span class="badge {badgeClass(r.status)} dotonly"><span class="dot"></span></span>
                </button>
              {/each}
            {/if}
          {/each}
        </div>
      {/if}
    </div>

    <!-- RIGHT: focus pane (header + teleported live TUI / All clear) -->
    <div class="col-focus">
      {#if focus}
        {@const av = projAvatar(focus.projectId)}
        <div class="fhead">
          <ProjectIcon {...av} size={26} />
          <span class="ttl">{titles.titleFor(focus.paneId) ?? focus.name}</span>
          <span class="chip {badgeClass(focus.status)}">{focusChip(focus)}</span>
          <span class="spc"></span>
          <span class="meta">
            <span class="ctxmini" class:unknown={focus.contextPct === null}>
              <span class="track">
                {#if focus.contextPct !== null}<i style:width={`${Math.max(0, Math.min(100, focus.contextPct))}%`}></i>{/if}
              </span>
              {pct(focus.contextPct)}
            </span>
            <span class="cost">{cost(focus.cost)}</span>
          </span>
          {#if isAttention(focus.status) && queue.length > 1}
            <span class="nav">
              <button type="button" onclick={() => stepQueue(-1)} title="Previous">↑</button>
              <button type="button" onclick={() => stepQueue(1)} title="Next">↓</button>
            </span>
          {/if}
          <button type="button" class="iconbtn" onclick={expandToGrid} title="Expand to grid">⤢</button>
        </div>
        <!-- The single mounted workspace surface is teleported in here. -->
        <div class="focus-slot" class:attn={isAttention(focus.status)} bind:this={focusSlot}></div>
      {:else}
        <div class="fhead">
          <span class="chip b-nominal">inbox zero</span>
          <span class="ttl muted">Nothing needs you</span>
          <span class="spc"></span>
        </div>
        <div class="empty">
          <div class="ring">✓</div>
          <h3>All clear</h3>
          <p>No agent is waiting on you. The next one that needs input lands here automatically — or pick any agent on the left to watch its terminal.</p>
        </div>
        <!-- Slot still bound so a fresh attention agent can teleport in without a remount. -->
        <div class="focus-slot hidden" bind:this={focusSlot}></div>
      {/if}
    </div>
  </section>
</div>

<style>
  .inbox-shell { display: flex; flex-direction: row; flex: 1 1 auto; width: 100%; min-height: 0; }
  .inbox-shell :global(.ppanel) { flex: 0 0 220px; width: 220px; }
  .inbox {
    display: grid; grid-template-columns: 360px 1fr;
    flex: 1 1 auto; min-width: 0; height: 100%; min-height: 0;
    background: var(--space-850); color: var(--fg-1); font-family: var(--font-sans);
  }

  .col-list { border-right: 1px solid var(--line-subtle); background: var(--space-900); display: flex; flex-direction: column; min-height: 0; }
  .lh { display: flex; align-items: center; gap: 10px; padding: 15px 16px 11px; flex: none; }
  .lh .logo { width: 22px; height: 22px; }
  .lh h1 { font-family: var(--font-display); font-weight: 600; font-size: 17px; margin: 0; display: flex; align-items: baseline; gap: 8px; }
  .lh .count { font-family: var(--font-mono); font-size: 11px; color: var(--fg-3); background: var(--space-750); border: 1px solid var(--line-subtle); border-radius: var(--r-full); padding: 2px 8px; }
  .lh .sub { font-size: 12px; color: var(--orange-300); font-weight: 600; }
  .lh .launch { margin-left: auto; font-family: var(--font-sans); font-weight: 700; font-size: 15px; color: #fff; background: var(--blue-500); border: none; border-radius: var(--r-md); width: 30px; height: 30px; cursor: pointer; }
  .list-scroll { overflow-y: auto; flex: 1; min-height: 0; padding-bottom: 20px; }
  .empty-list { padding: 40px 18px; text-align: center; color: var(--fg-3); display: flex; flex-direction: column; gap: 12px; }

  .group-h { display: flex; align-items: center; gap: 8px; padding: 14px 16px 6px; font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: var(--tracking-label); }
  .group-h.attn { color: var(--orange-300); }
  .group-h.flight { color: var(--blue-300); }
  .group-h.done { color: var(--fg-4); }
  .group-h .gn { color: var(--fg-4); }
  .group-h .rule { flex: 1; height: 1px; background: var(--line-faint); }

  .row { display: flex; align-items: center; gap: 11px; width: 100%; text-align: left; padding: 10px 16px; cursor: pointer; border: none; border-left: 2px solid transparent; background: none; transition: background var(--dur-fast); }
  .row:hover { background: rgba(255,255,255,0.025); }
  .row.sel { background: rgba(61,123,255,0.10); border-left-color: var(--blue-500); }
  .row.attn.sel { background: var(--orange-tint); border-left-color: var(--orange-500); }
  .row .nm { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .row .nm .t { font-weight: 600; font-size: 13px; color: var(--fg-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row .nm .s { font-size: 11px; color: var(--fg-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 1px; }
  .row .nm .s.q { color: var(--orange-300); }

  .col-focus { background: var(--space-850); min-width: 0; display: flex; flex-direction: column; min-height: 0; }
  .fhead { flex: none; display: flex; align-items: center; gap: 11px; padding: 11px 18px; border-bottom: 1px solid var(--line-subtle); background: var(--space-900); }
  .fhead .ttl { font-weight: 600; font-size: 13.5px; color: var(--fg-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .fhead .ttl.muted { color: var(--fg-3); font-weight: 500; }
  .fhead .chip { font-family: var(--font-mono); font-size: 10px; border-radius: var(--r-full); padding: 3px 9px; white-space: nowrap; flex: none; }
  .fhead .spc { flex: 1; }
  .fhead .meta { display: flex; align-items: center; gap: 12px; flex: none; }
  .fhead .nav { display: flex; gap: 4px; flex: none; }
  .fhead .nav button, .fhead .iconbtn { width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--r-sm); background: var(--space-750); border: 1px solid var(--line-subtle); color: var(--fg-3); cursor: pointer; font-size: 13px; }
  .fhead .nav button:hover, .fhead .iconbtn:hover { color: var(--fg-1); border-color: var(--line-default); }

  .focus-slot { flex: 1; min-height: 0; display: flex; padding: 10px; }
  /* The teleported surface fills the slot. */
  .focus-slot :global(.surface),
  .focus-slot :global(.workspace) { flex: 1 1 auto; min-width: 0; min-height: 0; }
  .focus-slot.attn { box-shadow: inset 0 0 0 1px rgba(238,126,77,0.18); border-radius: var(--r-md); }
  .focus-slot.hidden { display: none; }

  .empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; text-align: center; padding: 40px; }
  .empty .ring { width: 64px; height: 64px; border-radius: 50%; background: var(--nominal-tint); color: #6fe0a6; display: flex; align-items: center; justify-content: center; font-size: 30px; }
  .empty h3 { font-family: var(--font-display); font-weight: 600; font-size: 18px; margin: 0; color: var(--fg-1); }
  .empty p { margin: 0; font-size: 13.5px; color: var(--fg-3); max-width: 340px; line-height: 1.5; }

  /* status badges + ctx gauge (shared look) */
  .badge { display: inline-flex; align-items: center; gap: 6px; }
  .badge.dotonly { padding: 0; }
  .badge .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex: none; }
  .b-active { color: var(--blue-300); }
  .b-active.chip { background: var(--blue-tint); }
  .b-active .dot { animation: workpulse 1.4s var(--ease-out) infinite; }
  @keyframes workpulse {
    0% { box-shadow: 0 0 0 0 rgba(86,156,255,0.5); opacity: 1; }
    70% { box-shadow: 0 0 0 5px rgba(86,156,255,0); opacity: 0.6; }
    100% { box-shadow: 0 0 0 0 rgba(86,156,255,0); opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) { .b-active .dot { animation: none; } }
  .b-review { color: var(--orange-300); }
  .b-review.chip { background: var(--orange-tint); }
  .b-nominal { color: #6fe0a6; }
  .b-nominal.chip { background: var(--nominal-tint); }
  .b-abort { color: #ff8077; }
  .b-abort.chip { background: var(--abort-tint); }
  .b-standby { color: var(--fg-3); }

  .ctxmini { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 10.5px; color: var(--fg-3); font-variant-numeric: tabular-nums; }
  .ctxmini .track { width: 46px; height: 4px; border-radius: 2px; background: var(--space-600); overflow: hidden; }
  .ctxmini.unknown .track { background: repeating-linear-gradient(-45deg, var(--space-600), var(--space-600) 3px, var(--space-700) 3px, var(--space-700) 6px); }
  .ctxmini .track i { display: block; height: 100%; background: linear-gradient(90deg, var(--blue-500), var(--blue-400)); }
  .cost { font-family: var(--font-mono); font-size: 11px; color: var(--fg-1); font-weight: 500; font-variant-numeric: tabular-nums; }

  .btn-primary { font-family: var(--font-sans); font-weight: 600; font-size: 13px; color: #fff; background: var(--blue-500); border: none; border-radius: var(--r-md); padding: 9px 15px; cursor: pointer; }
</style>
