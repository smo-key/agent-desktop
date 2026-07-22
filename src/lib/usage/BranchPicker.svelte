<script lang="ts">
  // A dropdown menu for switching/creating git branches. Opens UPWARD (the
  // trigger lives in the footer at the bottom of the window). Modelled on
  // ProjectSelect.svelte's combobox pattern: a filter input at the top, then a
  // Local section, an optional Remotes section, and an inline "Create branch"
  // row when the query doesn't match an existing local branch. Keyboard nav
  // follows a roving highlight over the flattened list of actionable rows.

  import Icon from '$lib/icons/Icon.svelte';
  import {
    listBranches,
    switchBranch,
    createBranch,
    remoteShortName,
    filterBranches
  } from '$lib/projects/branchActions';
  import { gitBusy } from '$lib/projects/projectGitBusy.svelte';

  let {
    open,
    path,
    name,
    projectId = null,
    current,
    anchor = null,
    onClose,
    onDone
  }: {
    open: boolean;
    path: string | null;
    name: string;
    projectId?: string | null;
    current: string | null;
    // The trigger element the menu aligns to. The menu is `position: fixed`
    // (so it escapes the footer's overflow-hidden zones) and is placed just
    // ABOVE this element's top-left, computed from its bounding rect on open.
    anchor?: HTMLElement | null;
    onClose: () => void;
    onDone?: () => void;
  } = $props();

  // ── data ──────────────────────────────────────────────────────────────────
  let local = $state<string[]>([]);
  let remotes = $state<string[]>([]);
  let query = $state('');
  let loading = $state(false);

  // ── filtered lists ────────────────────────────────────────────────────────
  const filteredLocal = $derived(filterBranches(local, query));
  const filteredRemotes = $derived(filterBranches(remotes, query));

  // The "Create" row appears when there is a non-empty query that doesn't
  // exactly match any existing local branch (case-sensitive, matching git).
  const showCreate = $derived(query.trim() !== '' && !local.includes(query.trim()));

  // ── keyboard nav ─────────────────────────────────────────────────────────
  // Flatten: local rows → remote rows → create row (when visible).
  const totalRows = $derived(
    filteredLocal.length + filteredRemotes.length + (showCreate ? 1 : 0)
  );
  let active = $state(-1);

  // ── DOM refs ──────────────────────────────────────────────────────────────
  let menuEl = $state<HTMLDivElement | null>(null);
  let inputEl = $state<HTMLInputElement | null>(null);

  // ── fixed-menu position (measured from the anchor on open) ─────────────────
  let menuLeft = $state(0);
  let menuBottom = $state(0);

  // ── open / load effect ────────────────────────────────────────────────────
  $effect(() => {
    if (!open) return;

    if (!path) {
      onClose();
      return;
    }

    // Anchor the fixed menu just above the trigger's top-left.
    const rect = anchor?.getBoundingClientRect();
    if (rect) {
      menuLeft = rect.left;
      menuBottom = window.innerHeight - rect.top + 6;
    }

    // Load branch list and reset UI state whenever the menu opens.
    query = '';
    active = -1;
    loading = true;

    listBranches(path).then((result) => {
      local = result.local;
      remotes = result.remotes;
      loading = false;

      // Highlight the current branch's row, or row 0 as a fallback.
      const idx = result.local.indexOf(current ?? '');
      active = idx >= 0 ? idx : 0;
    });

    // Focus the filter input after the menu renders.
    requestAnimationFrame(() => inputEl?.focus());
  });

  // ── scroll highlighted row into view ─────────────────────────────────────
  $effect(() => {
    if (!open || !menuEl || active < 0) return;
    const opts = menuEl.querySelectorAll<HTMLElement>('.bp-opt');
    opts[active]?.scrollIntoView({ block: 'nearest' });
  });

  // ── helpers ───────────────────────────────────────────────────────────────
  const busy = $derived(gitBusy.isBusy(path));

  function activateRow(idx: number) {
    if (idx < 0 || idx >= totalRows) return;

    if (idx < filteredLocal.length) {
      const branch = filteredLocal[idx];
      if (branch === current) {
        onClose();
        return;
      }
      void switchBranch(path, branch, name, projectId, onDone);
      onClose();
      return;
    }

    const remoteIdx = idx - filteredLocal.length;
    if (remoteIdx < filteredRemotes.length) {
      const ref = filteredRemotes[remoteIdx];
      void switchBranch(path, remoteShortName(ref), name, projectId, onDone);
      onClose();
      return;
    }

    // Must be the create row.
    if (showCreate) {
      void createBranch(path, query.trim(), name, projectId, onDone);
      onClose();
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        active = Math.min(totalRows - 1, active + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        active = Math.max(0, active - 1);
        break;
      case 'Home':
        e.preventDefault();
        active = 0;
        break;
      case 'End':
        e.preventDefault();
        active = Math.max(0, totalRows - 1);
        break;
      case 'Enter':
        e.preventDefault();
        if (!busy) activateRow(active);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        onClose();
        break;
    }
  }

  // Recompute highlight whenever the filter changes so the active index stays
  // sensible (clamp to the new total row count).
  $effect(() => {
    // Track totalRows reactively.
    const t = totalRows;
    if (active >= t) active = Math.max(0, t - 1);
  });
</script>

{#if open}
  <!-- Transparent scrim: outside click closes the menu. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="bp-scrim"
    role="presentation"
    onclick={onClose}
  ></div>

  <!-- Menu panel — stops click propagation so it doesn't hit the scrim. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="bp-menu"
    bind:this={menuEl}
    style:left={`${menuLeft}px`}
    style:bottom={`${menuBottom}px`}
    onclick={(e) => e.stopPropagation()}
  >
    <!-- Filter input at the top of the menu. -->
    <!-- svelte-ignore a11y_autofocus -->
    <input
      bind:this={inputEl}
      bind:value={query}
      class="bp-filter"
      placeholder="Filter or create branch…"
      onkeydown={onKeyDown}
    />

    {#if loading}
      <div class="bp-empty">Loading…</div>
    {:else}
      <!-- ── Local section ── -->
      {#if filteredLocal.length > 0}
        <div class="bp-section-label">Local</div>
        {#each filteredLocal as branch, i (branch)}
          {@const rowIdx = i}
          <button
            type="button"
            class="bp-opt"
            class:current={branch === current}
            class:hl={active === rowIdx}
            disabled={busy}
            onmousemove={() => (active = rowIdx)}
            onclick={() => { if (!busy) activateRow(rowIdx); }}
          >
            <Icon name="git-branch" size={12} color="var(--fg-3)" />
            <span class="bp-branch-name">{branch}</span>
            {#if branch === current}
              <Icon name="check" size={13} color="var(--blue-300)" />
            {/if}
          </button>
        {/each}
      {/if}

      <!-- ── Remotes section ── -->
      {#if filteredRemotes.length > 0}
        {#if filteredLocal.length > 0}
          <div class="bp-sep"></div>
        {/if}
        <div class="bp-section-label">Remotes</div>
        {#each filteredRemotes as ref, i (ref)}
          {@const rowIdx = filteredLocal.length + i}
          <button
            type="button"
            class="bp-opt bp-opt-remote"
            class:hl={active === rowIdx}
            disabled={busy}
            onmousemove={() => (active = rowIdx)}
            onclick={() => { if (!busy) activateRow(rowIdx); }}
          >
            <Icon name="git-branch" size={12} color="var(--fg-3)" />
            <span class="bp-branch-name">{ref}</span>
          </button>
        {/each}
      {/if}

      <!-- ── Empty state ── -->
      {#if filteredLocal.length === 0 && filteredRemotes.length === 0 && !showCreate}
        <div class="bp-empty">No branches</div>
      {/if}

      <!-- ── Create row ── -->
      {#if showCreate}
        {#if filteredLocal.length > 0 || filteredRemotes.length > 0}
          <div class="bp-sep"></div>
        {/if}
        {@const createIdx = filteredLocal.length + filteredRemotes.length}
        <button
          type="button"
          class="bp-opt bp-create"
          class:hl={active === createIdx}
          disabled={busy}
          onmousemove={() => (active = createIdx)}
          onclick={() => { if (!busy) activateRow(createIdx); }}
        >
          <Icon name="plus" size={13} color="var(--blue-300)" />
          <span>Create branch <span class="bp-create-name">'{query.trim()}'</span></span>
        </button>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .bp-scrim {
    position: fixed;
    inset: 0;
    z-index: 3000;
  }

  .bp-menu {
    /* Fixed so it escapes the footer zones' overflow:hidden; positioned just
       above the trigger via inline left/bottom measured from the anchor rect. */
    position: fixed;
    z-index: 3001;
    min-width: 240px;
    max-height: 320px;
    overflow-y: auto;
    background: var(--space-700);
    border: 1px solid var(--line-default);
    border-radius: var(--r-md);
    box-shadow: var(--shadow-pop);
    padding: 5px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .bp-filter {
    width: 100%;
    background: var(--space-800);
    border: 1px solid var(--line-default);
    border-radius: var(--r-sm);
    padding: 7px 10px;
    color: var(--fg-1);
    font-family: var(--font-sans);
    font-size: 12.5px;
    outline: none;
    box-sizing: border-box;
    margin-bottom: 3px;
  }

  .bp-filter:focus {
    border-color: var(--blue-500);
    box-shadow: 0 0 0 2px var(--blue-tint);
  }

  .bp-filter::placeholder {
    color: var(--fg-4);
  }

  .bp-section-label {
    font-family: var(--font-sans);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-4);
    padding: 4px 10px 2px;
    user-select: none;
    -webkit-user-select: none;
  }

  .bp-opt {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    color: var(--fg-2);
    font-family: var(--font-mono);
    font-size: 12px;
    padding: 7px 10px;
    border-radius: var(--r-sm);
  }

  .bp-opt:hover:not(:disabled) {
    background: var(--line-faint);
    color: var(--fg-1);
  }

  /* Roving keyboard highlight — mirrors ProjectSelect's `.psel-opt.hl`. */
  .bp-opt.hl {
    background: color-mix(in srgb, var(--blue-500) 16%, transparent);
    color: var(--fg-1);
    box-shadow: inset 2px 0 0 var(--blue-500);
  }

  /* The currently checked-out branch gets a subtle tint. */
  .bp-opt.current {
    color: var(--fg-1);
  }

  /* Disabled while a git operation is in flight. */
  .bp-opt:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .bp-branch-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Remote refs are slightly dimmer than local branches. */
  .bp-opt-remote {
    color: var(--fg-3);
  }

  .bp-opt-remote:hover:not(:disabled),
  .bp-opt-remote.hl {
    color: var(--fg-2);
  }

  /* "Create branch" row inherits blue accent like ProjectSelect's "New project". */
  .bp-create {
    font-family: var(--font-sans);
    font-size: 13px;
    font-weight: 600;
    color: var(--blue-300);
  }

  .bp-create:hover:not(:disabled) {
    color: var(--blue-300);
    background: color-mix(in srgb, var(--blue-500) 10%, transparent);
  }

  .bp-create.hl {
    color: var(--blue-300);
    background: color-mix(in srgb, var(--blue-500) 16%, transparent);
    box-shadow: inset 2px 0 0 var(--blue-500);
  }

  .bp-create-name {
    font-family: var(--font-mono);
    font-size: 11.5px;
    font-weight: 500;
    color: var(--blue-200);
  }

  .bp-sep {
    height: 1px;
    background: var(--line-subtle);
    margin: 3px 2px;
  }

  .bp-empty {
    font-family: var(--font-sans);
    font-size: 12.5px;
    color: var(--fg-4);
    padding: 10px 10px;
    text-align: center;
    font-style: italic;
  }
</style>
