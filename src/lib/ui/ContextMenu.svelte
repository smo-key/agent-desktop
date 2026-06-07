<script lang="ts">
  // A small reusable right-click context menu: a fixed-position popover at (x, y)
  // with a list of items, dismissed on outside-click or Escape. Consumers own the
  // open/position state and pass the items; clicking an item runs its action and
  // closes the menu. Used by the project panel (delete a project) and the agent
  // overviews (open / close an agent).

  import Icon from '../icons/Icon.svelte';

  export interface MenuItem {
    label: string;
    /** Optional leading glyph name (from the vendored icon set). */
    icon?: string;
    /** Renders the item in the destructive (red) style. */
    danger?: boolean;
    onClick: () => void;
  }

  let {
    open,
    x,
    y,
    items,
    onClose
  }: {
    open: boolean;
    x: number;
    y: number;
    items: MenuItem[];
    onClose: () => void;
  } = $props();

  function run(item: MenuItem) {
    onClose();
    item.onClick();
  }
</script>

{#if open}
  <!-- Transparent full-screen catcher closes the menu on any outside interaction. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="cm-scrim"
    role="presentation"
    onclick={onClose}
    oncontextmenu={(e) => {
      e.preventDefault();
      onClose();
    }}
    onkeydown={(e) => {
      if (e.key === 'Escape') onClose();
    }}
  >
    <div
      class="cm-menu"
      role="menu"
      tabindex="-1"
      style:left={`${x}px`}
      style:top={`${y}px`}
      onclick={(e) => e.stopPropagation()}
    >
      {#each items as item, i (i)}
        <button type="button" class="cm-item" class:danger={item.danger} role="menuitem" onclick={() => run(item)}>
          {#if item.icon}<span class="cm-ic"><Icon name={item.icon} size={15} /></span>{/if}
          {item.label}
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .cm-scrim {
    position: fixed;
    inset: 0;
    z-index: 3000;
  }
  .cm-menu {
    position: fixed;
    min-width: 168px;
    background: var(--space-700);
    border: 1px solid var(--line-default);
    border-radius: var(--r-md);
    box-shadow: var(--shadow-pop);
    padding: 5px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .cm-item {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--fg-2);
    font-family: var(--font-sans);
    font-size: 13px;
    padding: 8px 10px;
    border-radius: var(--r-sm);
  }
  /* Leading glyph: dimmer than the label so the text stays primary. */
  .cm-ic {
    display: inline-flex;
    flex: none;
    color: var(--fg-3);
  }
  .cm-item:hover .cm-ic { color: var(--fg-2); }
  .cm-item.danger .cm-ic { color: inherit; }
  .cm-item:hover {
    background: rgba(255, 255, 255, 0.05);
    color: var(--fg-1);
  }
  .cm-item.danger {
    color: #ff8077;
  }
  .cm-item.danger:hover {
    background: var(--abort-tint);
    color: #ff8077;
  }
</style>
