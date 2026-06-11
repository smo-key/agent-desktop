<script lang="ts">
  // The left vertical SESSION RAIL: one row per open workspace (session), the
  // active one highlighted, click to switch. A "+ new session" row creates a
  // fresh single-leaf workspace; each row carries a small close affordance that
  // confirms before discarding a workspace with live panes.
  //
  // The rail only mutates the store (`setActiveWorkspace`, `newWorkspace`,
  // `closeWorkspace`, `renameWorkspace`); it renders NO TerminalPanes — the panes
  // for every workspace stay mounted in the route, hidden when inactive, so a
  // switch never touches their xterm/PTY.

  import { workspace } from './workspace.svelte';
  import { launcher } from '$lib/launcher/launcherStore.svelte';
  import { tooltip } from '$lib/ui/tooltip';

  // Inline-rename bookkeeping. `editingId` is the workspace being renamed (double
  // click a row label to start); `draft` holds the in-progress text. The rail is
  // a narrow fixed-width column, so the rename field is rendered as a fixed
  // overlay anchored to the row (`anchorRect`) — this lets it be far wider than
  // the rail without being clipped by the rail's `overflow: hidden`. Its width is
  // clamped to the viewport in CSS so it stays in bounds when the window resizes.
  let editingId = $state<string | null>(null);
  let draft = $state('');
  let anchorRect = $state<{ top: number; left: number; height: number } | null>(null);

  function switchTo(id: string) {
    if (editingId === id) return; // don't steal a rename-in-progress click
    workspace.setActiveWorkspace(id);
  }

  function addSession() {
    // Open the launcher (folder picker + recents + optional prompt + placement)
    // rather than spawning a bare workspace directly.
    launcher.show();
  }

  function requestClose(id: string, name: string, e: MouseEvent) {
    // The close affordance sits inside the clickable row; don't also switch.
    e.stopPropagation();
    // Guard: a workspace with live panes asks for confirmation before its PTYs
    // are killed. The last workspace can't be closed (store guards this too).
    if (workspace.workspaces.length <= 1) return;
    if (workspace.hasPanes(id)) {
      const ok =
        typeof confirm === 'function'
          ? confirm(`Close "${name}"? Its running terminals will be terminated.`)
          : true;
      if (!ok) return;
    }
    workspace.closeWorkspace(id);
  }

  function startRename(id: string, current: string, e: MouseEvent) {
    editingId = id;
    draft = current;
    // Anchor the fixed overlay to the row that was double-clicked. The rail is
    // pinned to the window's left edge with stable row offsets, so this rect
    // stays valid across horizontal window resizes (width is viewport-clamped).
    const row = e.currentTarget as HTMLElement;
    const r = row.getBoundingClientRect();
    anchorRect = { top: r.top, left: r.left, height: r.height };
  }

  function commitRename() {
    if (editingId) workspace.renameWorkspace(editingId, draft);
    editingId = null;
    draft = '';
    anchorRect = null;
  }

  function cancelRename() {
    editingId = null;
    draft = '';
    anchorRect = null;
  }

  function onRenameKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelRename();
    }
  }
</script>

<nav class="rail" aria-label="Sessions">
  <div class="rail-head">Sessions</div>

  <ul class="list">
    {#each workspace.workspaces as ws (ws.id)}
      {@const isActive = ws.id === workspace.activeWorkspaceId}
      <li>
        <div
          class="row"
          class:active={isActive}
          role="button"
          tabindex="0"
          aria-current={isActive ? 'true' : undefined}
          onclick={() => switchTo(ws.id)}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              switchTo(ws.id);
            }
          }}
          ondblclick={(e) => startRename(ws.id, ws.name, e)}
        >
          <!-- Active dot: bright when active, dim otherwise (PTYs alive either
               way; the dot signals which session you're looking at). -->
          <span class="dot" class:on={isActive} aria-hidden="true"></span>

          {#if editingId === ws.id && anchorRect}
            <!-- svelte-ignore a11y_autofocus -->
            <input
              class="rename"
              style="top: {anchorRect.top}px; left: {anchorRect.left}px; height: {anchorRect.height}px; width: min(440px, calc(100vw - {anchorRect.left}px - 16px));"
              bind:value={draft}
              onkeydown={onRenameKey}
              onblur={commitRename}
              onclick={(e) => e.stopPropagation()}
              autofocus
            />
          {:else}
            <span class="name" use:tooltip={ws.name}>{ws.name}</span>
          {/if}

          {#if workspace.workspaces.length > 1}
            <button
              class="close"
              use:tooltip={'Close session'}
              aria-label={`Close ${ws.name}`}
              onclick={(e) => requestClose(ws.id, ws.name, e)}
            >
              ×
            </button>
          {/if}
        </div>
      </li>
    {/each}
  </ul>

  <button class="new" onclick={addSession}>
    <span class="plus" aria-hidden="true">+</span>
    <span>New session</span>
  </button>
</nav>

<style>
  .rail {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    background: var(--space-900);
    border-right: 1px solid var(--line-subtle);
    user-select: none;
    -webkit-user-select: none;
    overflow: hidden;
  }

  .rail-head {
    flex: 0 0 auto;
    padding: 14px 14px 8px;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--fg-4);
  }

  .list {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    list-style: none;
    margin: 0;
    padding: 2px 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 34px;
    padding: 0 10px;
    border-radius: var(--r-md);
    cursor: pointer;
    color: var(--fg-2);
    font-weight: 500;
    transition:
      background var(--dur-fast),
      color var(--dur-fast);
  }
  .row:hover {
    background: rgba(255, 255, 255, 0.04);
    color: var(--fg-1);
  }
  .row.active {
    background: var(--blue-tint);
    color: var(--blue-200);
  }

  .dot {
    flex: 0 0 auto;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--fg-4);
    transition: background var(--dur-fast);
  }
  .dot.on {
    background: var(--nominal-500);
    box-shadow: 0 0 0 2px rgba(60, 203, 127, 0.18);
  }

  .name {
    flex: 1 1 auto;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Rendered as a fixed overlay (positioned inline via `anchorRect`) so it can be
     much wider than the 200px rail without being clipped by `overflow: hidden`.
     The inline `width` clamps to the viewport, so it never overflows the window
     edge and shrinks gracefully when the window is resized narrower. */
  .rename {
    position: fixed;
    z-index: 50;
    box-sizing: border-box;
    font-size: 13px;
    font-family: var(--font-sans);
    color: var(--fg-1);
    background: var(--space-800);
    border: 1px solid var(--blue-500);
    box-shadow: var(--focus-ring);
    border-radius: var(--r-sm);
    padding: 2px 6px;
    outline: none;
  }

  .close {
    flex: 0 0 auto;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: var(--r-xs);
    background: transparent;
    color: var(--fg-4);
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
    opacity: 0;
    transition:
      opacity var(--dur-fast),
      background var(--dur-fast),
      color var(--dur-fast);
  }
  .row:hover .close,
  .row.active .close {
    opacity: 1;
  }
  .close:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--fg-1);
  }

  .new {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 9px;
    margin: 6px 8px 10px;
    padding: 0 10px;
    height: 34px;
    border: 1px dashed var(--line-default);
    border-radius: var(--r-md);
    background: transparent;
    color: var(--fg-3);
    font-family: var(--font-sans);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition:
      border-color var(--dur-fast),
      color var(--dur-fast),
      background var(--dur-fast);
  }
  .new:hover {
    border-color: var(--blue-500);
    color: var(--fg-1);
    background: rgba(255, 255, 255, 0.04);
  }
  .plus {
    font-size: 15px;
    line-height: 1;
  }
</style>
