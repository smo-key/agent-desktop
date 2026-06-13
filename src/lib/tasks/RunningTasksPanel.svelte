<script lang="ts">
  // The right-docked Tasks panel (tasks-panel spec — "Right-docked Tasks panel").
  // It is the RUNNING SURFACE for the Tasks feature: it shows only the ACTIVE
  // entries of the focused agent's project — running/failed terminal-task panes and
  // bare interactive shells — NOT the task catalog (idle defs, create/rename/remove
  // live in the separate left Tasks launcher). Every project's stack stays MOUNTED
  // (inactive ones hidden via CSS) so running PTYs survive a project switch; the
  // parent hides the whole panel via CSS when toggled off, so they survive a hide
  // too. Each live entry renders a real `TerminalPane` (its own PTY); stopping
  // unmounts it (TerminalPane.onDestroy kills+reaps), restarting remounts with a
  // fresh paneId (via the `{#key}` wrapper).
  //
  // Two entry kinds are unified into one ordered list per project:
  //   - terminal-task runs: a `terminal` def with a runtime — live while running;
  //     a clean exit auto-deletes the runtime in the store (the pane disappears),
  //     UNLESS the task opted out of "Close automatically when complete" — then it
  //     stays as a stopped (exit 0) slot, like a non-zero exit but not flagged
  //     failed; a non-zero exit becomes a "stopped (exit N)" slot with a Dismiss action.
  //   - bare terminals: transient interactive shells (⌘T / launcher) — live while
  //     running; a stopped bare shell (any exit, even 0) stays as a slot with a
  //     close (×) action (a different experience from a task).
  import TerminalPane from '../TerminalPane.svelte';
  import Icon from '../icons/Icon.svelte';
  import { tooltip } from '../ui/tooltip';
  import { workspace } from '../layout/workspace.svelte';
  import { projects } from '../projects/projects.svelte';
  import { projectForId, projectLabel } from '../projects/projects';
  import { projectTasks } from './projectTasks.svelte';
  import { activeProjectId } from './activeProject';
  import { taskSpawnSpec } from './projectTasks';
  import { projectFilter } from '../projects/projectFilter.svelte';
  import { ALL, UNASSIGNED } from '../projects/projectRollup';

  // A concrete project chosen in the overview's project filter (null on All /
  // Unassigned). When set it pins the panel to that project even with no agent
  // focused; otherwise the panel follows the focused agent's project.
  const selectedProjectId = $derived(
    projectFilter.selected === ALL || projectFilter.selected === UNASSIGNED
      ? null
      : projectFilter.selected
  );

  // The active project = the selected project (if any), else the focused agent's
  // project (null ⇒ empty state).
  const activeId = $derived(
    activeProjectId({
      focusedId: workspace.active ? workspace.focusedId : '',
      projectIdOf: (id) => workspace.session(id).projectId,
      selectedProjectId
    })
  );
  const activeProject = $derived(projectForId(projects.list, activeId));

  // --- The unified active-entry model ----------------------------------------
  // One uniform record per live/stopped surface entry, so the template renders
  // terminal-task runs and bare terminals the same way.
  type Entry = {
    key: string;
    kind: 'task' | 'bare';
    paneId: string;
    running: boolean;
    exitCode: number | null;
    title: string;
    name: string;
    program: string;
    args: string[];
    cwd: string | null;
    initialInput?: string;
    onExit: (code: number) => void;
    onTitle: (t: string) => void;
    onDismiss: () => void;
    failed: boolean;
  };

  /** The ACTIVE entries for `pid`: terminal-task runs (running, failed, or a
   *  kept-open clean exit) followed by bare terminals. A clean-exit task is absent
   *  only when it auto-closed (the default); a keep-open task stays as a stopped
   *  (exit 0) slot. A clean-exit bare shell stays as a stopped slot. */
  function entriesFor(pid: string): Entry[] {
    const path = projectForId(projects.list, pid)?.path ?? null;
    const out: Entry[] = [];
    for (const def of projectTasks.forProject(pid)) {
      if (def.kind !== 'terminal') continue;
      const rt = projectTasks.runtime[def.id];
      if (!rt) continue; // idle (or auto-closed) tasks live in the left launcher.
      const spec = taskSpawnSpec(def, path, projectTasks.shell);
      out.push({
        key: `task:${def.id}`,
        kind: 'task',
        paneId: rt.paneId,
        running: rt.running,
        exitCode: rt.exitCode,
        title: rt.title,
        name: projectTasks.displayName(def),
        program: spec.program,
        args: spec.args,
        cwd: spec.cwd,
        initialInput: rt.initialInput,
        onExit: (code) => projectTasks.noteExit(def.id, code),
        onTitle: (t) => projectTasks.noteTitle(def.id, t),
        onDismiss: () => projectTasks.dismiss(def.id),
        failed: projectTasks.isFailed(def.id)
      });
    }
    for (const bare of projectTasks.bareForProject(pid)) {
      out.push({
        key: `bare:${bare.id}`,
        kind: 'bare',
        paneId: bare.paneId,
        running: bare.running,
        exitCode: bare.exitCode,
        title: bare.title,
        name: bare.title || 'shell',
        program: projectTasks.shell,
        args: [],
        cwd: path,
        initialInput: bare.initialInput,
        onExit: (code) => projectTasks.noteBareExit(bare.id, code),
        onTitle: (t) => projectTasks.noteBareTitle(bare.id, t),
        onDismiss: () => projectTasks.removeBareTerminal(bare.id),
        failed: false
      });
    }
    return out;
  }

  // The set of projects with ANY active entry (a running/failed task runtime or a
  // bare terminal) — `projectTasks.projectIds` covers only defs, so union in the
  // projects that own bare shells too.
  const activeProjectIds = $derived.by(() => {
    const ids = new Set<string>();
    for (const pid of projectTasks.projectIds) {
      if (entriesFor(pid).length > 0) ids.add(pid);
    }
    for (const pid of Object.keys(projectTasks.bareByProject)) {
      if (projectTasks.bareForProject(pid).length > 0) ids.add(pid);
    }
    return [...ids];
  });

  const activeEntries = $derived(activeId ? entriesFor(activeId) : []);

  // Per-entry flex weights for the resizable stack (key -> weight, default 1).
  let weights = $state<Record<string, number>>({});
  function weightOf(key: string): number {
    return weights[key] ?? 1;
  }

  // --- Vertical resize (drag a gutter to reapportion neighbors) --------------
  function startResize(e: PointerEvent, aboveKey: string, belowKey: string) {
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    const startY = e.clientY;
    const wAbove = weightOf(aboveKey);
    const wBelow = weightOf(belowKey);
    const total = wAbove + wBelow;
    // The gutter's parent is the `.tp-stack`; size pixels-per-weight off its height
    // and the sum of all current weights in the visible stack.
    const stack = target.parentElement;
    const px = stack?.getBoundingClientRect().height ?? 1;
    const sumWeights = activeEntries.reduce((a, en) => a + weightOf(en.key), 0) || 1;
    const perWeight = px / sumWeights;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dW = (ev.clientY - startY) / Math.max(1, perWeight);
      const nextAbove = Math.max(0.15, wAbove + dW);
      const nextBelow = Math.max(0.15, total - nextAbove);
      weights = { ...weights, [aboveKey]: nextAbove, [belowKey]: nextBelow };
    };
    const up = (ev: PointerEvent) => {
      target.releasePointerCapture(ev.pointerId);
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  }
</script>

<section class="terminals-panel" aria-label="Terminals">
  <header class="tp-head">
    <Icon name="terminal" size={14} />
    <span class="tp-title">Terminals</span>
    {#if activeProject}
      <span class="tp-project">{projectLabel(activeProject)}</span>
    {/if}
    <button
      type="button"
      class="tp-add"
      onclick={() => {
        if (activeId) projectTasks.launchBareTerminal(activeId);
      }}
      disabled={!activeId}
      use:tooltip={'New terminal (⌘Y)'}
      aria-label="New terminal"
    >＋</button>
  </header>

  <!-- Body: one stack per project with active entries (inactive ones hidden but
       mounted so their running PTYs survive a project switch). -->
  <div class="tp-body">
    {#each activeProjectIds as pid (pid)}
      {@const entries = entriesFor(pid)}
      <div class="tp-stack" class:hidden={pid !== activeId}>
        {#each entries as entry, i (entry.key)}
          <div class="tp-term" style="flex: {weightOf(entry.key)} 1 0">
            <div class="tp-term-head">
              <span
                class="tp-dot"
                class:on={entry.running}
                class:fail={entry.failed}
                use:tooltip={entry.running ? 'Terminal running' : 'Terminal stopped'}
              ></span>
              <span class="tp-name" use:tooltip={entry.name}>{entry.name}</span>
              <div class="tp-actions">
                <!-- Trash is ALWAYS shown (both kinds, running or stopped). Clicking
                     it kills the terminal AND closes its slot: onDismiss drops the
                     entry from the store, which unmounts the live `TerminalPane`,
                     whose onDestroy kills + reaps any still-running PTY. A stopped
                     slot has no live process, so it just closes. The verb tracks
                     state — "Kill" while running, "Close" once stopped. -->
                <button
                  class="tp-act"
                  use:tooltip={entry.running ? 'Kill terminal' : 'Close terminal'}
                  aria-label={entry.running ? 'Kill terminal' : 'Close terminal'}
                  onclick={entry.onDismiss}
                >
                  <Icon name="trash-2" size={12} />
                </button>
              </div>
            </div>
            <div class="tp-term-body">
              <!-- Keep the pane MOUNTED while running OR after the process exited on
                   its own (`exitCode != null`) — a self-exit leaves no live process to
                   kill, so we keep the dead pane's scrollback visible (the user must be
                   able to read a FAILED task's error output, design D4). Only a
                   user-initiated stop (running false, exitCode still null) unmounts the
                   pane, whose onDestroy kills+reaps the still-live process. -->
              {#if entry.running || entry.exitCode != null}
                {#key entry.paneId}
                  <TerminalPane
                    paneId={entry.paneId}
                    program={entry.program}
                    args={entry.args}
                    cwd={entry.cwd}
                    active={false}
                    visible={pid === activeId}
                    initialInput={entry.initialInput}
                    onExit={entry.onExit}
                    onTitle={entry.onTitle}
                  />
                {/key}
              {:else}
                <div class="tp-stopped">
                  <span>stopped</span>
                </div>
              {/if}
            </div>
          </div>
          {#if i < entries.length - 1}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="tp-gutter"
              onpointerdown={(e) => startResize(e, entry.key, entries[i + 1].key)}
            ></div>
          {/if}
        {/each}
      </div>
    {/each}

    {#if !activeId}
      <div class="tp-empty">
        <p>No project selected.</p>
        <p class="tp-empty-sub">Pick a project or focus an agent to see its running tasks.</p>
      </div>
    {:else if activeEntries.length === 0}
      <div class="tp-empty">
        <p>No running tasks.</p>
        <p class="tp-empty-sub">Start a task or open a terminal from the Tasks launcher.</p>
      </div>
    {/if}
  </div>
</section>

<style>
  .terminals-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    background: var(--space-900);
    border-left: 1px solid var(--line-subtle);
    overflow: hidden;
  }

  .tp-head {
    display: flex;
    align-items: center;
    gap: 7px;
    height: 34px;
    flex: 0 0 34px;
    padding: 0 8px 0 11px;
    border-bottom: 1px solid var(--line-subtle);
    color: var(--fg-2);
  }
  .tp-title {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .tp-project {
    font-size: 11px;
    color: var(--fg-3);
    margin-left: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Blue `＋` (Agents-bar style) — launches a bare interactive terminal. */
  .tp-add {
    margin-left: auto;
    flex: none;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    font-family: var(--font-sans);
    font-weight: 700;
    font-size: 14px;
    color: #fff;
    background: var(--blue-500);
    border: none;
    border-radius: var(--r-md);
    cursor: pointer;
  }
  .tp-add:hover:not(:disabled) {
    background: var(--blue-600);
  }
  .tp-add:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .tp-body {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .tp-stack {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
  }
  .tp-stack.hidden {
    display: none;
  }

  .tp-term {
    display: flex;
    flex-direction: column;
    min-height: 60px;
    overflow: hidden;
  }
  .tp-term-head {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    flex: 0 0 26px;
    padding: 0 6px 0 9px;
    background: var(--space-850);
    border-bottom: 1px solid var(--line-subtle);
  }
  .tp-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--fg-3);
    flex: none;
  }
  .tp-dot.on {
    background: #3ccb7f;
  }
  .tp-dot.fail {
    background: #e5484d;
  }
  .tp-name {
    flex: 1 1 auto;
    min-width: 0;
    text-align: left;
    font-size: 12px;
    color: var(--fg-1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tp-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: none;
  }
  .tp-act {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--fg-2);
    cursor: pointer;
  }
  .tp-act:hover {
    background: var(--space-800);
    color: var(--fg-1);
  }
  .tp-term-body {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    background: var(--space-850);
  }
  .tp-stopped {
    display: grid;
    place-items: center;
    height: 100%;
    color: var(--fg-3);
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .tp-gutter {
    flex: 0 0 5px;
    cursor: row-resize;
    background: var(--space-900);
  }
  .tp-gutter:hover {
    background: var(--accent, #4c8dff);
  }

  .tp-empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    text-align: center;
    padding: 16px;
    color: var(--fg-2);
    font-size: 13px;
  }
  .tp-empty-sub {
    color: var(--fg-3);
    font-size: 12px;
  }
</style>
