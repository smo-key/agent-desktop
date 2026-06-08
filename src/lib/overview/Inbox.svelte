<!-- src/lib/overview/Inbox.svelte -->
<script lang="ts">
  // The INBOX — the primary overview surface (replaces the lane-of-cards
  // Overview). Left: a grouped roster of every agent (Needs you / In flight /
  // Paused / Archived), each a row with a status circle. Right: a single focus pane —
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
  import { startNewSession } from '$lib/launcher/newSession';
  import { surfaceSlot } from '$lib/layout/surfaceSlot.svelte';
  import { focusTerminal, scrollTerminalToBottom } from '$lib/layout/terminals';
  import {
    buildRoster,
    groupByLane,
    needsAttention,
    LANE_ORDER,
    type AgentLane,
    type AgentRow,
    type AgentStatus
  } from './roster';
  import {
    isAttention,
    attentionQueue,
    resolveFocus,
    nextInQueue,
    archiveDecision,
    autoArchiveAction,
    shouldAutoResume
  } from './inbox';
  import { toRosterWorkspaces, toNavWorkspaces } from './rosterInputs';
  import { runtimeMap } from './runtime';
  import { navigateTarget } from './navigate';
  import { activity } from './activity.svelte';
  import { events } from './events.svelte';
  import { titles } from './titles.svelte';
  import { projects } from '$lib/projects/projects.svelte';
  import { projectFilter } from '$lib/projects/projectFilter.svelte';
  import {
    filterRowsByProject,
    filterOrder,
    stepFilter,
    unassignedCount
  } from '$lib/projects/projectRollup';
  import { projectForId } from '$lib/projects/projects';
  import ProjectPanel from '$lib/projects/ProjectPanel.svelte';
  import ProjectIcon from '$lib/icons/ProjectIcon.svelte';
  import Icon from '$lib/icons/Icon.svelte';
  import StatusBar from '$lib/usage/StatusBar.svelte';
  import { tooltip } from '$lib/ui/tooltip';
  import { friendlyTime } from './friendlyTime';
  import ContextMenu, { type MenuItem } from '$lib/ui/ContextMenu.svelte';
  import TasksLauncher from '$lib/tasks/TasksLauncher.svelte';
  import SpecialistsPanel from '$lib/specialists/SpecialistsPanel.svelte';

  // --- Tasks launcher split (agent list on top / Tasks launcher on bottom) -----
  // The `.col-list` column splits into an agent region (top) and the Tasks
  // launcher (bottom). The launcher's height is a persisted fraction of the column
  // (clamped), driven via flex-basis with a draggable gutter between them.
  const TASKS_FRAC_KEY = 'agent-desktop:tasks-launcher-frac';
  const TASKS_FRAC_MIN = 0.15;
  const TASKS_FRAC_MAX = 0.6;
  const TASKS_FRAC_DEFAULT = 0.33;
  function clampFrac(f: number): number {
    return Math.max(TASKS_FRAC_MIN, Math.min(TASKS_FRAC_MAX, f));
  }
  function loadTasksFrac(): number {
    if (typeof localStorage === 'undefined') return TASKS_FRAC_DEFAULT;
    try {
      const v = Number(localStorage.getItem(TASKS_FRAC_KEY));
      return Number.isFinite(v) && v > 0 ? clampFrac(v) : TASKS_FRAC_DEFAULT;
    } catch {
      return TASKS_FRAC_DEFAULT;
    }
  }
  let tasksFrac = $state(loadTasksFrac());
  function setTasksFrac(f: number) {
    tasksFrac = clampFrac(f);
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(TASKS_FRAC_KEY, String(tasksFrac));
    } catch {
      /* ignore quota / disabled storage */
    }
  }
  /** Drag the gutter: convert pointer Y within the column into a bottom fraction. */
  function startTasksResize(e: PointerEvent) {
    e.preventDefault();
    const gutter = e.currentTarget as HTMLElement;
    const col = gutter.parentElement;
    if (!col) return;
    gutter.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const rect = col.getBoundingClientRect();
      if (rect.height <= 0) return;
      const frac = (rect.bottom - ev.clientY) / rect.height;
      setTasksFrac(frac);
    };
    const up = (ev: PointerEvent) => {
      gutter.releasePointerCapture(ev.pointerId);
      gutter.removeEventListener('pointermove', move);
      gutter.removeEventListener('pointerup', up);
    };
    gutter.addEventListener('pointermove', move);
    gutter.addEventListener('pointerup', up);
  }

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

  // Arrival order for the "Needs you" lane: paneIds in the order they STARTED
  // needing input (earliest first / top). Maintained append-only — an agent that
  // newly needs you joins the bottom, never jumping above one already waiting — so
  // the queue is stable and "order received".
  let queueOrder = $state<string[]>([]);
  $effect(() => {
    const attn = rows.filter((r) => needsAttention(r)).map((r) => r.paneId);
    const present = new Set(attn);
    const kept = queueOrder.filter((id) => present.has(id)); // still-waiting, in order
    const keptSet = new Set(kept);
    const added = attn.filter((id) => !keptSet.has(id)); // newcomers, roster order
    const next = [...kept, ...added];
    const changed =
      next.length !== queueOrder.length || next.some((id, i) => id !== queueOrder[i]);
    if (changed) queueOrder = next;
  });

  /** Rows with the attention agents reordered to `queueOrder` (earliest-waiting
   *  first); every other row keeps its roster position (stable sort). Drives the
   *  list, the queue, and all focus resolution so they agree on order. */
  function reorderByQueue(list: AgentRow[], order: string[]): AgentRow[] {
    const idx = new Map(order.map((id, i) => [id, i] as const));
    return [...list].sort((a, b) => {
      if (needsAttention(a) && needsAttention(b)) {
        return (idx.get(a.paneId) ?? 0) - (idx.get(b.paneId) ?? 0);
      }
      return 0;
    });
  }
  const viewRows = $derived(reorderByQueue(rows, queueOrder));

  const grouped = $derived(groupByLane(viewRows));
  const queue = $derived(attentionQueue(viewRows));

  // Group metadata (label) for the left list, in attn -> flight -> paused -> done
  // order. `done` is the Archived lane (closed sessions); `paused` sits above it.
  const LANES: Record<AgentLane, { title: string }> = {
    attn: { title: 'Needs you' },
    flight: { title: 'In flight' },
    paused: { title: 'Paused' },
    done: { title: 'Archived' }
  };

  // The user's explicit pin (a watched agent), or null to let attention drive.
  let userSelected = $state<string | null>(null);

  // The agent actually SHOWN in the focus pane. Automatic, status-driven advances
  // LAG by ADVANCE_DELAY_MS: when the agent you're on stops needing you (e.g. it
  // goes Working) and another agent needs you, the focus moves to the TOP of the
  // queue after the grace; it never advances to nothing (you keep the agent if
  // nobody else needs you). User clicks / keyboard nav are immediate.
  let shownId = $state<string | null>(null);
  let advanceTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingTarget: string | null = null;
  // Plain (non-reactive) trackers to detect the shown agent leaving attention.
  let lastShownId: string | null = null;
  let lastShownStatus: AgentStatus | null = null;
  const ADVANCE_DELAY_MS = 1000;
  function clearAdvance() {
    if (advanceTimer) {
      clearTimeout(advanceTimer);
      advanceTimer = undefined;
    }
    pendingTarget = null;
  }

  // Whether the project pane (left of the roster) is collapsed — remembered across
  // app restarts via localStorage.
  const COLLAPSE_KEY = 'agent-desktop:project-pane-collapsed';
  function loadCollapsed(): boolean {
    if (typeof localStorage === 'undefined') return false;
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  }
  let projectPaneCollapsed = $state(loadCollapsed());
  function toggleProjectPane() {
    projectPaneCollapsed = !projectPaneCollapsed;
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(COLLAPSE_KEY, projectPaneCollapsed ? '1' : '0');
      } catch {
        /* ignore quota / disabled storage */
      }
    }
  }

  // Right-click context menu for a roster row (open / close the agent).
  let menu = $state<{ open: boolean; x: number; y: number; items: MenuItem[] }>({
    open: false,
    x: 0,
    y: 0,
    items: []
  });

  // The focused (shown) agent row.
  const focus = $derived(viewRows.find((r) => r.paneId === shownId) ?? null);

  // Reconcile the SHOWN agent toward what attention wants (resolveFocus = pin >
  // attention queue, arrival-ordered). First focus / the shown agent being closed
  // switches immediately. While the shown agent ITSELF needs you, we never auto-
  // advance away from it (you handle it on your own time, even as others request
  // input). Once it stops needing you, focus advances to the earliest waiting agent
  // after the grace; if nobody else needs you, the current agent stays.
  $effect(() => {
    const shownRow = viewRows.find((r) => r.paneId === shownId) ?? null;
    // The agent we're on just LEFT attention (handled / went Working)?
    const sameAgent = shownId !== null && shownId === lastShownId;
    const leftAttention =
      sameAgent &&
      lastShownStatus !== null &&
      isAttention(lastShownStatus) &&
      shownRow !== null &&
      !isAttention(shownRow.status);
    lastShownId = shownId;
    lastShownStatus = shownRow?.status ?? null;

    // First focus, or the shown agent was closed -> switch immediately to the
    // focus target (earliest waiting agent, or none).
    if (shownId === null || shownRow === null) {
      clearAdvance();
      userSelected = null;
      shownId = resolveFocus(viewRows, null)?.paneId ?? null;
      return;
    }

    // A PINNED agent we're on that left attention yields to the queue: drop the pin
    // so focus can advance to the next waiting agent (else resolveFocus keeps it).
    if (leftAttention && userSelected === shownId && queue.some((r) => r.paneId !== shownId)) {
      userSelected = null;
    }

    // The agent we're showing still needs you -> stay put. Don't auto-jump to a
    // different agent just because it now wants input. A PAUSED shown agent does not
    // count (needsAttention excludes it), so pausing it lets focus advance.
    if (needsAttention(shownRow)) {
      clearAdvance();
      return;
    }

    const target = resolveFocus(viewRows, userSelected);
    let wantId = target?.paneId ?? shownId; // never advance to nothing
    if (wantId === shownId) {
      clearAdvance();
      return;
    }
    // A different agent now wants focus -> advance after the grace. Schedule ONCE
    // per target: the roster recomputes every second, so without this guard the
    // timer would reset each tick and never fire.
    if (advanceTimer && pendingTarget === wantId) return;
    clearAdvance();
    pendingTarget = wantId;
    const next = wantId;
    advanceTimer = setTimeout(() => {
      advanceTimer = undefined;
      pendingTarget = null;
      userSelected = null;
      shownId = next;
    }, ADVANCE_DELAY_MS);
  });

  // Immediately switch to a session the user just created (in-inbox "+" or the
  // launcher dialog). `workspace.launch` stamps `lastLaunchedId`; selecting it pins
  // focus so the new agent's terminal shows at once.
  let lastSeenLaunch: string | null = null;
  $effect(() => {
    const id = workspace.lastLaunchedId;
    if (id && id !== lastSeenLaunch) {
      lastSeenLaunch = id;
      selectAgent(id);
    }
  });

  // Teleport the live surface to the shown agent + auto-focus its terminal on
  // entry. With no shown agent, clear the target so the surface goes home (hidden)
  // and the empty panel shows.
  let focusSlot = $state<HTMLDivElement | null>(null);
  let lastFocusId: string | null = null;
  // Bumped on every explicit switch (click / keyboard / queue-nav) so the effect
  // re-focuses the terminal even when re-selecting the same agent.
  let focusNonce = $state(0);
  let lastFocusNonce = -1;

  $effect(() => {
    const f = focus;
    const nonce = focusNonce;
    // A closed (Archived) agent has no live terminal — the inbox shows its own
    // closed panel, so send the surface home rather than teleporting it.
    if (!f || f.closed || !focusSlot) {
      surfaceSlot.clear();
      lastFocusId = null;
      lastFocusNonce = nonce;
      return;
    }
    const target = navigateTarget(navWorkspaces, f.paneId);
    if (target) {
      workspace.setActiveWorkspace(target.workspaceId);
      workspace.setFocusIn(target.workspaceId, target.leafId);
    }
    surfaceSlot.set(focusSlot);

    // Focus the terminal + pin to the bottom whenever we SWITCH to a Claude window
    // (the shown agent changed, or the user re-selected it) — after the display
    // swap + fit settle. Not on the per-second roster reruns, so typing is safe.
    if (lastFocusId !== f.paneId || lastFocusNonce !== nonce) {
      const id = f.paneId;
      void tick().then(() =>
        requestAnimationFrame(() => {
          scrollTerminalToBottom(id);
          focusTerminal(id);
        })
      );
    }
    lastFocusId = f.paneId;
    lastFocusNonce = nonce;
  });

  // Release the teleport target + cancel any pending advance on teardown.
  $effect(() => () => {
    clearAdvance();
    surfaceSlot.clear();
  });

  /** Select (watch) an agent: show it immediately, pin it, and focus its terminal. */
  function selectAgent(paneId: string) {
    clearAdvance();
    userSelected = paneId;
    shownId = paneId;
    focusNonce += 1;
  }

  /** PREVIEW an archived session: respawn `claude --resume` so its transcript shows
   *  live, but keep it presented as Archived (out of attention) until a message is
   *  sent. Captures the current user-message hash as the unarchive baseline, then
   *  watches it. `previewArchived` is a no-op for a non-resumable pane (no session
   *  id); `selectAgent` still shows it. */
  function startPreview(paneId: string) {
    workspace.previewArchived(paneId, activity.forPane(paneId).userHash ?? null);
    selectAgent(paneId);
  }

  /** A roster row was clicked: an archived (closed) session resumes for preview;
   *  everything else (live / paused / already-previewing) is just selected. */
  function onRowClick(r: AgentRow) {
    if (r.closed) startPreview(r.paneId);
    else selectAgent(r.paneId);
  }

  /** Step through the attention queue from the header ↑/↓ controls (immediate). */
  function stepQueue(dir: 1 | -1) {
    const next = nextInQueue(viewRows, shownId, dir);
    if (next) {
      clearAdvance();
      userSelected = next;
      shownId = next;
      focusNonce += 1;
    }
  }

  /** Whether a LIVE/paused session is EMPTY by our definition (no real user
   *  messages — e.g. the user only typed `/exit`). Such a session has nothing to
   *  resume, so its archive action is presented (and behaves) as Delete, not Archive. */
  function isEmptySession(paneId: string): boolean {
    return archiveDecision(activity.forPane(paneId).userHash) === 'delete';
  }

  /** ARCHIVE an agent's session → moves it to Archived (terminates the terminal but
   *  keeps it, restorable). An EMPTY session (no user messages) has nothing to
   *  resume, so it is DELETED outright instead. Not destructive for a real session,
   *  so no confirm. Drops the pin so focus advances to whatever needs you next. */
  function archiveAgent(paneId: string) {
    if (userSelected === paneId) userSelected = null;
    if (archiveDecision(activity.forPane(paneId).userHash) === 'delete') {
      workspace.deleteAgent(paneId);
    } else {
      workspace.closeAgent(paneId);
    }
  }

  /** PAUSE (defer) an agent: keep it live but move it to the Paused lane, out of
   *  attention. Records the current user-message hash so a new message resumes it.
   *  Drops the pin so focus advances. */
  function pauseAgent(paneId: string) {
    if (userSelected === paneId) userSelected = null;
    workspace.pauseAgent(paneId, activity.forPane(paneId).userHash ?? null);
  }

  /** RESUME a paused agent (manual): clear paused and watch it. */
  function resumeAgent(paneId: string) {
    workspace.resumeAgent(paneId);
    selectAgent(paneId);
  }

  /** DELETE an Archived agent for good (after a confirm). Drops the pin. */
  function deleteAgent(paneId: string, name: string) {
    const ok =
      typeof confirm === 'function'
        ? confirm(`Delete "${name}"? This permanently removes the session.`)
        : true;
    if (!ok) return;
    if (userSelected === paneId) userSelected = null;
    workspace.deleteAgent(paneId);
  }

  // Auto-archive on completion: when an agent's process exits CLEANLY (its task
  // ended — `finished`, not a crash) AND it isn't paused, move it to Archived so it
  // stops occupying a live slot and persists as a restorable closed session. Guarded
  // on `!r.closed` so it fires once per session, and `!r.preview` so a resumed-for-
  // preview session is never re-archived out from under the viewer. Crashes (`error`)
  // stay in Needs-you. An EMPTY finished session (no user messages — e.g. the user
  // only typed `/exit`) has nothing to resume, so it is DELETED instead of archived,
  // matching the manual "Archive session" decision.
  $effect(() => {
    for (const r of allRows) {
      const action = autoArchiveAction(r, activity.forPane(r.paneId).userHash);
      if (action === 'delete') workspace.deleteAgent(r.paneId);
      else if (action === 'archive') workspace.closeAgent(r.paneId);
    }
  });

  // Auto-preview a focused archived session: whenever the SHOWN agent is still
  // closed (Archived), resume it for preview so its actual transcript renders in the
  // panel — never the "Session archived" placeholder. Clicking a row previews
  // synchronously via `onRowClick`; this covers every OTHER path that lands focus on
  // a closed session (keyboard ⌘↑/↓, the queue stepper, a restored layout, or
  // returning to a session the grace timer just re-archived). The session stays
  // presented as Archived until the user replies (the auto-unarchive effect below
  // commits it). `previewArchived` is a no-op for a non-resumable pane (no session
  // id) — those rare cases still fall back to the placeholder.
  $effect(() => {
    const f = focus;
    if (f?.closed) {
      workspace.previewArchived(f.paneId, activity.forPane(f.paneId).userHash ?? null);
    }
  });

  // Auto-resume / auto-unarchive: a PAUSED agent returns to its live status, and a
  // PREVIEWING (resumed-from-Archived) agent unarchives, the moment the user sends a
  // new message — detected when the live user-message hash differs from the baseline
  // hash captured at pause/preview time. Runs off the activity poll (the 1s clock
  // re-derives rows).
  $effect(() => {
    for (const r of allRows) {
      const liveHash = activity.forPane(r.paneId).userHash;
      if (r.paused && shouldAutoResume(r.pausedHash, liveHash)) {
        workspace.resumeAgent(r.paneId);
      }
      if (r.preview && shouldAutoResume(r.previewHash, liveHash)) {
        workspace.commitPreview(r.paneId);
      }
    }
  });

  // Re-archive a previewing session the user has walked away from. While a previewing
  // session is the SHOWN agent (the user is on its window) no timer runs; once it
  // stops being shown, a grace timer starts and — if the user neither returns nor
  // sends a message within PREVIEW_GRACE_MS — `closeAgent` terminates its resumed PTY
  // and returns it to true Archived. Timers are keyed per pane (the non-reactive map
  // is mutated in place; nothing renders from it).
  const PREVIEW_GRACE_MS = 60_000;
  const previewTimers = new Map<string, ReturnType<typeof setTimeout>>();
  function cancelPreviewTimer(paneId: string) {
    const t = previewTimers.get(paneId);
    if (t) {
      clearTimeout(t);
      previewTimers.delete(paneId);
    }
  }
  $effect(() => {
    const previewing = new Set(allRows.filter((r) => r.preview).map((r) => r.paneId));
    // Drop timers for panes that stopped previewing (committed / deleted / closed).
    for (const paneId of [...previewTimers.keys()]) {
      if (!previewing.has(paneId)) cancelPreviewTimer(paneId);
    }
    for (const paneId of previewing) {
      if (paneId === shownId) {
        cancelPreviewTimer(paneId); // on its window — hold off
      } else if (!previewTimers.has(paneId)) {
        // Left its window — start the grace countdown (once; per-second roster reruns
        // see the timer already pending and don't restart it).
        previewTimers.set(
          paneId,
          setTimeout(() => {
            previewTimers.delete(paneId);
            workspace.closeAgent(paneId);
          }, PREVIEW_GRACE_MS)
        );
      }
    }
  });
  // Clear every pending re-archive timer on teardown.
  $effect(() => () => {
    for (const t of previewTimers.values()) clearTimeout(t);
    previewTimers.clear();
  });

  /** Right-click a roster row. An Archived agent — closed OR being previewed (it's
   *  still presented as archived until you reply) — offers only Delete; a paused agent
   *  offers Open / Resume / Archive; a live agent offers Open / Pause / Archive. An
   *  EMPTY live/paused session presents its archive action as Delete instead. */
  function openAgentMenu(e: MouseEvent, row: AgentRow, name: string) {
    e.preventDefault();
    // The archive action for a live/paused row: an empty session deletes (nothing to
    // keep) and reads as "Delete"; a session with messages archives (restorable).
    const archiveItem: MenuItem = isEmptySession(row.paneId)
      ? { label: 'Delete', icon: 'trash-2', danger: true, onClick: () => archiveAgent(row.paneId) }
      : { label: 'Archive session', icon: 'archive', danger: true, onClick: () => archiveAgent(row.paneId) };
    const items: MenuItem[] = row.closed || row.preview
      ? [
          { label: 'Delete', icon: 'trash-2', danger: true, onClick: () => deleteAgent(row.paneId, name) }
        ]
      : row.paused
        ? [
            { label: 'Open terminal', icon: 'terminal', onClick: () => selectAgent(row.paneId) },
            { label: 'Resume', icon: 'play', onClick: () => resumeAgent(row.paneId) },
            archiveItem
          ]
        : [
            { label: 'Open terminal', icon: 'terminal', onClick: () => selectAgent(row.paneId) },
            { label: 'Pause', icon: 'pause', onClick: () => pauseAgent(row.paneId) },
            archiveItem
          ];
    menu = { open: true, x: e.clientX, y: e.clientY, items };
  }

  /** The agent's display title (generated session title or its fallback name). */
  function displayName(paneId: string, fallback: string): string {
    return titles.titleFor(paneId) ?? fallback;
  }

  /** New session: when a project is already selected, launch straight into it (no
   *  dialog); otherwise open the launcher to pick/create a project. */
  function newAgent() {
    // Fire-and-forget: startNewSession is async (it may create a worktree first).
    void startNewSession();
  }

  // Flat roster order (Needs you -> In flight -> Paused -> Archived) for keyboard nav.
  const orderedRows = $derived(LANE_ORDER.flatMap((lane) => grouped[lane]));

  /** Keyboard shortcuts on the inbox, all ⌘-modified so plain keys still reach the
   *  PTY: ⌘↑/↓ step the roster; ⌘W archives the focused session (delete-if-empty);
   *  ⌘. pauses/resumes it. */
  function onNavKey(e: KeyboardEvent) {
    if (launcher.open) return;

    // ⌘⇧↑/↓ — cycle the project filter up/down the panel's order. Handled before
    // the ⌘-only guard below since this one intentionally uses Shift; ⌘↑/↓ (no
    // shift) still steps the agent roster.
    if (
      e.metaKey &&
      e.shiftKey &&
      !e.altKey &&
      !e.ctrlKey &&
      (e.key === 'ArrowUp' || e.key === 'ArrowDown')
    ) {
      e.preventDefault();
      const order = filterOrder(projects.list, unassignedCount(allRows) > 0);
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      projectFilter.select(stepFilter(order, projectFilter.selected, dir));
      return;
    }

    // All remaining inbox shortcuts use ⌘ alone (no alt/ctrl/shift), so a literal
    // key still reaches the terminal.
    if (!e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return;

    // ⌘W — archive (or delete-if-empty) the focused session. preventDefault also
    // stops ⌘W from closing the app window via the webview.
    if (e.key === 'w' || e.key === 'W') {
      if (!focus || focus.closed) return;
      e.preventDefault();
      archiveAgent(focus.paneId);
      return;
    }

    // ⌘. — pause the focused session, or resume it if already paused.
    if (e.key === '.') {
      if (!focus || focus.closed) return;
      e.preventDefault();
      if (focus.paused) resumeAgent(focus.paneId);
      else pauseAgent(focus.paneId);
      return;
    }

    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (orderedRows.length === 0) return;
    e.preventDefault();
    const dir = e.key === 'ArrowDown' ? 1 : -1;
    const i = orderedRows.findIndex((r) => r.paneId === shownId);
    const ni =
      i < 0
        ? dir === 1
          ? 0
          : orderedRows.length - 1
        : Math.min(orderedRows.length - 1, Math.max(0, i + dir));
    selectAgent(orderedRows[ni].paneId);
  }

  // ---- Display helpers ------------------------------------------------------

  function projAvatar(
    projectId: string | null
  ): { icon: string; color: string; logo?: string } {
    const p = projectForId(projects.list, projectId);
    return p
      ? { icon: p.icon, color: p.color, logo: p.logo }
      : { icon: 'folder', color: '#7B8499' };
  }

  function cost(value: number | null): string {
    return value === null ? '—' : `$${value.toFixed(2)}`;
  }

  /** Whether a row shows the CONTEXT-window measure (with its mini-bar) in the meta
   *  row: only LIVE agents — not archived/previewed (closed) or paused. Archived and
   *  paused rows drop context and show just cost + last activity. */
  function showMeta(r: AgentRow): boolean {
    return !r.closed && !r.preview && !r.paused;
  }

  /** Context-window usage as a compact percent, or an em dash when unknown. */
  function ctxLabel(pct: number | null): string {
    return pct === null ? '—' : `${Math.round(pct)}%`;
  }

  /** Total cost without the leading "$" (the dollar icon carries that), or "—". */
  function costMeta(value: number | null): string {
    return value === null ? '—' : value.toFixed(2);
  }

  /** The status dot class for a row. Paused/archived rows are muted (they don't
   *  need you), so a paused waiting agent shows a standby dot, not an orange one. */
  function badgeClass(r: AgentRow): string {
    if (r.closed || r.paused) return 'b-standby';
    if (r.status === 'working') return 'b-active';
    if (r.status === 'error') return 'b-abort';
    if (isAttention(r.status)) return 'b-review';
    if (r.status === 'finished') return 'b-nominal';
    return 'b-standby';
  }

  /** The secondary line for a roster row: question / current action / cost·model. */
  function rowSub(r: AgentRow): string {
    if (r.closed) return 'Archived · restore or delete';
    if (r.paused) return 'Paused · send a message to resume';
    if (isAttention(r.status)) {
      if (r.status === 'error') return 'Errored — needs you';
      if (r.questions && r.questions.length > 0) return r.questions[0].question;
      return r.question ?? 'Needs input';
    }
    if (r.status === 'finished') return cost(r.cost);
    return r.currentAction ?? r.summary ?? 'Working…';
  }
</script>

<svelte:window onkeydown={onNavKey} />

<div class="inbox-shell" class:project-collapsed={projectPaneCollapsed}>
  <ProjectPanel
    rows={allRows}
    collapsed={projectPaneCollapsed}
    onToggle={toggleProjectPane}
  />

  <section class="inbox" aria-label="Agent inbox">
    <!-- LEFT: grouped roster -->
    <div class="col-list">
      <div class="lh">
        <img class="logo" src="/logomark.svg" alt="" aria-hidden="true" />
        <h1>Agents <span class="count">{rows.length}</span></h1>
        <button type="button" class="launch" onclick={newAgent} aria-label="New session" use:tooltip={'New session (⌘N)'}>＋</button>
      </div>

      <!-- Middle region: the agent roster (or its empty state). Flexes to fill
           the space left between the header and the bottom Tasks launcher. -->
      <div class="agent-region">
        {#if rows.length === 0}
          <div class="empty-list">
            <p>No agents yet.</p>
            <button type="button" class="btn-primary" onclick={newAgent}>＋ New session</button>
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
                    onclick={() => onRowClick(r)}
                    oncontextmenu={(e) => openAgentMenu(e, r, displayName(r.paneId, r.name))}
                  >
                    <ProjectIcon {...projAvatar(r.projectId)} size={30} />
                    <span class="nm">
                      <span class="t">
                        {titles.titleFor(r.paneId) ?? r.name}
                        {#if r.specialist}
                          <span class="spec-badge" use:tooltip={`Spawned as specialist “${r.specialist}”`}>
                            <Icon name="bot" size={9} />{r.specialist}
                          </span>
                        {/if}
                      </span>
                      <span class="s" class:q={needsAttention(r)} use:tooltip={rowSub(r)}>{rowSub(r)}</span>
                      <span class="meta">
                        {#if showMeta(r)}
                          <span class="m ctx" use:tooltip={'Context window used by this agent'}>
                            <span class="ctxbar"><StatusBar pct={r.contextPct} /></span>
                            {ctxLabel(r.contextPct)}
                          </span>
                        {/if}
                        <span class="m" use:tooltip={'Total session cost'}>
                          <Icon name="dollar-sign" size={11} />{costMeta(r.cost)}
                        </span>
                        <span class="m" use:tooltip={'Time since last activity'}>
                          <Icon name="clock" size={11} />{friendlyTime(r.lastTs, nowMs)}
                        </span>
                      </span>
                    </span>
                    {#if needsAttention(r)}
                      <span class="badge {badgeClass(r)} dotonly"><span class="dot"></span></span>
                    {/if}
                  </button>
                {/each}
              {/if}
            {/each}
          </div>
        {/if}
      </div>

      <!-- Draggable splitter between the agent roster (top) and Tasks (bottom). -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="tasks-gutter" onpointerdown={startTasksResize} use:tooltip={'Drag to resize'}></div>

      <!-- Bottom region: the Tasks launcher + the Specialists panel (sibling
           surfaces), sized together to a persisted fraction and split evenly. -->
      <div class="tasks-region" style="flex: 0 0 {tasksFrac * 100}%">
        <div class="launch-pane"><TasksLauncher /></div>
        <div class="launch-pane sp"><SpecialistsPanel /></div>
      </div>
    </div>

    <!-- RIGHT: focus pane (header + teleported live TUI / Archived / All clear) -->
    <div class="col-focus">
      {#if focus && !focus.closed}
        {@const av = projAvatar(focus.projectId)}
        <div class="fhead">
          <ProjectIcon {...av} size={26} />
          <span class="ttl">{titles.titleFor(focus.paneId) ?? focus.name}</span>
          <span class="spc"></span>
          {#if needsAttention(focus) && queue.length > 1}
            <span class="nav">
              <button type="button" onclick={() => stepQueue(-1)} aria-label="Previous" use:tooltip={'Previous needs-attention agent'}>↑</button>
              <button type="button" onclick={() => stepQueue(1)} aria-label="Next" use:tooltip={'Next needs-attention agent'}>↓</button>
            </span>
          {/if}
          {#if focus.preview}
            <!-- Resumed-from-Archived preview: still an archived session (it stays
                 archived until you reply), so it offers only Delete. -->
            <button
              type="button"
              class="hbtn danger"
              onclick={() => deleteAgent(focus.paneId, displayName(focus.paneId, focus.name))}
              use:tooltip={'Delete session'}
            >Delete</button>
          {:else}
            {#if focus.paused}
              <button type="button" class="hbtn" onclick={() => resumeAgent(focus.paneId)} use:tooltip={'Resume (⌘.)'}>Resume</button>
            {:else}
              <button type="button" class="hbtn" onclick={() => pauseAgent(focus.paneId)} use:tooltip={'Pause / defer for later (⌘.)'}>Pause</button>
            {/if}
            {#if isEmptySession(focus.paneId)}
              <button type="button" class="hbtn danger" onclick={() => archiveAgent(focus.paneId)} use:tooltip={'Delete empty session (⌘W)'}>Delete</button>
            {:else}
              <button type="button" class="hbtn danger" onclick={() => archiveAgent(focus.paneId)} use:tooltip={'Archive session (⌘W)'}>Archive</button>
            {/if}
          {/if}
        </div>
        <!-- The single mounted workspace surface is teleported in here. -->
        <div class="focus-slot" class:attn={needsAttention(focus)} bind:this={focusSlot}></div>
      {:else if focus && focus.closed}
        {@const av = projAvatar(focus.projectId)}
        <div class="fhead">
          <ProjectIcon {...av} size={26} />
          <span class="ttl">{titles.titleFor(focus.paneId) ?? focus.name}</span>
          <span class="spc"></span>
          <button type="button" class="hbtn" onclick={() => startPreview(focus.paneId)} use:tooltip={'Resume (claude --resume)'}>Resume</button>
          <button
            type="button"
            class="hbtn danger"
            onclick={() => deleteAgent(focus.paneId, displayName(focus.paneId, focus.name))}
            use:tooltip={'Delete session'}
          >Delete</button>
        </div>
        <div class="empty">
          <div class="ring closed">✓</div>
          <h3>Session archived</h3>
          <p>Select this session to pick up where it left off (<code>claude --resume</code>) — it stays archived until you send a message.</p>
        </div>
        <!-- Slot stays bound (hidden) so the teleport target survives this state. -->
        <div class="focus-slot hidden" bind:this={focusSlot}></div>
      {:else}
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

  <ContextMenu
    open={menu.open}
    x={menu.x}
    y={menu.y}
    items={menu.items}
    onClose={() => (menu = { ...menu, open: false })}
  />
</div>

<style>
  .inbox-shell { display: flex; flex-direction: row; flex: 1 1 auto; width: 100%; min-height: 0; }
  .inbox-shell :global(.ppanel) { flex: 0 0 220px; width: 220px; }
  /* Collapsed: the project pane shrinks to a thin icon rail. */
  .inbox-shell.project-collapsed :global(.ppanel) { flex: 0 0 48px; width: 48px; }
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
  .lh .launch { margin-left: auto; font-family: var(--font-sans); font-weight: 700; font-size: 15px; color: #fff; background: var(--blue-500); border: none; border-radius: var(--r-md); width: 30px; height: 30px; cursor: pointer; }
  /* Middle region holds the agent list (or empty state); flexes to fill. */
  .agent-region { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
  .list-scroll { overflow-y: auto; flex: 1; min-height: 0; padding-bottom: 20px; }
  .empty-list { padding: 40px 18px; text-align: center; color: var(--fg-3); display: flex; flex-direction: column; gap: 12px; }
  /* The horizontal splitter between the agent roster and the Tasks launcher. */
  .tasks-gutter { flex: 0 0 5px; cursor: row-resize; background: var(--space-900); border-top: 1px solid var(--line-subtle); }
  .tasks-gutter:hover { background: var(--blue-500); }
  /* The bottom region: the Tasks launcher + Specialists panel stacked, sized to a
     persisted fraction. Each pane scrolls independently and shares the height. */
  .tasks-region { min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
  .launch-pane { flex: 1 1 0; min-height: 0; overflow: hidden; }
  .launch-pane.sp { border-top: 1px solid var(--line-subtle); }

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
  .row .nm .t { font-weight: 600; font-size: 13px; color: var(--fg-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; align-items: center; gap: 6px; }
  /* Specialist attribution: a compact blue-tinted pill (icon + name) next to the
     agent's title, marking a pane spawned AS a specialist (task 5.4). */
  .row .nm .t .spec-badge { flex: none; display: inline-flex; align-items: center; gap: 3px; max-width: 120px; padding: 1px 6px 1px 5px; border-radius: var(--r-full); background: var(--blue-tint); color: var(--blue-200); font-family: var(--font-mono); font-size: 9.5px; font-weight: 500; letter-spacing: 0.02em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row .nm .t .spec-badge :global(.mc-icon) { opacity: 0.85; }
  .row .nm .s { font-size: 11px; color: var(--fg-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 1px; }
  .row .nm .s.q { color: var(--orange-300); }
  /* The tiny third row: context · cost · last activity, each an icon + value. */
  .row .nm .meta { display: flex; align-items: center; gap: 10px; margin-top: 3px; font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 10px; color: var(--fg-4); }
  .row .nm .meta .m { display: inline-flex; align-items: center; gap: 3px; white-space: nowrap; }
  .row .nm .meta .m :global(svg) { opacity: 0.75; }
  /* The context measure leads with a compact colored bar, then the percent. */
  .row .nm .meta .ctx { gap: 5px; }
  .row .nm .meta .ctx .ctxbar { display: inline-flex; width: 34px; }
  .row .nm .meta .ctx .ctxbar :global(.bar) { width: 34px; min-width: 34px; flex: 0 0 34px; height: 4px; }

  .col-focus { background: var(--space-850); min-width: 0; display: flex; flex-direction: column; min-height: 0; }
  .fhead { flex: none; display: flex; align-items: center; gap: 11px; padding: 11px 18px; border-bottom: 1px solid var(--line-subtle); background: var(--space-900); }
  .fhead .ttl { font-weight: 600; font-size: 13.5px; color: var(--fg-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .fhead .spc { flex: 1; }
  .fhead .nav { display: flex; gap: 4px; flex: none; }
  .fhead .nav button { width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--r-sm); background: var(--space-750); border: 1px solid var(--line-subtle); color: var(--fg-3); cursor: pointer; font-size: 13px; }
  .fhead .nav button:hover { color: var(--fg-1); border-color: var(--line-default); }
  /* Named text action buttons in the header (Pause/Resume/Archive/Restore/Delete). */
  .fhead .hbtn { flex: none; height: 26px; padding: 0 12px; display: inline-flex; align-items: center; border-radius: var(--r-sm); background: var(--space-750); border: 1px solid var(--line-subtle); color: var(--fg-2); cursor: pointer; font-family: var(--font-sans); font-size: 12px; font-weight: 600; }
  .fhead .hbtn:hover { color: var(--fg-1); border-color: var(--line-default); }
  /* Destructive actions (Archive / Delete) read red at rest, intensifying on hover. */
  .fhead .hbtn.danger { color: #ff8077; border-color: rgba(242, 86, 75, 0.32); }
  .fhead .hbtn.danger:hover { color: #ff8077; border-color: rgba(242, 86, 75, 0.5); background: var(--abort-tint); }

  .focus-slot { flex: 1; min-height: 0; display: flex; padding: 10px; }
  /* The teleported surface fills the slot. */
  .focus-slot :global(.surface),
  .focus-slot :global(.workspace) { flex: 1 1 auto; min-width: 0; min-height: 0; }
  .focus-slot.attn { box-shadow: inset 0 0 0 1px rgba(238,126,77,0.18); border-radius: var(--r-md); }
  .focus-slot.hidden { display: none; }

  .empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; text-align: center; padding: 40px; }
  .empty .ring { width: 64px; height: 64px; border-radius: 50%; background: var(--nominal-tint); color: #6fe0a6; display: flex; align-items: center; justify-content: center; font-size: 30px; }
  .empty .ring.closed { background: var(--space-750); color: var(--fg-3); }
  .empty p code { font-family: var(--font-mono); font-size: 12px; color: var(--fg-2); background: var(--space-750); padding: 1px 5px; border-radius: var(--r-sm); }
  .empty h3 { font-family: var(--font-display); font-weight: 600; font-size: 18px; margin: 0; color: var(--fg-1); }
  .empty p { margin: 0; font-size: 13.5px; color: var(--fg-3); max-width: 340px; line-height: 1.5; }

  /* status badges (shared look) */
  .badge { display: inline-flex; align-items: center; gap: 6px; }
  .badge.dotonly { padding: 0; }
  .badge .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex: none; }
  .b-active { color: var(--blue-300); }
  .b-active .dot { animation: workpulse 1.4s var(--ease-out) infinite; }
  @keyframes workpulse {
    0% { box-shadow: 0 0 0 0 rgba(86,156,255,0.5); opacity: 1; }
    70% { box-shadow: 0 0 0 5px rgba(86,156,255,0); opacity: 0.6; }
    100% { box-shadow: 0 0 0 0 rgba(86,156,255,0); opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) { .b-active .dot { animation: none; } }
  .b-review { color: var(--orange-300); }
  .b-nominal { color: #6fe0a6; }
  .b-abort { color: #ff8077; }
  .b-standby { color: var(--fg-3); }

  .btn-primary { font-family: var(--font-sans); font-weight: 600; font-size: 13px; color: #fff; background: var(--blue-500); border: none; border-radius: var(--r-md); padding: 9px 15px; cursor: pointer; }
</style>
