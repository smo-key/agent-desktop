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
  import { foreign } from '$lib/usage/foreign.svelte';
  import { appSessionIds } from '$lib/usage/appSessions';
  import UsageBar from '$lib/usage/UsageBar.svelte';
  import Overview from '$lib/overview/Overview.svelte';
  import { view } from '$lib/overview/view.svelte';
  import { subagents, type SessionRef } from '$lib/overview/subagents.svelte';
  import { appSessionRefs } from '$lib/overview/sessionRefs';
  import { findLeaf, type SpatialDir } from '$lib/layout/tree';

  const cwd = '/Users/arthur/git/agent-desktop';

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

    // Seed the EXTERNAL (foreign) sessions store with the app's current session
    // ids (so the Rust watcher excludes our own panes), then subscribe to live
    // `usage://foreign` pushes. A separate $effect (below) re-seeds whenever the
    // app's session set changes.
    let unlistenForeign: (() => void) | undefined;
    void foreign.start(appSessionIds(snapshots.byPane)).then((unlisten) => {
      unlistenForeign = unlisten;
    });

    // Seed the SUBAGENTS store (agent-overview) with the app's current app-pane
    // session refs ({sessionId, cwd}), then subscribe to live `overview://subagents`
    // pushes from the Rust subagent watcher. A separate $effect (below) re-seeds the
    // watched-set whenever the app's session set changes.
    let unlistenSubagents: (() => void) | undefined;
    void subagents.start(currentSessionRefs()).then((unlisten) => {
      unlistenSubagents = unlisten;
    });

    return () => {
      stopWatching?.();
      unlistenSnapshots?.();
      unlistenForeign?.();
      unlistenSubagents?.();
    };
  });

  // The app's app-pane session refs ({sessionId, cwd}), joining each snapshot's
  // Claude session id with its pane cwd from the workspace registry (pure helper).
  function currentSessionRefs(): SessionRef[] {
    return appSessionRefs(snapshots.byPane, (paneId) => workspace.session(paneId).cwd);
  }

  // Keep the foreign-session exclude-set current: whenever the app's set of
  // launched session ids changes (a new pane reports a snapshot, or one ends),
  // push it to the Rust watcher AND update the client-side guard via a re-seed.
  // The derived list is sorted + de-duped so this only fires on a real change.
  const ourSessionIds = $derived(appSessionIds(snapshots.byPane));
  $effect(() => {
    const ids = ourSessionIds;
    void foreign.seed(ids);
  });

  // Keep the SUBAGENTS watched-set current too: whenever the app's session refs
  // change (a new app pane reports a session id, a cwd resolves, or one ends),
  // re-seed the Rust `subagents_for` watcher so it watches exactly our sessions.
  // Keyed on the session ids (sorted, stable) so it only fires on a real change.
  $effect(() => {
    void ourSessionIds; // re-run when the app's session set changes
    void subagents.seed(currentSessionRefs());
  });

  // Map the active workspace's focused pane cwd into the title bar subtitle.
  const focusedCwd = $derived.by(() => {
    const entry = workspace.active;
    if (!entry) return cwd;
    const leaf = findLeaf(entry.ws.root, entry.ws.focusedId);
    if (!leaf) return cwd;
    return workspace.session(leaf.paneId).cwd ?? cwd;
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

    // Cmd-O toggles the top-level view between the Overview (mission control) and
    // the terminal grid. Available regardless of store state — the overview is the
    // default surface and is meaningful even before any pane is seeded.
    if (meta && (key === 'o' || key === 'O')) {
      e.preventDefault();
      view.toggle();
      return;
    }

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
    <span class="title">agent-desktop</span>

    <!-- Top-level view toggle: Overview (mission control) <-> terminal grid.
         Cmd-O does the same. data-tauri-drag-region is OFF on the button so the
         click registers instead of dragging the window. -->
    <button
      type="button"
      class="view-toggle"
      data-tauri-drag-region="false"
      title={view.isOverview ? 'Go to terminal grid (⌘O)' : 'Go to overview (⌘O)'}
      onclick={() => view.toggle()}
    >
      {view.isOverview ? 'Grid' : 'Overview'}
    </button>

    <span class="subtitle">{focusedCwd}</span>
  </header>

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

  <!-- The primary OVERVIEW (mission control) surface. Rendered only while it is
       the active top-level view; the grid above stays mounted (hidden) so its
       PTYs are untouched. The overview reads the snapshots + workspace + subagent
       stores (all pure view-model math) and drives navigation back into the grid. -->
  {#if view.isOverview}
    <Overview />
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
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
    background: #0d1117;
    overflow: hidden;
  }

  .titlebar {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    flex: 0 0 32px;
    padding: 0 12px 0 80px;
    background: #161b22;
    border-bottom: 1px solid #21262d;
    user-select: none;
    -webkit-user-select: none;
  }

  .title {
    font-size: 13px;
    font-weight: 600;
    color: #e6edf3;
    letter-spacing: -0.01em;
    pointer-events: none;
  }

  /* Top-level view toggle button. pointer-events re-enabled (the bar is a drag
     region) so the click lands; sits just right of the title. */
  .view-toggle {
    pointer-events: auto;
    height: 20px;
    padding: 0 10px;
    border: 1px solid #30363d;
    border-radius: 6px;
    background: #0d1117;
    color: #adbac7;
    font-size: 11px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition:
      background 0.12s ease,
      color 0.12s ease,
      border-color 0.12s ease;
  }
  .view-toggle:hover {
    background: #1c2128;
    color: #e6edf3;
    border-color: #58a6ff;
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

  .subtitle {
    margin-left: auto;
    font-size: 11px;
    color: #6e7681;
    font-family:
      ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 60%;
    pointer-events: none;
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
    flex: 0 0 150px;
    width: 150px;
  }

  .surface {
    flex: 1 1 auto;
    min-height: 0;
    min-width: 0;
    position: relative;
    background: #0d1117;
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
