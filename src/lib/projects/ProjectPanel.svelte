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
  import { projects } from './projects.svelte';
  import { projectFilter } from './projectFilter.svelte';
  import {
    projectCounts,
    unassignedCount,
    ALL,
    UNASSIGNED
  } from './projectRollup';
  import { PROJECT_ICON_CHOICES, hexA } from './projects';
  import { pickFolder } from '../launcher/pick';
  import Icon from '../icons/Icon.svelte';
  import ProjectIcon from '../icons/ProjectIcon.svelte';
  import ContextMenu, { type MenuItem } from '../ui/ContextMenu.svelte';

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
          label: 'Delete project',
          danger: true,
          onClick: () => {
            const ok =
              typeof confirm === 'function'
                ? confirm(`Delete project "${name}"? Its agents keep running but lose this label.`)
                : true;
            if (!ok) return;
            void projects.remove(projectId);
            if (projectFilter.selected === projectId) projectFilter.select(ALL);
          }
        }
      ]
    };
  }

  // Per-project counts + attention flags, and the unassigned bucket size.
  const counts = $derived(projectCounts(rows, projects.list));
  const unassigned = $derived(unassignedCount(rows));

  // --- Create-project form state -------------------------------------------
  let creating = $state(false);
  let name = $state('');
  let folder = $state('');
  let pick = $state(PROJECT_ICON_CHOICES[0]);
  let browsing = $state(false);

  const canCreate = $derived(name.trim() !== '' && folder.trim() !== '');

  async function browse() {
    if (browsing) return;
    browsing = true;
    try {
      const picked = await pickFolder(folder.trim() || undefined);
      if (picked) folder = picked;
    } finally {
      browsing = false;
    }
  }

  function resetCreate() {
    creating = false;
    name = '';
    folder = '';
    pick = PROJECT_ICON_CHOICES[0];
  }

  async function create() {
    if (!canCreate) return;
    const stored = await projects.add({
      id: crypto.randomUUID(),
      name: name.trim(),
      path: folder.trim(),
      icon: pick.icon,
      color: pick.color
    });
    projectFilter.select(stored.id);
    resetCreate();
  }

  function onCreateKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void create();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      resetCreate();
    }
  }
</script>

{#if collapsed}
  <!-- Collapsed: a thin icon rail. Expand button + a clickable icon per filter. -->
  <aside class="ppanel rail" aria-label="Projects">
    <button class="pp-rail-btn" onclick={() => onToggle?.()} title="Expand projects" aria-label="Expand projects">»</button>
    <button
      type="button"
      class="pp-rail-ic"
      class:active={projectFilter.selected === ALL}
      onclick={() => projectFilter.select(ALL)}
      title="All agents"
    >
      <Icon name="layers" size={16} color="var(--fg-4)" />
    </button>
    {#each counts as c (c.project.id)}
      <button
        type="button"
        class="pp-rail-ic"
        class:active={projectFilter.selected === c.project.id}
        onclick={() => projectFilter.select(c.project.id)}
        title={c.project.name}
      >
        <ProjectIcon icon={c.project.icon} color={c.project.color} size={18} />
        {#if c.attn}<span class="pp-rail-attn" aria-hidden="true"></span>{/if}
      </button>
    {/each}
    {#if unassigned > 0}
      <button
        type="button"
        class="pp-rail-ic"
        class:active={projectFilter.selected === UNASSIGNED}
        onclick={() => projectFilter.select(UNASSIGNED)}
        title="No project"
      >
        <Icon name="folder" size={16} color="var(--fg-4)" />
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
      class="pp-item"
      class:active={projectFilter.selected === c.project.id}
      onclick={() => projectFilter.select(c.project.id)}
      oncontextmenu={(e) => openMenu(e, c.project.id, c.project.name)}
      title={c.project.path}
    >
      <Icon name={c.project.icon} size={16} color={c.project.color} />
      <span class="pp-name">{c.project.name}</span>
      {#if c.attn}<span class="pp-attn" title="Needs attention"></span>{/if}
      <span class="pp-ct">{c.count}</span>
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

  {#if creating}
    <div class="pp-createbox">
      <div class="icon-picker">
        {#each PROJECT_ICON_CHOICES as choice (choice.icon)}
          <button
            type="button"
            class="ipick"
            class:on={pick.icon === choice.icon}
            style:border-color={pick.icon === choice.icon ? hexA(choice.color, 0.55) : undefined}
            style:background={pick.icon === choice.icon ? hexA(choice.color, 0.16) : undefined}
            aria-label={choice.icon}
            onclick={() => (pick = choice)}
          >
            <Icon name={choice.icon} size={16} color={choice.color} />
          </button>
        {/each}
      </div>

      <button class="pp-browse" onclick={browse} disabled={browsing}>
        <Icon name="folder" size={14} color="var(--fg-3)" />
        <span class="pp-folder" class:empty={!folder.trim()} title={folder}>
          {folder.trim() || (browsing ? 'Opening…' : 'Choose folder…')}
        </span>
      </button>

      <div class="pp-create">
        <Icon name={pick.icon} size={16} color={pick.color} />
        <!-- svelte-ignore a11y_autofocus -->
        <input
          autofocus
          bind:value={name}
          placeholder="Project name…"
          onkeydown={onCreateKey}
        />
        <button class="icon-send" disabled={!canCreate} onclick={create} aria-label="Create project">
          <Icon name="check" size={15} color="#fff" />
        </button>
      </div>
    </div>
  {:else}
    <button type="button" class="pp-item pp-new" onclick={() => (creating = true)}>
      <Icon name="plus" size={16} color="var(--fg-4)" />
      <span class="pp-name">New project</span>
    </button>
  {/if}
</aside>
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
    width: 22px;
    height: 22px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--r-sm);
    background: transparent;
    border: none;
    color: var(--fg-4);
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
  }
  .pp-collapse:hover {
    background: rgba(255, 255, 255, 0.05);
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

  /* ---- create-project box ---- */
  .pp-createbox {
    padding: 4px 6px 6px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .icon-picker {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .ipick {
    width: 30px;
    height: 30px;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--space-800);
    border: 1px solid var(--line-default);
    border-radius: var(--r-sm);
    cursor: pointer;
    transition:
      border-color var(--dur-fast),
      background var(--dur-fast);
  }
  .ipick:hover {
    border-color: var(--line-strong);
  }
  .pp-browse {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    text-align: left;
    background: var(--space-800);
    border: 1px solid var(--line-default);
    border-radius: var(--r-sm);
    padding: 7px 9px;
    cursor: pointer;
    color: var(--fg-2);
  }
  .pp-browse:hover {
    border-color: var(--line-strong);
  }
  .pp-folder {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-2);
  }
  .pp-folder.empty {
    color: var(--fg-4);
    font-style: italic;
  }
  .pp-create {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 0 2px;
  }
  .pp-create input {
    flex: 1;
    min-width: 0;
    background: var(--space-800);
    border: 1px solid var(--blue-500);
    box-shadow: var(--focus-ring);
    border-radius: var(--r-sm);
    padding: 6px 9px;
    color: var(--fg-1);
    font-family: var(--font-sans);
    font-size: 12.5px;
    outline: none;
  }
  .icon-send {
    width: 30px;
    height: 30px;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--r-sm);
    background: var(--blue-500);
    border: none;
    cursor: pointer;
  }
  .icon-send:hover:not(:disabled) {
    background: var(--blue-600);
  }
  .icon-send:disabled {
    background: var(--space-600);
    cursor: not-allowed;
  }
</style>
