<script lang="ts">
  // The right-docked Terminals panel (terminals-panel + project-terminals specs).
  // Shows the terminal collection of the FOCUSED agent's project as a vertical,
  // resizable stack. Every project's stack stays MOUNTED (inactive ones hidden via
  // CSS) so running processes survive a project switch; the parent hides the whole
  // panel via CSS when toggled off, so they survive a hide too. Each running
  // terminal renders a real `TerminalPane` (its own PTY); stopping unmounts it
  // (TerminalPane.onDestroy kills+reaps), restarting remounts with a fresh paneId.
  import TerminalPane from '../TerminalPane.svelte';
  import Icon from '../icons/Icon.svelte';
  import { workspace } from '../layout/workspace.svelte';
  import { projects } from '../projects/projects.svelte';
  import { projectForId, projectLabel } from '../projects/projects';
  import { projectTerminals } from './projectTerminals.svelte';
  import { activeProjectId } from './activeProject';
  import { terminalSpawnSpec } from './projectTerminals';
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
  const activeTerminals = $derived(projectTerminals.forProject(activeId));

  // Per-terminal flex weights for the resizable stack (id -> weight, default 1).
  let weights = $state<Record<string, number>>({});
  function weightOf(id: string): number {
    return weights[id] ?? 1;
  }

  // --- New terminal: opens an empty shell immediately (no command prompt) ----
  function addTerminal() {
    if (!activeId) return;
    void projectTerminals.create(activeId);
  }

  // --- Rename inline edit ----------------------------------------------------
  let editingId = $state<string | null>(null);
  let draftName = $state('');
  function beginRename(id: string, current: string) {
    editingId = id;
    draftName = current;
  }
  async function commitRename() {
    if (editingId) await projectTerminals.rename(editingId, draftName);
    editingId = null;
  }

  // --- Vertical resize (drag a gutter to reapportion neighbors) --------------
  function startResize(e: PointerEvent, aboveId: string, belowId: string) {
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    const startY = e.clientY;
    const wAbove = weightOf(aboveId);
    const wBelow = weightOf(belowId);
    const total = wAbove + wBelow;
    // The gutter's parent is the `.tp-stack`; size pixels-per-weight off its height
    // and the sum of all current weights in the visible stack.
    const stack = target.parentElement;
    const px = stack?.getBoundingClientRect().height ?? 1;
    const sumWeights = activeTerminals.reduce((a, t) => a + weightOf(t.id), 0) || 1;
    const perWeight = px / sumWeights;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dW = (ev.clientY - startY) / Math.max(1, perWeight);
      const nextAbove = Math.max(0.15, wAbove + dW);
      const nextBelow = Math.max(0.15, total - nextAbove);
      weights = { ...weights, [aboveId]: nextAbove, [belowId]: nextBelow };
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
      class="tp-add"
      title="New terminal (⌘T)"
      aria-label="New terminal"
      disabled={!activeId}
      onclick={addTerminal}
    >＋</button>
  </header>

  <!-- Body: one stack per project (inactive ones hidden but mounted so their
       running PTYs survive a project switch). -->
  <div class="tp-body">
    {#each projectTerminals.projectIds as pid (pid)}
      {@const terminals = projectTerminals.forProject(pid)}
      {@const path = projectForId(projects.list, pid)?.path ?? null}
      <div class="tp-stack" class:hidden={pid !== activeId}>
        {#each terminals as term, i (term.id)}
          {@const rt = projectTerminals.runtime[term.id]}
          {@const running = rt?.running === true}
          {@const spec = terminalSpawnSpec(term, path, projectTerminals.shell)}
          <div class="tp-term" style="flex: {weightOf(term.id)} 1 0">
            <div class="tp-term-head">
              <span
                class="tp-dot"
                class:on={running}
                title={running ? 'running' : 'stopped'}
              ></span>
              {#if editingId === term.id}
                <!-- svelte-ignore a11y_autofocus -->
                <input
                  class="tp-name-edit"
                  bind:value={draftName}
                  autofocus
                  onblur={() => void commitRename()}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') void commitRename();
                    else if (e.key === 'Escape') editingId = null;
                  }}
                />
              {:else}
                <button
                  class="tp-name"
                  title="Double-click to rename"
                  ondblclick={() => beginRename(term.id, projectTerminals.displayName(term))}
                >
                  {projectTerminals.displayName(term)}
                </button>
              {/if}
              <div class="tp-actions">
                {#if !running}
                  <button class="tp-act" title="Start" aria-label="Start" onclick={() => projectTerminals.start(term.id)}>
                    <Icon name="play" size={12} />
                  </button>
                {/if}
                <button class="tp-act" title="Remove" aria-label="Remove" onclick={() => void projectTerminals.remove(term.id)}>
                  <Icon name="trash-2" size={12} />
                </button>
              </div>
            </div>
            <div class="tp-term-body">
              {#if running && rt}
                {#key rt.paneId}
                  <TerminalPane
                    paneId={rt.paneId}
                    program={spec.program}
                    args={spec.args}
                    cwd={spec.cwd}
                    active={false}
                    visible={pid === activeId}
                    initialInput={rt.initialInput}
                    onExit={(code) => projectTerminals.noteExit(term.id, code)}
                    onTitle={(t) => projectTerminals.noteTitle(term.id, t)}
                  />
                {/key}
              {:else}
                <div class="tp-stopped">
                  <span
                    >stopped{rt && rt.exitCode != null && rt.exitCode !== 0
                      ? ` (exit ${rt.exitCode})`
                      : ''}</span
                  >
                </div>
              {/if}
            </div>
          </div>
          {#if i < terminals.length - 1}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="tp-gutter"
              onpointerdown={(e) => startResize(e, term.id, terminals[i + 1].id)}
            ></div>
          {/if}
        {/each}
      </div>
    {/each}

    {#if !activeId}
      <div class="tp-empty">
        <p>No project selected.</p>
        <p class="tp-empty-sub">Pick a project or focus an agent to see its terminals.</p>
      </div>
    {:else if activeTerminals.length === 0}
      <div class="tp-empty">
        <p>No terminals yet.</p>
        <p class="tp-empty-sub">Add one to run a dev server, watcher, or shell.</p>
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
  /* Matches the agents "＋" launch button (Inbox `.lh .launch`): blue square, white
     glyph, bold — so the two "new" affordances read as the same control. */
  .tp-add {
    margin-left: auto;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    padding: 0;
    font-family: var(--font-sans);
    font-weight: 700;
    font-size: 15px;
    line-height: 1;
    color: #fff;
    background: var(--blue-500);
    border: none;
    border-radius: var(--r-md);
    cursor: pointer;
  }
  .tp-add:disabled {
    opacity: 0.4;
    cursor: default;
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
  .tp-name {
    flex: 1 1 auto;
    min-width: 0;
    text-align: left;
    font-size: 12px;
    color: var(--fg-1);
    background: transparent;
    border: none;
    cursor: text;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tp-name-edit {
    flex: 1 1 auto;
    min-width: 0;
    height: 20px;
    font-size: 12px;
    color: var(--fg-1);
    background: var(--space-800);
    border: 1px solid var(--line-subtle);
    border-radius: 4px;
    padding: 0 5px;
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
