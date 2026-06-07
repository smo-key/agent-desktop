<script lang="ts">
  // The LEFT Tasks launcher (tasks-panel spec — "Tasks launcher panel" + "Task
  // launcher controls"). It is the CATALOG / launch surface for the Tasks feature:
  // it lists the ACTIVE PROJECT's task DEFINITIONS (both terminal and agent kinds,
  // running or idle) and lets the user create, start/stop/restart, rename, dismiss,
  // and remove them — plus launch a bare interactive shell. The running terminal
  // panes live in the separate right-docked Tasks panel (RunningTasksPanel); this
  // launcher just drives the lifecycle via the `projectTasks` store and flips
  // `tasksPanel.open` true so the running surface becomes visible.
  //
  // Self-contained (no props): it derives its own active project exactly like the
  // right panel does — selected project filter wins, else the focused agent's
  // project. Agent-task runtime isn't tracked (agents are workspace sessions, not
  // right-panel panes — design D5), so agent rows show a best-effort idle dot.
  import Icon from '../icons/Icon.svelte';
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

  // --- Row actions ------------------------------------------------------------
  function start(id: string) {
    projectTasks.startTask(id);
    tasksPanel.open = true;
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
      title="New task"
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
            <span class="dot" class:on={running} class:fail={failed} title={dot}></span>
            <Icon name={def.kind === 'agent' ? 'bot' : 'terminal'} size={13} />
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span class="nm" ondblclick={() => taskDialog.showEdit(def.id, activeId)}>
              <span class="t" title="Double-click to edit">{def.name}</span>
              <span class="s" title={subLabel(def)}>{subLabel(def)}</span>
            </span>
            <div class="acts">
              {#if def.kind === 'agent'}
                <button class="act" title="Launch" aria-label="Launch agent" onclick={() => start(def.id)}>
                  <Icon name="play" size={12} />
                </button>
              {:else if running}
                <button class="act" title="Stop" aria-label="Stop task" onclick={() => projectTasks.stop(def.id)}>
                  <Icon name="square" size={12} />
                </button>
              {:else if failed}
                <button class="act" title="Restart" aria-label="Restart task" onclick={() => start(def.id)}>
                  <Icon name="play" size={12} />
                </button>
                <button class="act" title="Dismiss" aria-label="Dismiss failure" onclick={() => projectTasks.dismiss(def.id)}>
                  <Icon name="x" size={12} />
                </button>
              {:else}
                <button class="act" title="Start" aria-label="Start task" onclick={() => start(def.id)}>
                  <Icon name="play" size={12} />
                </button>
              {/if}
              <button class="act" title="Edit" aria-label="Edit task" onclick={() => taskDialog.showEdit(def.id, activeId)}>
                <Icon name="pencil" size={12} />
              </button>
              <button
                class="act"
                title="Remove"
                aria-label="Remove task"
                onclick={() => {
                  if (confirm(`Delete task "${def.name}"?`)) projectTasks.remove(def.id);
                }}
              >
                <Icon name="trash-2" size={12} />
              </button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>

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
    align-items: center;
    gap: 9px;
    padding: 8px 12px 8px 16px;
    border-left: 2px solid transparent;
  }
  .row:hover {
    background: rgba(255, 255, 255, 0.025);
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--fg-3);
    flex: none;
  }
  .dot.on {
    background: var(--nominal-500, #3ccb7f);
  }
  .dot.fail {
    background: #e5484d;
  }
  .row :global(.mc-icon) {
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
  .acts {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: none;
    opacity: 0;
    transition: opacity var(--dur-fast);
  }
  .row:hover .acts {
    opacity: 1;
  }
  .act {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--fg-2);
    cursor: pointer;
  }
  .act:hover {
    background: var(--space-800);
    color: var(--fg-1);
  }
</style>
