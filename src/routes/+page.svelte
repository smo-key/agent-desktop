<script lang="ts">
  import { onMount } from 'svelte';
  import PaneNode from '$lib/layout/PaneNode.svelte';
  import PaneContextMenu from '$lib/layout/PaneContextMenu.svelte';
  import SessionRail from '$lib/layout/SessionRail.svelte';
  import { workspace } from '$lib/layout/workspace.svelte';
  import { rectsSnapshot } from '$lib/layout/rects.svelte';
  import { restorePersistedLayout, watchAndPersist } from '$lib/layout/store-backend.svelte';
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
    return () => stopWatching?.();
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
  //   Cmd-D            split row, new pane to the right
  //   Cmd-Shift-D      split col, new pane below
  //   Cmd-W            close the focused pane
  //   Cmd-]            focus next (cyclic, DFS +1)
  //   Cmd-[            focus prev (cyclic, DFS -1)
  //   Cmd-T            new workspace (session) in the rail
  //   Alt-Arrow        directional focus (spatial neighbor)
  function onKeydown(e: KeyboardEvent) {
    const meta = e.metaKey;
    const alt = e.altKey;
    const key = e.key;

    // Ignore shortcuts before the store is seeded (active workspace exists).
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
    <span class="subtitle">{focusedCwd}</span>
  </header>

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
</div>

<!-- Single app-wide pane context menu (right-click). Position:fixed, so it can
     live at the markup root. -->
<PaneContextMenu />

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
