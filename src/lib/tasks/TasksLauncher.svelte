<script lang="ts">
  // The LEFT Tasks launcher (tasks-panel spec — "Tasks launcher panel" + "Task
  // launcher controls"). It is the CATALOG / launch surface for the Tasks feature:
  // it lists the ACTIVE PROJECT's task DEFINITIONS (terminal + agent kinds, running
  // or idle). CLICKING a row starts the task (or, if it's already running, reveals
  // the Terminals panel); RIGHT-CLICK opens a context menu to edit/delete (and to
  // stop a running task / dismiss a failed one). Create via the header ＋. Running
  // terminal panes live in the separate right-docked Terminals panel.
  //
  // Self-contained (no props): it derives its own active project exactly like the
  // right panel does — selected project filter wins, else the focused agent's
  // project. Agent-task runtime isn't tracked (agents are workspace sessions, not
  // right-panel panes — design D5), so agent rows show a best-effort idle dot.
  import Icon from '../icons/Icon.svelte';
  import { tooltip } from '../ui/tooltip';
  import ContextMenu, { type MenuItem } from '../ui/ContextMenu.svelte';
  import { workspace } from '../layout/workspace.svelte';
  import { projectFilter } from '../projects/projectFilter.svelte';
  import { ALL, UNASSIGNED } from '../projects/projectRollup';
  import { activeProjectId } from './activeProject';
  import { projectTasks } from './projectTasks.svelte';
  import { tasksPanel } from './panel.svelte';
  import { taskDialog } from './taskDialogStore.svelte';
  import type { TaskDef } from './projectTasks';

  // A concrete project chosen in the overview's project filter (null on All /
  // Unassigned) pins the launcher; otherwise it follows the focused agent's project.
  const selectedProjectId = $derived(
    projectFilter.selected === ALL || projectFilter.selected === UNASSIGNED
      ? null
      : projectFilter.selected
  );
  const activeId = $derived(
    activeProjectId({
      focusedId: workspace.active ? workspace.focusedId : '',
      projectIdOf: (id) => workspace.session(id).projectId,
      selectedProjectId
    })
  );
  const tasks = $derived(activeId ? projectTasks.forProject(activeId) : []);

  /** Status of a row → which dot to show. Agent runtime is untracked (best-effort
   *  idle); a terminal reflects its live runtime (running / failed / idle). */
  function dotKind(def: TaskDef): 'running' | 'failed' | 'idle' {
    if (def.kind === 'agent') return 'idle';
    if (projectTasks.runtime[def.id]?.running) return 'running';
    if (projectTasks.isFailed(def.id)) return 'failed';
    return 'idle';
  }

  /** The dim sub-label: the command (terminal) or a truncated prompt (agent). */
  function subLabel(def: TaskDef): string {
    if (def.kind === 'agent') {
      const p = (def.prompt ?? '').trim().replace(/\s+/g, ' ');
      return p.length > 64 ? `${p.slice(0, 63)}…` : p || 'agent prompt';
    }
    const c = (def.command ?? '').trim();
    return c || 'interactive shell';
  }

  function isRunning(def: TaskDef): boolean {
    return def.kind === 'terminal' && projectTasks.runtime[def.id]?.running === true;
  }

  // --- Row interactions -------------------------------------------------------
  function start(id: string) {
    projectTasks.startTask(id);
    tasksPanel.open = true;
  }

  /** Click a row: a running terminal reveals the Terminals panel; anything else
   *  (idle / failed / agent) starts (or restarts / launches) the task. */
  function rowClick(def: TaskDef) {
    if (isRunning(def)) tasksPanel.open = true;
    else start(def.id);
  }

  // --- Drag-to-reorder the task list ------------------------------------------
  // Dropping one row onto another reorders the active project's task list
  // (projectTasks.reorder → reorderTask + per-project save), so the manual order
  // survives restart. `dragId` is the row being dragged; `dragOverId` is the
  // current drop target (for the highlight). The draggable element is a <div>,
  // not a <button>: WKWebView (Tauri/macOS) won't start a native drag from a form
  // control.
  let dragId = $state<string | null>(null);
  let dragOverId = $state<string | null>(null);

  function onDragStart(e: DragEvent, id: string) {
    dragId = id;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      // Some browsers refuse to start a drag unless data is set.
      e.dataTransfer.setData('text/plain', id);
    }
  }
  function onDragOver(e: DragEvent, id: string) {
    if (!dragId || dragId === id) return;
    e.preventDefault(); // allow the drop
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    dragOverId = id;
  }
  function onDrop(e: DragEvent, id: string) {
    e.preventDefault();
    if (dragId && dragId !== id) void projectTasks.reorder(dragId, id);
    dragId = null;
    dragOverId = null;
  }
  function onDragEnd() {
    dragId = null;
    dragOverId = null;
  }

  // --- Right-click context menu (edit / delete, plus stop / dismiss) ----------
  let menu = $state<{ open: boolean; x: number; y: number; items: MenuItem[] }>({
    open: false,
    x: 0,
    y: 0,
    items: []
  });

  function openMenu(e: MouseEvent, def: TaskDef) {
    e.preventDefault();
    const items: MenuItem[] = [];
    if (isRunning(def)) {
      items.push({ label: 'Stop', icon: 'square', onClick: () => projectTasks.stop(def.id) });
    } else if (def.kind === 'terminal' && projectTasks.isFailed(def.id)) {
      items.push({ label: 'Dismiss', icon: 'x', onClick: () => projectTasks.dismiss(def.id) });
    }
    items.push({ label: 'Edit…', icon: 'pencil', onClick: () => taskDialog.showEdit(def.id, activeId) });
    items.push({
      label: 'Delete',
      icon: 'trash-2',
      danger: true,
      onClick: () => {
        if (confirm(`Delete task "${def.name}"?`)) projectTasks.remove(def.id);
      }
    });
    menu = { open: true, x: e.clientX, y: e.clientY, items };
  }
</script>

<section class="launcher" aria-label="Tasks launcher">
  <header class="lh">
    <h1>Tasks <span class="count">{tasks.length}</span></h1>
    <button
      type="button"
      class="launch"
      onclick={() => taskDialog.showCreate(activeId)}
      disabled={!activeId}
      aria-label="New task"
      use:tooltip={'New task'}
    >＋</button>
  </header>

  <div class="body">
    {#if !activeId}
      <div class="hint">
        <p>No project.</p>
        <p class="sub">Pick a project or focus an agent to manage its tasks.</p>
      </div>
    {:else if tasks.length === 0}
      <div class="hint">
        <p>No tasks yet.</p>
        <p class="sub">Add one to run a command or a Claude prompt.</p>
      </div>
    {:else}
      <ul class="rows">
        {#each tasks as def (def.id)}
          {@const dot = dotKind(def)}
          {@const running = dot === 'running'}
          {@const failed = dot === 'failed'}
          <li class="row">
            <!-- A div (not a <button>): WKWebView (Tauri/macOS) refuses to start a
                 native HTML5 drag from a form control, so the draggable row must be
                 a plain element. role/tabindex/onkeydown restore button semantics. -->
            <div
              class="rowbtn"
              class:dragging={dragId === def.id}
              class:dragover={dragOverId === def.id}
              role="button"
              tabindex="0"
              draggable="true"
              ondragstart={(e) => onDragStart(e, def.id)}
              ondragover={(e) => onDragOver(e, def.id)}
              ondrop={(e) => onDrop(e, def.id)}
              ondragend={onDragEnd}
              onclick={() => rowClick(def)}
              onkeydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  rowClick(def);
                }
              }}
              oncontextmenu={(e) => openMenu(e, def)}
              use:tooltip={running ? 'Click to reveal' : 'Click to start'}
            >
              <span class="dot" class:on={running} class:fail={failed}></span>
              <Icon name={def.kind === 'agent' ? 'bot' : 'terminal'} size={13} />
              <span class="nm">
                <span class="t">{def.name}</span>
                <span class="s">{subLabel(def)}</span>
              </span>
            </div>
          </li>
        {/each}
      </ul>
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

<style>
  .launcher {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--space-900);
    overflow: hidden;
  }

  /* Agents-bar-style header (mirrors Inbox.svelte's `.lh`). */
  .lh {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 15px 16px 11px;
    flex: none;
  }
  .lh h1 {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 17px;
    margin: 0;
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .lh .count {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-3);
    background: var(--space-750);
    border: 1px solid var(--line-subtle);
    border-radius: var(--r-full);
    padding: 2px 8px;
  }
  .lh .launch {
    margin-left: auto;
    font-family: var(--font-sans);
    font-weight: 700;
    font-size: 15px;
    color: #fff;
    background: var(--blue-500);
    border: none;
    border-radius: var(--r-md);
    width: 30px;
    height: 30px;
    cursor: pointer;
  }
  .lh .launch:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding-bottom: 6px;
  }

  .hint {
    padding: 18px 16px;
    text-align: center;
    color: var(--fg-3);
    font-size: 12px;
  }
  .hint .sub {
    color: var(--fg-4);
    font-size: 11px;
    margin-top: 4px;
  }

  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .row {
    display: flex;
  }
  /* The whole row is a click target: click to start (or reveal), right-click for
     the edit/delete menu. */
  .rowbtn {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px 16px;
    border: none;
    border-left: 2px solid transparent;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
    font: inherit;
  }
  .rowbtn:hover {
    background: var(--line-faint);
  }
  /* Drag-to-reorder: the lifted row dims; the drop target shows a neutral ring (the
     move lands AT the target's slot). `-webkit-user-drag: element` is required for
     WebKit (WKWebView) to honor the drag — the `draggable` attribute alone is
     unreliable there. */
  .rowbtn[draggable='true'] {
    cursor: grab;
    -webkit-user-drag: element;
  }
  .rowbtn.dragging {
    opacity: 0.45;
  }
  .rowbtn.dragover {
    box-shadow: inset 0 0 0 1px var(--blue-300);
    background: var(--blue-tint);
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--fg-3);
    flex: none;
  }
  .dot.on {
    background: var(--nominal-500);
  }
  .dot.fail {
    background: var(--danger);
  }
  .rowbtn :global(.mc-icon) {
    color: var(--fg-3);
  }
  .nm {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .nm .t {
    font-size: 13px;
    font-weight: 600;
    color: var(--fg-1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .nm .s {
    font-size: 11px;
    color: var(--fg-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-top: 1px;
  }
</style>
