<script lang="ts">
  // Modal dialog for MANAGING a project's git worktrees (add-project-auto-worktree,
  // group 6). A thin shell (backdrop + centered dialog, Esc / backdrop / close —
  // the SettingsModal/ProjectDialog pattern) over the `WorktreePanel` view-model,
  // which owns the tested logic (list / open / prune). This just renders the
  // worktree rows (path · branch · clean/changed), an empty state, and the
  // per-row Open / Prune actions.

  import { WorktreePanel, type Worktree } from './worktreePanel.svelte';
  import Icon from '../icons/Icon.svelte';
  import { autofocus } from '$lib/ui/autofocus';

  let {
    projectId,
    projectName,
    repoPath,
    onClose
  }: {
    projectId: string;
    projectName: string;
    repoPath: string;
    onClose: () => void;
  } = $props();

  // One panel per project/repo pair; recreated if the props ever change (in
  // practice the dialog is rendered fresh per open, so this reads as construct-once).
  const panel = $derived(new WorktreePanel(projectId));

  // Load the project's worktrees on mount (and if the repo path changes).
  $effect(() => {
    void panel.load(repoPath);
  });

  function openWorktree(wt: Worktree) {
    panel.open(wt);
    onClose();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  }
</script>

<!-- Backdrop: a click outside the dialog closes. -->
<div class="backdrop" role="presentation" onclick={onClose} onkeydown={onKeydown}>
  <!-- stopPropagation on click so an inside click doesn't close. -->
  <div
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-label="Worktrees"
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={onKeydown}
  >
    <header class="head">
      <h2>Worktrees — {projectName}</h2>
      <!-- Focus the close button on open: per-row Open/Prune are too consequential
           (and Prune is destructive) to be the default Enter target. -->
      <button class="x" aria-label="Close" onclick={onClose} use:autofocus>
        <Icon name="x" size={15} color="var(--fg-3)" />
      </button>
    </header>

    {#if panel.worktrees.length === 0}
      <p class="empty">No worktrees for this project.</p>
    {:else}
      <ul class="rows">
        {#each panel.worktrees as wt (wt.path)}
          <li class="row">
            <div class="info">
              <span class="path" title={wt.path}>{wt.path}</span>
              <span class="meta">
                <span class="branch">{wt.branch ?? 'detached'}</span>
                <span class="state" class:changed={!wt.clean}>
                  {wt.clean ? 'clean' : 'changed'}
                </span>
              </span>
            </div>
            <div class="actions">
              <button type="button" class="act" onclick={() => openWorktree(wt)}>Open</button>
              <button
                type="button"
                class="act danger"
                onclick={() => void panel.prune(wt)}>Prune</button
              >
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 2000;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 10vh;
    background: rgba(4, 6, 10, 0.66);
    backdrop-filter: blur(3px);
  }
  .dialog {
    width: min(560px, calc(100vw - 32px));
    max-height: 80vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 18px 20px 20px;
    background: var(--space-800);
    border: 1px solid var(--line-default);
    border-radius: var(--r-xl);
    box-shadow: var(--shadow-lg);
    color: var(--fg-1);
    font-family: var(--font-sans);
    outline: none;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .head h2 {
    margin: 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-display);
    font-size: 17px;
    font-weight: 600;
    letter-spacing: var(--tracking-tight);
  }
  .x {
    flex: none;
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    cursor: pointer;
  }
  .x:hover {
    background: var(--line-faint);
  }

  .empty {
    margin: 0;
    padding: 18px 0;
    color: var(--fg-3);
    font-size: 13px;
    text-align: center;
  }

  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 0;
    border-bottom: 1px solid var(--line-faint);
  }
  .row:last-child {
    border-bottom: none;
  }
  .info {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .path {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--fg-1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
  }
  .branch {
    font-family: var(--font-mono);
    color: var(--fg-3);
  }
  .state {
    font-family: var(--font-mono);
    color: var(--fg-4);
  }
  .state.changed {
    color: var(--orange-500);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .act {
    font-size: 12.5px;
    padding: 5px 12px;
    border-radius: var(--r-sm);
    border: 1px solid var(--line-default);
    background: var(--space-650);
    color: var(--fg-1);
    cursor: pointer;
  }
  .act:hover {
    background: var(--space-600);
    border-color: var(--line-strong);
  }
  .act.danger {
    color: var(--red-300, var(--fg-2));
  }
  .act.danger:hover {
    border-color: var(--red-500, var(--line-strong));
  }
</style>
