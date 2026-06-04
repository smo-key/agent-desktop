<script lang="ts">
  import { onMount } from 'svelte';
  import PaneNode from '$lib/layout/PaneNode.svelte';
  import PaneContextMenu from '$lib/layout/PaneContextMenu.svelte';
  import SessionRail from '$lib/layout/SessionRail.svelte';
  import Launcher from '$lib/launcher/Launcher.svelte';
  import { launcher } from '$lib/launcher/launcherStore.svelte';
  import { workspace } from '$lib/layout/workspace.svelte';
  import { rectsSnapshot } from '$lib/layout/rects.svelte';
  import { restorePersistedLayout, watchAndPersist } from '$lib/layout/store-backend.svelte';
  import { snapshots } from '$lib/usage/snapshots.svelte';
  import { appSessionIds } from '$lib/usage/appSessions';
  import UsageBar from '$lib/usage/UsageBar.svelte';
  import Overview from '$lib/overview/Overview.svelte';
  import Windows from '$lib/overview/Windows.svelte';
  import { runtimeMap } from '$lib/overview/runtime';
  import { view, type ViewMode } from '$lib/overview/view.svelte';
  import { subagents, type SessionRef } from '$lib/overview/subagents.svelte';
  import { activity, type PaneRef } from '$lib/overview/activity.svelte';
  import { events } from '$lib/overview/events.svelte';
  import { triggersTranscriptRead, SAFETY_POLL_MS } from '$lib/overview/poll';
  import { appSessionRefs } from '$lib/overview/sessionRefs';
  import { type SpatialDir } from '$lib/layout/tree';

  // The top-level view segments (title-bar control). Order matches `view.cycle()`.
  const viewSegments: { mode: ViewMode; label: string }[] = [
    { mode: 'overview', label: 'Overview' },
    { mode: 'windows', label: 'Windows' },
    { mode: 'grid', label: 'Grid' }
  ];

  // True once the persisted layout has loaded (or fallen back to fresh). We hold
  // off rendering the workspace area until then so we never flash a throwaway
  // workspace whose PTYs we'd immediately tear down.
  let restored = $state(false);

  // Seed the store from the persisted layout (or a fresh single-pane `claude`
  // workspace on first launch / corrupt state), then start the debounced +
  // on-quit persistence. Rendering the restored PaneNodes re-spawns one PTY per
  // leaf (saved shell + cwd only) via each TerminalPane's mount.
  onMount(() => {
    let stopWatching: (() => void) | undefined;
    void restorePersistedLayout().then(() => {
      restored = true;
      stopWatching = watchAndPersist();
    });

    // Seed the usage-dashboard snapshots store from the current set, then
    // subscribe to live `usage://snapshot` pushes from the Rust watcher. The
    // unlisten fn is captured and called on teardown.
    let unlistenSnapshots: (() => void) | undefined;
    void snapshots.start().then((unlisten) => {
      unlistenSnapshots = unlisten;
    });

    // Seed the SUBAGENTS store (agent-overview) with the app's current app-pane
    // session refs ({sessionId, cwd}), then subscribe to live `overview://subagents`
    // pushes from the Rust subagent watcher. A separate $effect (below) re-seeds the
    // watched-set whenever the app's session set changes.
    let unlistenSubagents: (() => void) | undefined;
    void subagents.start(currentSessionRefs()).then((unlisten) => {
      unlistenSubagents = unlisten;
    });

    // Prime TRANSCRIPT ACTIVITY once on mount (each claude pane's last message +
    // any pending question, read from its transcript by cwd). Event-driven reads
    // (below) keep it fresh, with a slow safety poll as the backstop.
    void activity.refresh(currentPaneRefs());

    // Start the EVENT pipeline store: seed each pane's timeline (ring → durable
    // sink → transcript backfill, resolved in Rust), then subscribe to live
    // `overview://event` pushes. Each ingested event that signals visible content
    // changed (a tool completing / a turn ending) triggers an immediate transcript
    // read — replacing the old fixed 1.5s poll.
    events.onEvent = (ev) => {
      if (triggersTranscriptRead(ev.hookEventName)) void activity.refresh(currentPaneRefs());
    };
    let unlistenEvents: (() => void) | undefined;
    void events.start(currentPaneRefs()).then((unlisten) => {
      unlistenEvents = unlisten;
    });

    return () => {
      stopWatching?.();
      unlistenSnapshots?.();
      unlistenSubagents?.();
      unlistenEvents?.();
      events.onEvent = undefined;
    };
  });

  // The app's app-pane session refs ({sessionId, cwd}), joining each snapshot's
  // Claude session id with its pane cwd from the workspace registry (pure helper).
  function currentSessionRefs(): SessionRef[] {
    return appSessionRefs(snapshots.byPane, (paneId) => workspace.session(paneId).cwd);
  }

  // The app's claude panes as {paneId, sessionId, cwd} — the input to the
  // transcript-activity command. Read straight from the workspace registry (NOT the
  // snapshot): each claude pane was spawned with `--session-id`, so we read its
  // EXACT transcript with no statusline/snapshot dependency and no cwd ambiguity.
  function currentPaneRefs(): PaneRef[] {
    const refs: PaneRef[] = [];
    for (const ws of workspace.workspaces) {
      for (const [paneId, sess] of Object.entries(ws.registry)) {
        if (sess.program === 'claude' && sess.sessionId) {
          refs.push({ paneId, sessionId: sess.sessionId, cwd: sess.cwd });
        }
      }
    }
    return refs;
  }

  // The app's set of launched session ids (sorted, de-duped), used to keep the
  // subagents watched-set current as panes come and go.
  const ourSessionIds = $derived(appSessionIds(snapshots.byPane));

  // Keep the SUBAGENTS watched-set current too: whenever the app's session refs
  // change (a new app pane reports a session id, a cwd resolves, or one ends),
  // re-seed the Rust `subagents_for` watcher so it watches exactly our sessions.
  // Keyed on the session ids (sorted, stable) so it only fires on a real change.
  $effect(() => {
    void ourSessionIds; // re-run when the app's session set changes
    void subagents.seed(currentSessionRefs());
  });

  // SAFETY poll for TRANSCRIPT ACTIVITY. Event-driven reads (the `events.onEvent`
  // hook above) do the timely work now — on every tool completion / turn end — so
  // this is only a slow backstop that re-reads content if a triggering event never
  // arrived (e.g. the socket was briefly down). The old fixed 1.5s fast poll is
  // retired in favour of SAFETY_POLL_MS.
  $effect(() => {
    const id = setInterval(() => {
      const refs = currentPaneRefs();
      if (refs.length > 0) void activity.refresh(refs);
    }, SAFETY_POLL_MS);
    return () => clearInterval(id);
  });

  // Keep the EVENT store's seeded set current: whenever the app's session set
  // changes (a pane launched/ended, a cwd resolved), re-seed `events_for` so a
  // newly-launched agent's timeline (and any backfill) is available immediately.
  $effect(() => {
    void ourSessionIds; // re-run when the app's session set changes
    void events.seed(currentPaneRefs());
  });

  // Prune GHOST snapshots: whenever the set of open panes changes (a pane closes,
  // a workspace closes, or one is added/restored), drop any usage snapshot whose
  // pane_id no longer maps to a live pane. Otherwise a closed pane leaves a stale
  // snapshot that shows as a ghost agent, inflates the aggregate cost total, and
  // keeps its dead session in the foreign exclude-set. `allPaneIds()` reads
  // `workspace.workspaces` (+ each registry) reactively, so this re-runs on every
  // such change; `retain` is a no-op (no reactive write) when nothing is stale.
  $effect(() => {
    snapshots.retain(workspace.allPaneIds());
  });

  // With no workspaces left (first launch, or the last agent closed/exited), the
  // grid would render blank — so fall back to the overview (its empty state). Reads
  // `workspace.workspaces` reactively, so it fires whenever the list empties.
  $effect(() => {
    if (workspace.workspaces.length === 0 && view.isGrid) view.show('overview');
  });

  // Auto-retire finished agents: the moment an agent's process EXITS (cleanly or
  // with an error), close its pane/workspace so it disappears from every surface —
  // and, if you were looking at that very pane in the grid, drop you back to the
  // overview rather than stranding you in a dead terminal. The runtime registry is
  // non-reactive (it's a per-byte side channel), so we scan it on a 1s clock. The
  // last remaining workspace can't be removed (closeWorkspace keeps one), so a lone
  // finished agent lingers instead of leaving the app paneless.
  $effect(() => {
    const id = setInterval(() => {
      const exited = Object.entries(runtimeMap())
        .filter(([, r]) => r.exited)
        .map(([paneId]) => paneId);
      if (exited.length === 0) return;
      const live = workspace.allPaneIds();
      const focused = workspace.focusedPaneId;
      for (const paneId of exited) {
        if (!live.has(paneId)) continue; // already retired
        const wasViewing = view.isGrid && paneId === focused;
        workspace.closeAgent(paneId);
        if (wasViewing) view.show('overview');
      }
    }, 1000);
    return () => clearInterval(id);
  });

  // Keyboard shortcuts (macOS):
  //   Cmd-N            open the session LAUNCHER (folder picker + recents +
  //                    optional prompt + placement). The deliberate, full-flow
  //                    "new session" entry point.
  //   Cmd-T            quick-new-workspace in the rail — KEPT AS-IS: an instant,
  //                    no-dialog `claude` tab inheriting the focused pane's cwd
  //                    (the launcher is the considered path; Cmd-T is the fast path).
  //   Cmd-D            split row, new pane to the right
  //   Cmd-Shift-D      split col, new pane below
  //   Cmd-W            close the focused pane
  //   Cmd-]            focus next (cyclic, DFS +1)
  //   Cmd-[            focus prev (cyclic, DFS -1)
  //   Alt-Arrow        directional focus (spatial neighbor)
  function onKeydown(e: KeyboardEvent) {
    const meta = e.metaKey;
    const alt = e.altKey;
    const key = e.key;

    // While the launcher modal is open it owns the keyboard (its own Esc /
    // Cmd-Enter); don't let app pane shortcuts fire underneath it.
    if (launcher.open) return;

    // Cmd-N opens the launcher. Available even before the store is seeded so the
    // very first session can be launched through the full flow if desired.
    if (meta && (key === 'n' || key === 'N')) {
      e.preventDefault();
      launcher.show();
      return;
    }

    // Cmd-O cycles the top-level view: overview (cards) -> windows (terminals) ->
    // grid -> overview. Available regardless of store state — the overviews are
    // meaningful even before any pane is seeded.
    if (meta && !e.shiftKey && (key === 'o' || key === 'O')) {
      e.preventDefault();
      view.cycle();
      return;
    }

    // The remaining shortcuts MUTATE the active workspace's pane layout/focus, so
    // they are GRID-ONLY: in the Overview there is no live grid to act on (and the
    // user expects those keys inert). The view-level shortcuts above (N/O) already
    // returned, so they keep working in every view.
    if (!view.isGrid) return;

    // Ignore the remaining (pane) shortcuts before the store is seeded.
    if (!workspace.active) return;

    if (meta && (key === 't' || key === 'T')) {
      e.preventDefault();
      workspace.newWorkspace();
      return;
    }
    if (meta && (key === 'd' || key === 'D')) {
      e.preventDefault();
      // Shift => vertical (col, new pane below); plain => horizontal (row, right).
      workspace.split(e.shiftKey ? 'col' : 'row', 'after');
      return;
    }
    if (meta && (key === 'w' || key === 'W')) {
      e.preventDefault();
      workspace.closeFocused();
      return;
    }
    if (meta && key === ']') {
      e.preventDefault();
      workspace.focusNext();
      return;
    }
    if (meta && key === '[') {
      e.preventDefault();
      workspace.focusPrev();
      return;
    }
    if (alt && key.startsWith('Arrow')) {
      const dir = arrowDir(key);
      if (dir) {
        e.preventDefault();
        workspace.focusDirectional(dir, rectsSnapshot());
      }
      return;
    }
  }

  function arrowDir(key: string): SpatialDir | null {
    switch (key) {
      case 'ArrowLeft':
        return 'left';
      case 'ArrowRight':
        return 'right';
      case 'ArrowUp':
        return 'up';
      case 'ArrowDown':
        return 'down';
      default:
        return null;
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="app">
  <!-- Custom title bar. With macOS titleBarStyle "Overlay" the native traffic
       lights float over the left of this bar, so we pad-left to clear them and
       make the whole bar a drag region instead of drawing our own dots. -->
  <header class="titlebar" data-tauri-drag-region>
    <div class="tb-left">
      <img class="logo" src="/logomark.svg" alt="" aria-hidden="true" />
      <span class="title">agent-desktop</span>
    </div>

    <!-- Top-level view control, centered: Overview (cards) · Windows (terminals)
         · Grid. Cmd-O cycles the same. data-tauri-drag-region is OFF so clicks
         register instead of dragging the window. -->
    <div class="view-seg" data-tauri-drag-region="false">
      {#each viewSegments as seg (seg.mode)}
        <button
          type="button"
          class="seg-btn"
          class:on={view.mode === seg.mode}
          title={`${seg.label} (⌘O)`}
          onclick={() => view.show(seg.mode)}
        >
          {seg.label}
        </button>
      {/each}
    </div>

    <!-- Right group: empty, but kept as an equal-flex spacer so the view switcher
         stays in the true horizontal center of the bar. -->
    <div class="tb-right"></div>
  </header>

  <!-- Hold off rendering the workspace area (grid + overview + workflow) until the
       persisted layout has loaded (or fallen back to fresh), so we never flash a
       throwaway workspace whose PTYs we'd immediately tear down. The title bar
       above stays visible throughout; this only gates the body/views. -->
  {#if restored}
  <!-- The terminal-grid surface (rail + panes + usage bar). Kept MOUNTED at all
       times so every workspace's xterm/PTY survives a view switch; hidden (not
       unmounted) while the Overview is the active top-level view. -->
  <div class="grid-view" class:hidden={!view.isGrid}>
  <div class="body">
    <!-- Left vertical session rail (fixed width). Switches the active workspace;
         never renders panes itself. -->
    <SessionRail />

    <!-- The workspace area. EVERY workspace's PaneNode stays mounted; inactive
         ones are display:none so their xterm + PTY survive untouched. Only the
         active workspace is interactive and feeds WebGL/rects. -->
    <main class="surface">
      {#each workspace.workspaces as ws (ws.id)}
        {@const isActive = ws.id === workspace.activeWorkspaceId}
        <div class="workspace" class:hidden={!isActive}>
          <PaneNode node={ws.ws.root} workspaceId={ws.id} activeWorkspace={isActive} />
        </div>
      {/each}
    </main>
  </div>

    <!-- Two-row usage dashboard, pinned full-width at the bottom below the body.
         Reads the snapshots store + workspace focus; all rollup math is pure. -->
    <UsageBar />
  </div>

  <!-- The OVERVIEW surfaces (cards + terminal windows). Rendered only while one is
       the active top-level view; the grid above stays mounted (hidden) so its PTYs
       are untouched. Both read the snapshots + workspace + subagent stores (pure
       view-model math), share the project panel/filter, and the Windows view reads
       the live xterm tails of those same mounted panes. -->
  {#if view.isOverview}
    <Overview />
  {:else if view.isWindows}
    <Windows />
  {/if}
  {:else}
    <!-- Minimal splash while the persisted layout is restoring; replaced by the
         workspace area as soon as `restored` flips true. -->
    <div class="restoring">Restoring…</div>
  {/if}
</div>

<!-- Single app-wide pane context menu (right-click). Position:fixed, so it can
     live at the markup root. -->
<PaneContextMenu />

<!-- The session launcher modal. Opened from the rail "+ new session" row, the
     pane context-menu "New Session" item, and the Cmd-N shortcut (all via the
     shared `launcher` store). Position:fixed backdrop, so it lives at the root. -->
<Launcher />

<style>
  .app {
    /* Positioned ancestor for the absolutely-positioned Overview
       (position:absolute;inset:0). Without this it'd resolve its containing
       block to the viewport and cover the title bar; with .app relative it sits
       within the app area, below the title bar. */
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
    background: var(--space-850);
    overflow: hidden;
  }

  .titlebar {
    display: flex;
    align-items: center;
    gap: 9px;
    height: 40px;
    flex: 0 0 40px;
    padding: 0 14px 0 80px;
    background: var(--space-900);
    border-bottom: 1px solid var(--line-subtle);
    user-select: none;
    -webkit-user-select: none;
  }

  /* Left group (logo + title) and right group (env) each take equal flex so the
     view switcher between them sits in the true horizontal center of the bar. */
  .tb-left {
    flex: 1 1 0;
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
  }
  .tb-right {
    flex: 1 1 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    min-width: 0;
  }

  .logo {
    width: 18px;
    height: 18px;
    flex: none;
    pointer-events: none;
  }

  .title {
    font-family: var(--font-display);
    font-size: 13px;
    font-weight: 600;
    color: var(--fg-2);
    letter-spacing: -0.01em;
    pointer-events: none;
  }

  /* Top-level view segmented control. pointer-events re-enabled (the bar is a
     drag region) so clicks land; sits just right of the title. */
  .view-seg {
    pointer-events: auto;
    flex: none;
    display: inline-flex;
    gap: 2px;
    padding: 3px;
    border-radius: var(--r-md);
    background: var(--space-800);
    border: 1px solid var(--line-subtle);
  }
  .seg-btn {
    height: 20px;
    padding: 0 11px;
    border: none;
    border-radius: 5px;
    background: none;
    color: var(--fg-3);
    font-size: 11px;
    font-weight: 600;
    font-family: var(--font-sans);
    cursor: pointer;
    transition:
      background var(--dur-fast),
      color var(--dur-fast);
  }
  .seg-btn:hover {
    color: var(--fg-1);
  }
  .seg-btn.on {
    background: var(--space-650);
    color: var(--fg-1);
  }

  /* The grid-view wrapper fills the region below the title bar (body + usage bar)
     as a flex column. Hidden (not unmounted) while the Overview is active so every
     workspace's xterm/PTY survives the switch untouched. */
  .grid-view {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .grid-view.hidden {
    display: none;
  }

  /* Minimal "Restoring…" splash shown until the persisted layout resolves. Fills
     the area below the title bar and centers a dim label. */
  .restoring {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--fg-3);
    font-size: 13px;
    font-family: var(--font-mono);
  }


  /* Below the title bar: rail (fixed) + workspace area (fills the rest). */
  .body {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: row;
  }

  /* The session rail occupies a fixed left column. */
  .body :global(nav.rail) {
    flex: 0 0 200px;
    width: 200px;
  }

  .surface {
    flex: 1 1 auto;
    min-height: 0;
    min-width: 0;
    position: relative;
    background: var(--space-850);
  }

  /* Each workspace fills the surface; inactive ones are hidden but stay mounted
     (display:none keeps the xterm + PTY alive without painting/layout cost). */
  .workspace {
    position: absolute;
    inset: 0;
  }
  .workspace.hidden {
    display: none;
  }
</style>
