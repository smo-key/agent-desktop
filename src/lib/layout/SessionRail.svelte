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

  // Inline-rename bookkeeping. `editingId` is the workspace being renamed (double
  // click a row label to start); `draft` holds the in-progress text.
  let editingId = $state<string | null>(null);
  let draft = $state('');

  function switchTo(id: string) {
    if (editingId === id) return; // don't steal a rename-in-progress click
    workspace.setActiveWorkspace(id);
  }

  function addSession() {
    workspace.newWorkspace();
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

  function startRename(id: string, current: string) {
    editingId = id;
    draft = current;
  }

  function commitRename() {
    if (editingId) workspace.renameWorkspace(editingId, draft);
    editingId = null;
    draft = '';
  }

  function cancelRename() {
    editingId = null;
    draft = '';
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
          ondblclick={() => startRename(ws.id, ws.name)}
        >
          <!-- Active dot: bright when active, dim otherwise (PTYs alive either
               way; the dot signals which session you're looking at). -->
          <span class="dot" class:on={isActive} aria-hidden="true"></span>

          {#if editingId === ws.id}
            <!-- svelte-ignore a11y_autofocus -->
            <input
              class="rename"
              bind:value={draft}
              onkeydown={onRenameKey}
              onblur={commitRename}
              onclick={(e) => e.stopPropagation()}
              autofocus
            />
          {:else}
            <span class="name" title={ws.name}>{ws.name}</span>
          {/if}

          {#if workspace.workspaces.length > 1}
            <button
              class="close"
              title="Close session"
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
    background: #0b0f14;
    border-right: 1px solid #21262d;
    user-select: none;
    -webkit-user-select: none;
    overflow: hidden;
  }

  .rail-head {
    flex: 0 0 auto;
    padding: 8px 10px 4px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #6e7681;
  }

  .list {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    list-style: none;
    margin: 0;
    padding: 2px 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    padding: 0 6px;
    border-radius: 6px;
    cursor: pointer;
    color: #adbac7;
    transition:
      background 0.1s ease,
      color 0.1s ease;
  }
  .row:hover {
    background: #161b22;
  }
  .row.active {
    background: #1c2128;
    color: #e6edf3;
    box-shadow: inset 0 0 0 1px #30363d;
  }

  .dot {
    flex: 0 0 auto;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #30363d;
    transition: background 0.1s ease;
  }
  .dot.on {
    background: #3fb950;
    box-shadow: 0 0 0 2px rgba(63, 185, 80, 0.18);
  }

  .name {
    flex: 1 1 auto;
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rename {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 12px;
    font-family: inherit;
    color: #e6edf3;
    background: #0d1117;
    border: 1px solid #58a6ff;
    border-radius: 4px;
    padding: 1px 4px;
    outline: none;
  }

  .close {
    flex: 0 0 auto;
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: #6e7681;
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
    opacity: 0;
    transition:
      opacity 0.1s ease,
      background 0.1s ease,
      color 0.1s ease;
  }
  .row:hover .close,
  .row.active .close {
    opacity: 1;
  }
  .close:hover {
    background: #30363d;
    color: #f0f6fc;
  }

  .new {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 4px 6px 8px;
    padding: 0 8px;
    height: 30px;
    border: 1px dashed #30363d;
    border-radius: 6px;
    background: transparent;
    color: #8b949e;
    font-size: 12px;
    cursor: pointer;
    transition:
      border-color 0.1s ease,
      color 0.1s ease,
      background 0.1s ease;
  }
  .new:hover {
    border-color: #58a6ff;
    color: #e6edf3;
    background: #161b22;
  }
  .plus {
    font-size: 14px;
    line-height: 1;
  }
</style>
