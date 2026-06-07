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
  import { projects } from '../projects/projects.svelte';
  import { projectForId, projectLabel } from '../projects/projects';
  import { projectFilter } from '../projects/projectFilter.svelte';
  import { ALL, UNASSIGNED } from '../projects/projectRollup';
  import { activeProjectId } from './activeProject';
  import { projectTasks } from './projectTasks.svelte';
  import { tasksPanel } from './panel.svelte';
  import type { TaskDef, TaskKind } from './projectTasks';

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
  const activeProject = $derived(projectForId(projects.list, activeId));
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

  // --- Inline rename ----------------------------------------------------------
  let renamingId = $state<string | null>(null);
  let renameText = $state('');
  function beginRename(def: TaskDef) {
    renamingId = def.id;
    renameText = def.name;
  }
  async function commitRename() {
    const id = renamingId;
    if (id) await projectTasks.rename(id, renameText);
    renamingId = null;
  }

  // --- Row actions ------------------------------------------------------------
  function start(id: string) {
    projectTasks.startTask(id);
    tasksPanel.open = true;
  }

  // --- Inline create form -----------------------------------------------------
  let creating = $state(false);
  let newKind = $state<TaskKind>('terminal');
  let newName = $state('');
  let newCommand = $state('');
  let newPrompt = $state('');

  function resetForm() {
    creating = false;
    newKind = 'terminal';
    newName = '';
    newCommand = '';
    newPrompt = '';
  }

  async function submitCreate() {
    if (!activeId) return;
    const name = newName.trim();
    if (newKind === 'agent') {
      const prompt = newPrompt.trim();
      if (prompt === '') return;
      await projectTasks.create(activeId, { kind: 'agent', prompt, name });
    } else {
      const command = newCommand.trim();
      if (command === '') return;
      await projectTasks.create(activeId, { kind: 'terminal', command, name });
    }
    resetForm();
  }

  function launchTerminal() {
    if (!activeId) return;
    projectTasks.launchBareTerminal(activeId);
    tasksPanel.open = true;
  }
</script>

<section class="launcher" aria-label="Tasks launcher">
  <header class="lh">
    <span class="title">Tasks</span>
    {#if activeProject}
      <span class="proj" title={projectLabel(activeProject)}>{projectLabel(activeProject)}</span>
    {/if}
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
            <span class="nm">
              {#if renamingId === def.id}
                <!-- svelte-ignore a11y_autofocus -->
                <input
                  class="rename"
                  bind:value={renameText}
                  autofocus
                  onblur={commitRename}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    else if (e.key === 'Escape') (renamingId = null);
                  }}
                />
              {:else}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <span
                  class="t"
                  title="Double-click to rename"
                  ondblclick={() => beginRename(def)}
                >{def.name}</span>
              {/if}
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
              <button class="act" title="Remove" aria-label="Remove task" onclick={() => projectTasks.remove(def.id)}>
                <Icon name="trash-2" size={12} />
              </button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    {#if creating}
      <form
        class="create"
        onsubmit={(e) => {
          e.preventDefault();
          submitCreate();
        }}
      >
        <div class="seg" role="group" aria-label="Task kind">
          <button
            type="button"
            class:active={newKind === 'terminal'}
            onclick={() => (newKind = 'terminal')}
          >Terminal</button>
          <button
            type="button"
            class:active={newKind === 'agent'}
            onclick={() => (newKind = 'agent')}
          >Agent</button>
        </div>
        <input class="fld" placeholder="Name (optional)" bind:value={newName} />
        {#if newKind === 'agent'}
          <textarea class="fld ta" placeholder="Claude prompt…" rows="3" bind:value={newPrompt}></textarea>
        {:else}
          <input class="fld" placeholder="Command (e.g. npm run dev)" bind:value={newCommand} />
        {/if}
        <div class="frow">
          <button type="submit" class="btn primary" disabled={!activeId}>Add</button>
          <button type="button" class="btn" onclick={resetForm}>Cancel</button>
        </div>
      </form>
    {/if}
  </div>

  <footer class="ft">
    <button
      type="button"
      class="ftbtn"
      class:active={creating}
      onclick={() => (creating ? resetForm() : (creating = true))}
      disabled={!activeId}
      title="Add a task"
    >
      <Icon name="plus" size={13} /> Task
    </button>
    <button
      type="button"
      class="ftbtn"
      onclick={launchTerminal}
      disabled={!activeId}
      title="Open a bare terminal"
    >
      <Icon name="terminal" size={13} /> Terminal
    </button>
  </footer>
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

  .lh {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    padding: 8px 16px 6px;
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--fg-3);
  }
  .lh .title {
    font-weight: 600;
  }
  .lh .proj {
    color: var(--fg-4);
    text-transform: none;
    letter-spacing: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
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
  .rename {
    font-size: 13px;
    font-weight: 600;
    color: var(--fg-1);
    background: var(--space-800);
    border: 1px solid var(--blue-500);
    border-radius: var(--r-sm);
    padding: 1px 5px;
    width: 100%;
    outline: none;
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

  .create {
    display: flex;
    flex-direction: column;
    gap: 7px;
    margin: 6px 12px 10px;
    padding: 10px;
    background: var(--space-850);
    border: 1px solid var(--line-subtle);
    border-radius: var(--r-md);
  }
  .seg {
    display: flex;
    gap: 0;
    border: 1px solid var(--line-subtle);
    border-radius: var(--r-sm);
    overflow: hidden;
  }
  .seg button {
    flex: 1;
    padding: 5px 8px;
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 600;
    color: var(--fg-3);
    background: transparent;
    border: none;
    cursor: pointer;
  }
  .seg button.active {
    color: #fff;
    background: var(--blue-500);
  }
  .fld {
    font-family: var(--font-sans);
    font-size: 12px;
    color: var(--fg-1);
    background: var(--space-900);
    border: 1px solid var(--line-subtle);
    border-radius: var(--r-sm);
    padding: 6px 8px;
    outline: none;
  }
  .fld:focus {
    border-color: var(--blue-500);
  }
  .fld.ta {
    resize: vertical;
    min-height: 48px;
    font-family: var(--font-mono);
  }
  .frow {
    display: flex;
    gap: 7px;
  }
  .btn {
    flex: 1;
    padding: 6px 10px;
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 600;
    color: var(--fg-2);
    background: var(--space-750);
    border: 1px solid var(--line-subtle);
    border-radius: var(--r-sm);
    cursor: pointer;
  }
  .btn:hover {
    color: var(--fg-1);
  }
  .btn.primary {
    color: #fff;
    background: var(--blue-500);
    border-color: var(--blue-500);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .ft {
    flex: none;
    display: flex;
    gap: 7px;
    padding: 8px 12px;
    border-top: 1px solid var(--line-subtle);
  }
  .ftbtn {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 7px 10px;
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 600;
    color: var(--fg-2);
    background: var(--space-750);
    border: 1px solid var(--line-subtle);
    border-radius: var(--r-sm);
    cursor: pointer;
  }
  .ftbtn:hover {
    color: var(--fg-1);
    border-color: var(--line-default);
  }
  .ftbtn.active {
    color: #fff;
    background: var(--blue-500);
    border-color: var(--blue-500);
  }
  .ftbtn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
