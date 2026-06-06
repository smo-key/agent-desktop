<script lang="ts">
  import { onMount } from 'svelte';
  import PaneNode from '$lib/layout/PaneNode.svelte';
  import PaneContextMenu from '$lib/layout/PaneContextMenu.svelte';
  import SessionRail from '$lib/layout/SessionRail.svelte';
  import Launcher from '$lib/launcher/Launcher.svelte';
  import { launcher } from '$lib/launcher/launcherStore.svelte';
  import HelpModal from '$lib/ui/HelpModal.svelte';
  import { help } from '$lib/ui/helpStore.svelte';
  import { startNewSession } from '$lib/launcher/newSession';
  import { workspace } from '$lib/layout/workspace.svelte';
  import { rectsSnapshot } from '$lib/layout/rects.svelte';
  import { restorePersistedLayout, watchAndPersist } from '$lib/layout/store-backend.svelte';
  import { snapshots } from '$lib/usage/snapshots.svelte';
  import { appSessionIds } from '$lib/usage/appSessions';
  import AppFooter from '$lib/usage/AppFooter.svelte';
  import Inbox from '$lib/overview/Inbox.svelte';
  import { portal } from '$lib/layout/portal';
  import { surfaceSlot } from '$lib/layout/surfaceSlot.svelte';
  import { view } from '$lib/overview/view.svelte';
  import { subagents, type SessionRef } from '$lib/overview/subagents.svelte';
  import { activity, type PaneRef } from '$lib/overview/activity.svelte';
  import { events } from '$lib/overview/events.svelte';
  import { titles } from '$lib/overview/titles.svelte';
  import { triggersTranscriptRead, SAFETY_POLL_MS } from '$lib/overview/poll';
  import { appSessionRefs } from '$lib/overview/sessionRefs';
  import { type SpatialDir } from '$lib/layout/tree';

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
    void refreshActivity();

    // Start the EVENT pipeline store: seed each pane's timeline (ring → durable
    // sink → transcript backfill, resolved in Rust), then subscribe to live
    // `overview://event` pushes. Each ingested event that signals visible content
    // changed (a tool completing / a turn ending) triggers an immediate transcript
    // read — replacing the old fixed 1.5s poll.
    events.onEvent = (ev) => {
      if (triggersTranscriptRead(ev.hookEventName)) void refreshActivity();
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

  // Refresh transcript activity, then ask the titles store to regenerate any Haiku
  // session title whose user-messages hash changed (gated + throttled in the store,
  // so this is cheap to call often).
  async function refreshActivity(): Promise<void> {
    const refs = currentPaneRefs();
    if (refs.length === 0) return;
    await activity.refresh(refs);
    titles.refresh(refs, (paneId) => activity.forPane(paneId).userHash, Date.now());
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
      void refreshActivity();
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

  // NOTE: finished (exited) agents are intentionally NOT auto-closed. They linger
  // in the inbox's "Completed" group so you keep seeing your finished work (and
  // they are remembered across restarts — the layout, including exited claude
  // sessions, is persisted and resumed with `claude --resume`). Close a session
  // explicitly from the inbox (the ✕ in the focus header or the row's right-click
  // menu). This also satisfies "don't auto-advance away to nothing".

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

    // Help overlay: Cmd-/ toggles it from anywhere; bare ? opens it too, but only
    // when NOT typing into a field/terminal, so a literal "?" still reaches prompts
    // and the xterm terminal (Cmd-/ is the always-safe path). Handled before the
    // per-view guards so help works in every view; `help.open` below then blocks the
    // pane shortcuts beneath the modal (the modal owns its own Esc).
    if (meta && key === '/') {
      e.preventDefault();
      help.toggle();
      return;
    }
    if (key === '?' && !meta && !alt && !e.ctrlKey && !isEditableTarget(e.target)) {
      e.preventDefault();
      help.show();
      return;
    }
    // While the help modal is open it owns the keyboard: Esc closes it (the modal's
    // own handler only fires when focus is inside it, so cover it here too) and we
    // block the pane shortcuts beneath.
    if (help.open) {
      if (key === 'Escape') {
        e.preventDefault();
        help.close();
      }
      return;
    }

    // While the launcher modal is open it owns the keyboard (its own Esc /
    // Cmd-Enter); don't let app pane shortcuts fire underneath it.
    if (launcher.open) return;

    // Cmd-N starts a new session: straight into the selected project (no popup), or
    // the launcher when no single project is in focus. Same path as the inbox "+".
    if (meta && (key === 'n' || key === 'N')) {
      e.preventDefault();
      startNewSession();
      return;
    }

    // The remaining shortcuts MUTATE the active workspace's pane layout/focus, so
    // they are GRID-ONLY. The grid is no longer a navigable top-level view (the
    // inbox shows each agent's live terminal in its focus pane), so `view.isGrid`
    // is never true and these stay inert — the grid surface persists only as the
    // hidden home the inbox teleports terminals out of. Cmd-N (launcher) above
    // still works in every view.
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

  // True when the event target is a text-entry surface (an input/textarea/
  // contenteditable, or the xterm terminal — which captures keys via a hidden
  // <textarea>). Used to keep the bare-? help shortcut from hijacking a typed "?".
  function isEditableTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el || !el.tagName) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true;
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
    <!-- The ENTIRE bar is a drag region. Tauri only starts a drag when the
         mousedown TARGET carries `data-tauri-drag-region`, so every layout cell
         gets it too (otherwise their empty areas are dead zones). Interactive
         bits opt out via pointer-events (logo/title are :none so they pass the
         drag through; the usage meter's hover targets keep pointer events). -->
    <div class="tb-left" data-tauri-drag-region></div>
    <div class="tb-center" data-tauri-drag-region>
      <img class="logo" src="/logomark.svg" alt="" aria-hidden="true" />
      <span class="title">Agent Mission Control</span>
    </div>
    <div class="tb-right" data-tauri-drag-region>
      <!-- Opt back into pointer events (the bar is a drag region) so the button is
           clickable. Opens the same shortcuts modal as Cmd-/ and bare ?. -->
      <button class="help-btn" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (⌘/)" onclick={() => help.show()}>?</button>
    </div>
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
    <main class="surface" use:portal={surfaceSlot.target}>
      {#each workspace.workspaces as ws (ws.id)}
        {@const isActive = ws.id === workspace.activeWorkspaceId}
        <div class="workspace" class:hidden={!isActive}>
          <PaneNode node={ws.ws.root} workspaceId={ws.id} activeWorkspace={isActive} />
        </div>
      {/each}
    </main>
  </div>

    <!-- Persistent footer, pinned full-width below the body: project chip + 5h/7d
         limit bars (left) | git + context bar (right). All math is in the pure
         `footerView`. -->
    <AppFooter />
  </div>

  <!-- The INBOX overview surface. Rendered only while overview is the active
       top-level view; the grid above stays mounted (hidden) so its PTYs are
       untouched. The inbox reads the snapshots + workspace + subagent stores
       (pure view-model math) and teleports the live grid surface into its focus
       pane — no PTY is ever double-spawned. -->
  {#if view.isOverview}
    <Inbox />
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
<HelpModal />

<style>
  .app {
    /* Positioned ancestor (position:relative) and flex column for the app body.
       Without position:relative, any absolutely-positioned descendants (e.g.
       workspace tiles) would resolve their containing block to the viewport and
       cover the title bar. The flex column stacks title bar above the body. */
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

  /* Left (logo) and right (usage meter) take equal flex so the centered title
     sits in the true horizontal center of the bar. */
  .tb-left {
    flex: 1 1 0;
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
  }
  .tb-center {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
  .tb-right {
    flex: 1 1 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    min-width: 0;
  }

  .help-btn {
    flex: none;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid var(--line-subtle);
    border-radius: var(--r-full);
    background: transparent;
    color: var(--fg-3);
    font-family: var(--font-display);
    font-size: 12px;
    font-weight: 600;
    line-height: 1;
    cursor: pointer;
    /* The title bar is a drag region (pointer-events suppressed on its children);
       re-enable here so the button is hoverable/clickable. */
    pointer-events: auto;
    transition:
      color var(--dur-fast),
      border-color var(--dur-fast),
      background var(--dur-fast);
  }
  .help-btn:hover {
    color: var(--fg-1);
    border-color: var(--line-strong);
    background: rgba(255, 255, 255, 0.05);
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

  /* The grid-view wrapper fills the region below the title bar (body + usage bar)
     as a flex column. It is no longer a navigable view — it stays mounted but
     hidden (display:none) as the home the inbox teleports each agent's live
     terminal out of, so every workspace's xterm/PTY survives untouched. */
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
