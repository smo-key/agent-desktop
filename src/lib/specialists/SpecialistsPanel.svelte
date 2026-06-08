<script lang="ts">
  // The SPECIALISTS panel (add-agent-specialists, tasks 5.1–5.3) — a sibling
  // surface to the Tasks launcher. It lists the ACTIVE PROJECT's specialists
  // (native Claude Code subagents stored under `.claude/agents/`): one row per
  // parsed specialist (name + description), plus any BROKEN file as a clearly
  // marked error entry (the store separates these so a malformed file never
  // crashes the list). An empty project shows an inviting empty state. The header
  // `＋` creates; RIGHT-CLICK (or the per-row actions) edit / delete a specialist,
  // delete asking for confirmation. Create/edit/delete all refresh the list via
  // the store.
  //
  // Self-contained (no props): it derives its own active project exactly like the
  // Tasks launcher — the selected project filter wins, else the focused agent's
  // project — and (re)loads the specialists store whenever that project changes.
  import Icon from '../icons/Icon.svelte';
  import { tooltip } from '../ui/tooltip';
  import ContextMenu, { type MenuItem } from '../ui/ContextMenu.svelte';
  import { workspace } from '../layout/workspace.svelte';
  import { projects } from '../projects/projects.svelte';
  import { projectForId } from '../projects/projects';
  import { projectFilter } from '../projects/projectFilter.svelte';
  import { ALL, UNASSIGNED } from '../projects/projectRollup';
  import { activeProjectId } from '../tasks/activeProject';
  import { specialists, isSpecialistError, type SpecialistEntry } from './specialists.svelte';
  import type { Specialist } from './specialists';
  import { specialistDialog } from './specialistDialogStore.svelte';
  import SpecialistDialog from './SpecialistDialog.svelte';

  // A concrete project chosen in the overview's project filter (null on All /
  // Unassigned) pins the panel; otherwise it follows the focused agent's project.
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
  const projectPath = $derived(activeProject?.path ?? null);

  // (Re)load the specialists for the active project whenever its path changes.
  $effect(() => {
    if (projectPath) void specialists.load(projectPath);
  });

  // The entries to render — only meaningful once loaded for THIS project.
  const entries = $derived<SpecialistEntry[]>(
    projectPath && specialists.projectPath === projectPath ? specialists.entries : []
  );

  // The specialist being edited (resolved from the dialog store's name), or null.
  const editSpecialist = $derived<Specialist | null>(
    specialistDialog.editName
      ? specialists.specialists.find((s) => s.name === specialistDialog.editName) ?? null
      : null
  );

  // --- Create / edit / delete wiring (delegates to the store with the path) ----
  async function saveCreate(specialist: Specialist) {
    if (!projectPath) return;
    try {
      await specialists.create(projectPath, specialist);
      specialistDialog.close();
    } catch (err) {
      // The store throws with the validation reason; the form already blocks an
      // invalid name, so this is a defensive last resort.
      console.error('create specialist failed', err);
    }
  }

  async function saveEdit(specialist: Specialist) {
    if (!projectPath) return;
    try {
      await specialists.save(projectPath, specialist);
      specialistDialog.close();
    } catch (err) {
      console.error('save specialist failed', err);
    }
  }

  function confirmDelete(name: string) {
    if (!projectPath) return;
    const ok =
      typeof confirm === 'function' ? confirm(`Delete specialist "${name}"?`) : true;
    if (!ok) return;
    void specialists.remove(projectPath, name);
  }

  // --- Right-click context menu (edit / delete) -------------------------------
  let menu = $state<{ open: boolean; x: number; y: number; items: MenuItem[] }>({
    open: false,
    x: 0,
    y: 0,
    items: []
  });

  function openMenu(e: MouseEvent, entry: SpecialistEntry) {
    e.preventDefault();
    const items: MenuItem[] = [];
    if (!isSpecialistError(entry)) {
      items.push({
        label: 'Edit…',
        icon: 'pencil',
        onClick: () => specialistDialog.showEdit(entry.name)
      });
    }
    items.push({
      label: 'Delete',
      icon: 'trash-2',
      danger: true,
      onClick: () => confirmDelete(entry.name)
    });
    menu = { open: true, x: e.clientX, y: e.clientY, items };
  }
</script>

<section class="specialists" aria-label="Agents">
  <header class="sh">
    <h1>Agents <span class="count">{entries.length}</span></h1>
    <button
      type="button"
      class="launch"
      onclick={() => specialistDialog.showCreate()}
      disabled={!projectPath}
      aria-label="New specialist"
      use:tooltip={'New specialist'}
    >＋</button>
  </header>

  <div class="body">
    {#if !projectPath}
      <div class="hint">
        <p>No project.</p>
        <p class="sub">Pick a project or focus an agent to manage its specialists.</p>
      </div>
    {:else if entries.length === 0}
      <div class="hint">
        <p>No specialists yet.</p>
        <p class="sub">Create one to define a reusable subagent persona.</p>
      </div>
    {:else}
      <ul class="rows">
        {#each entries as entry (entry.name)}
          {#if isSpecialistError(entry)}
            <!-- A broken `.claude/agents/*.md` file — surfaced (not hidden) so it
                 can be fixed or deleted. -->
            <li class="row">
              <button
                type="button"
                class="rowbtn broken"
                oncontextmenu={(e) => openMenu(e, entry)}
                onclick={(e) => openMenu(e, entry)}
                use:tooltip={entry.error}
              >
                <Icon name="x" size={13} />
                <span class="nm">
                  <span class="t">{entry.name}</span>
                  <span class="s err">Failed to parse — {entry.error}</span>
                </span>
              </button>
            </li>
          {:else}
            <li class="row">
              <button
                type="button"
                class="rowbtn"
                onclick={() => specialistDialog.showEdit(entry.name)}
                oncontextmenu={(e) => openMenu(e, entry)}
                use:tooltip={'Click to edit'}
              >
                <Icon name="bot" size={13} />
                <span class="nm">
                  <span class="t">{entry.name}</span>
                  <span class="s">{entry.description || 'no description'}</span>
                </span>
              </button>
            </li>
          {/if}
        {/each}
      </ul>
    {/if}
  </div>
</section>

<!-- Create / edit happens in a modal dialog (shared SpecialistForm body),
     rendered once and driven by the dialog store. Create takes precedence when an
     edit target can't be resolved (e.g. it was just deleted). -->
{#if specialistDialog.open}
  {#if specialistDialog.editName && editSpecialist}
    <SpecialistDialog
      mode="edit"
      initial={editSpecialist}
      onSave={saveEdit}
      onCancel={() => specialistDialog.close()}
    />
  {:else if !specialistDialog.editName}
    <SpecialistDialog
      mode="create"
      onSave={saveCreate}
      onCancel={() => specialistDialog.close()}
    />
  {/if}
{/if}

<ContextMenu
  open={menu.open}
  x={menu.x}
  y={menu.y}
  items={menu.items}
  onClose={() => (menu = { ...menu, open: false })}
/>

<style>
  .specialists {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--space-900);
    overflow: hidden;
  }

  /* Agents-bar-style header (mirrors TasksLauncher's `.lh`). */
  .sh {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 15px 16px 11px;
    flex: none;
  }
  .sh h1 {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 17px;
    margin: 0;
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .sh .count {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-3);
    background: var(--space-750);
    border: 1px solid var(--line-subtle);
    border-radius: var(--r-full);
    padding: 2px 8px;
  }
  .sh .launch {
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
  .sh .launch:disabled {
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
    background: rgba(255, 255, 255, 0.025);
  }
  .rowbtn :global(.mc-icon) {
    color: var(--fg-3);
  }
  /* A broken entry reads in the abort/red accent. */
  .rowbtn.broken {
    border-left-color: rgba(242, 86, 75, 0.4);
  }
  .rowbtn.broken :global(.mc-icon) {
    color: #ff8077;
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
  .nm .s.err {
    color: #ff8077;
  }
</style>
