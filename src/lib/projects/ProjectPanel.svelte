<script lang="ts">
  // The hideable left PROJECT PANEL shared by both overviews (ports ProjectPanel.jsx
  // + LaunchModal's create flow). It filters the fleet by project: "All agents",
  // one row per project (tinted icon, name, an orange dot when any of its agents
  // needs you, a live count), an optional "No project" bucket, and an inline
  // "New project" create (name + Browse folder + icon picker).
  //
  // Selection is the shared `projectFilter` store (so switching Overview<->Windows
  // keeps the filter); the project list is the persisted `projects` store. Counts
  // come from the PURE `projectCounts`/`unassignedCount` over the roster rows the
  // parent passes in. Creating a project persists it and selects it.

  import type { AgentRow } from '../overview/roster';
  import type { Project } from './projects';
  import { projects } from './projects.svelte';
  import { projectFilter } from './projectFilter.svelte';
  import {
    projectCounts,
    unassignedCount,
    ALL,
    UNASSIGNED
  } from './projectRollup';
  import Icon from '../icons/Icon.svelte';
  import ProjectIcon from '../icons/ProjectIcon.svelte';
  import ProjectDialog from './ProjectDialog.svelte';
  import ContextMenu, { type MenuItem } from '../ui/ContextMenu.svelte';
  import GitInfo from '../usage/GitInfo.svelte';
  import { projectGit } from './projectGit.svelte';

  let {
    rows,
    collapsed = false,
    onToggle
  }: { rows: AgentRow[]; collapsed?: boolean; onToggle?: () => void } = $props();

  // Right-click context menu for a project row (delete).
  let menu = $state<{ open: boolean; x: number; y: number; items: MenuItem[] }>({
    open: false,
    x: 0,
    y: 0,
    items: []
  });

  function openMenu(e: MouseEvent, projectId: string, name: string) {
    e.preventDefault();
    menu = {
      open: true,
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: 'Edit project…',
          icon: 'pencil',
          onClick: () => {
            creating = false;
            editingId = projectId;
          }
        },
        {
          label: 'Delete project',
          icon: 'trash-2',
          danger: true,
          onClick: () => {
            const ok =
              typeof confirm === 'function'
                ? confirm(`Delete project "${name}"? Its agents keep running but lose this label.`)
                : true;
            if (!ok) return;
            void projects.remove(projectId);
            if (editingId === projectId) editingId = null;
            if (projectFilter.selected === projectId) projectFilter.select(ALL);
          }
        }
      ]
    };
  }

  // Per-project counts + attention flags, and the unassigned bucket size.
  const counts = $derived(projectCounts(rows, projects.list));
  const unassigned = $derived(unassignedCount(rows));

  // --- Create / edit dialog state (the shared ProjectForm drives both) ------
  let creating = $state(false);
  /** The id of the project being edited, or null. Mutually exclusive with `creating`. */
  let editingId = $state<string | null>(null);
  /** The resolved project being edited (or null) — feeds the edit dialog. */
  const editProject = $derived(
    editingId ? (projects.list.find((p) => p.id === editingId) ?? null) : null
  );

  async function saveCreate(draft: Omit<Project, 'id'>) {
    const stored = await projects.add({ id: crypto.randomUUID(), ...draft });
    projectFilter.select(stored.id);
    creating = false;
  }

  async function saveEdit(id: string, draft: Omit<Project, 'id'>) {
    await projects.update(id, draft);
    editingId = null;
  }
</script>

{#if collapsed}
  <!-- Collapsed: a thin icon rail. Expand button + a clickable icon per filter.
       Each filter icon carries an instant, styled flyout tooltip (.pp-tip) with
       its name — no native `title` (those are slow + unstyled). -->
  <aside class="ppanel rail" aria-label="Projects">
    <button class="pp-rail-btn" onclick={() => onToggle?.()} aria-label="Expand projects">
      »<span class="pp-tip">Expand projects</span>
    </button>
    <button
      type="button"
      class="pp-rail-ic"
      class:active={projectFilter.selected === ALL}
      onclick={() => projectFilter.select(ALL)}
      aria-label="All agents"
    >
      <Icon name="layers" size={16} color="var(--fg-4)" />
      <span class="pp-tip">All agents</span>
    </button>
    {#each counts as c (c.project.id)}
      <button
        type="button"
        class="pp-rail-ic"
        class:active={projectFilter.selected === c.project.id}
        onclick={() => projectFilter.select(c.project.id)}
        aria-label={c.project.name}
      >
        <ProjectIcon icon={c.project.icon} color={c.project.color} logo={c.project.logo} size={18} />
        {#if c.attn}<span class="pp-rail-attn" aria-hidden="true"></span>{/if}
        <span class="pp-tip">{c.project.name}</span>
      </button>
    {/each}
    {#if unassigned > 0}
      <button
        type="button"
        class="pp-rail-ic"
        class:active={projectFilter.selected === UNASSIGNED}
        onclick={() => projectFilter.select(UNASSIGNED)}
        aria-label="No project"
      >
        <Icon name="folder" size={16} color="var(--fg-4)" />
        <span class="pp-tip">No project</span>
      </button>
    {/if}
  </aside>
{:else}
<aside class="ppanel" aria-label="Projects">
  <div class="pp-head">
    <span class="pp-title">Workspace</span>
    <button
      class="pp-collapse"
      onclick={() => onToggle?.()}
      title="Collapse projects"
      aria-label="Collapse projects"
    >«</button>
  </div>

  <button
    type="button"
    class="pp-item"
    class:active={projectFilter.selected === ALL}
    onclick={() => projectFilter.select(ALL)}
  >
    <Icon name="layers" size={16} color="var(--fg-4)" />
    <span class="pp-name">All agents</span>
    <span class="pp-ct">{rows.length}</span>
  </button>

  <div class="pp-label">Projects</div>

  {#each counts as c (c.project.id)}
    <button
      type="button"
      class="pp-item pp-project"
      class:active={projectFilter.selected === c.project.id}
      onclick={() => projectFilter.select(c.project.id)}
      oncontextmenu={(e) => openMenu(e, c.project.id, c.project.name)}
      title={c.project.path}
    >
      <span class="pp-row-main">
        {#if c.project.logo}
          <img class="pp-logo" src={c.project.logo} alt="" />
        {:else}
          <Icon name={c.project.icon} size={16} color={c.project.color} />
        {/if}
        <span class="pp-name">{c.project.name}</span>
        {#if c.attn}<span class="pp-attn" title="Needs attention"></span>{/if}
        <span class="pp-ct">{c.count}</span>
      </span>
      <span class="pp-git">
        <GitInfo git={projectGit.forPath(c.project.path)} always stack />
      </span>
    </button>
  {/each}

  {#if unassigned > 0}
    <button
      type="button"
      class="pp-item"
      class:active={projectFilter.selected === UNASSIGNED}
      onclick={() => projectFilter.select(UNASSIGNED)}
    >
      <Icon name="folder" size={16} color="var(--fg-4)" />
      <span class="pp-name">No project</span>
      <span class="pp-ct">{unassigned}</span>
    </button>
  {/if}

  <button type="button" class="pp-item pp-new" onclick={() => { editingId = null; creating = true; }}>
    <Icon name="plus" size={16} color="var(--fg-4)" />
    <span class="pp-name">New project</span>
  </button>
</aside>
{/if}

<!-- Create / edit happens in a modal dialog (shared ProjectForm body). Rendered
     once, driven by `creating` / `editingId`; create takes precedence if both. -->
{#if creating}
  <ProjectDialog mode="create" onSave={saveCreate} onCancel={() => (creating = false)} />
{:else if editProject}
  <ProjectDialog
    mode="edit"
    initial={editProject}
    onSave={(draft) => saveEdit(editProject.id, draft)}
    onCancel={() => (editingId = null)}
  />
{/if}

<ContextMenu
  open={menu.open}
  x={menu.x}
  y={menu.y}
  items={menu.items}
  onClose={() => (menu = { ...menu, open: false })}
/>

<style>
  .ppanel {
    width: 100%;
    height: 100%;
    background: var(--space-900);
    border-right: 1px solid var(--line-subtle);
    display: flex;
    flex-direction: column;
    padding: 14px 10px;
    gap: 4px;
    overflow-y: auto;
  }
  .pp-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 8px 8px;
  }
  .pp-title {
    flex: 1;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--fg-4);
  }
  .pp-collapse {
    flex: none;
    width: 26px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--r-sm);
    background: var(--space-750);
    border: 1px solid var(--line-subtle);
    color: var(--fg-3);
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
    transition:
      background var(--dur-fast),
      border-color var(--dur-fast),
      color var(--dur-fast);
  }
  .pp-collapse:hover {
    background: var(--space-700);
    border-color: var(--line-default);
    color: var(--fg-1);
  }

  /* ---- collapsed icon rail ---- */
  .ppanel.rail {
    align-items: center;
    padding: 12px 0;
    gap: 6px;
  }
  .pp-rail-btn {
    width: 30px;
    height: 28px;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--r-md);
    background: var(--space-750);
    border: 1px solid var(--line-subtle);
    color: var(--fg-3);
    cursor: pointer;
    font-size: 14px;
    margin-bottom: 4px;
  }
  .pp-rail-btn:hover {
    color: var(--fg-1);
    border-color: var(--line-default);
  }
  .pp-rail-ic {
    position: relative;
    width: 34px;
    height: 34px;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--r-md);
    background: none;
    border: 1px solid transparent;
    cursor: pointer;
    transition: background var(--dur-fast), border-color var(--dur-fast);
  }
  .pp-rail-ic:hover {
    background: rgba(255, 255, 255, 0.04);
  }
  .pp-rail-ic.active {
    background: var(--blue-tint);
    border-color: rgba(61, 123, 255, 0.35);
  }
  .pp-rail-attn {
    position: absolute;
    top: 3px;
    right: 3px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--orange-500);
    border: 1.5px solid var(--space-900);
  }
  .pp-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: var(--r-md);
    border: none;
    background: none;
    width: 100%;
    text-align: left;
    cursor: pointer;
    color: var(--fg-2);
    font-family: var(--font-sans);
    font-size: 13px;
    font-weight: 500;
    transition:
      background var(--dur-fast),
      color var(--dur-fast);
  }
  .pp-item:hover {
    background: rgba(255, 255, 255, 0.04);
    color: var(--fg-1);
  }
  .pp-item.active {
    background: var(--blue-tint);
    color: var(--blue-200);
  }
  /* A project row stacks its main line (icon · name · count) above a compact git
     status line, so it reads its current branch at a glance. */
  .pp-project {
    flex-direction: column;
    align-items: stretch;
    gap: 5px;
  }
  .pp-row-main {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  /* The git line, indented to sit under the project NAME (icon width + gap). */
  .pp-git {
    padding-left: 26px;
    min-width: 0;
    overflow: hidden;
  }
  .pp-git :global(.git) {
    gap: 4px;
  }
  .pp-git :global(.pill) {
    height: 18px;
    padding: 0 6px;
    font-size: 10px;
  }
  .pp-git :global(.branch) {
    max-width: 150px;
  }
  .pp-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pp-attn {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--orange-500);
    flex: none;
  }
  .pp-ct {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--fg-4);
    flex: none;
  }
  .pp-item.active .pp-ct {
    color: var(--blue-300);
  }
  .pp-label {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--fg-4);
    padding: 12px 10px 6px;
  }
  .pp-new {
    color: var(--fg-3);
  }

  /* A project's logo in an expanded row (replaces the glyph). */
  .pp-logo {
    width: 16px;
    height: 16px;
    flex: none;
    border-radius: 3px;
    object-fit: cover;
  }

  /* ---- instant collapsed-rail tooltip ---- */
  .pp-rail-btn {
    position: relative;
  }
  .pp-tip {
    position: absolute;
    left: calc(100% + 8px);
    top: 50%;
    transform: translateY(-50%);
    z-index: 70;
    padding: 4px 9px;
    white-space: nowrap;
    background: var(--space-700);
    border: 1px solid var(--line-default);
    border-radius: var(--r-sm);
    box-shadow: var(--shadow-pop);
    color: var(--fg-1);
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 500;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--dur-fast);
  }
  .pp-rail-btn:hover .pp-tip,
  .pp-rail-ic:hover .pp-tip,
  .pp-rail-btn:focus-visible .pp-tip,
  .pp-rail-ic:focus-visible .pp-tip {
    opacity: 1;
  }
</style>
