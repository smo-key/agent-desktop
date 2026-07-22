<script lang="ts">
  // The single app-wide pane context menu. Rendered once (in +page.svelte). Reads
  // the reactive `contextMenu` store, paints divider-separated sections of items,
  // runs an item's action on click, and dismisses on Escape / outside click /
  // action. Positions at the cursor, flipping away from the viewport edges.
  import { contextMenu } from './contextmenu.svelte';

  let menuEl = $state<HTMLDivElement | null>(null);
  let left = $state(0);
  let top = $state(0);

  // Position at the cursor, then nudge in if we'd overflow the viewport. Runs
  // after the menu mounts (so getBoundingClientRect has real dimensions).
  $effect(() => {
    if (!contextMenu.open) return;
    const x = contextMenu.x;
    const y = contextMenu.y;
    left = x;
    top = y;
    const el = menuEl;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    if (x + r.width > window.innerWidth) {
      left = Math.max(pad, window.innerWidth - r.width - pad);
    }
    if (y + r.height > window.innerHeight) {
      top = Math.max(pad, window.innerHeight - r.height - pad);
    }
  });

  // Dismiss on outside pointerdown or Escape, only while open.
  $effect(() => {
    if (!contextMenu.open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target;
      if (menuEl && t instanceof Node && menuEl.contains(t)) return;
      contextMenu.hide();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') contextMenu.hide();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  });

  function invoke(item: { disabled?: boolean; run(): void }) {
    if (item.disabled) return;
    item.run();
    contextMenu.hide();
  }
</script>

{#if contextMenu.open}
  <div
    class="menu"
    bind:this={menuEl}
    style="left: {left}px; top: {top}px;"
    role="menu"
    tabindex="-1"
    oncontextmenu={(e) => e.preventDefault()}
  >
    {#each contextMenu.sections as section, si (si)}
      {#if si > 0}<div class="divider"></div>{/if}
      {#each section as item (item.id)}
        <button
          class="item"
          role="menuitem"
          disabled={item.disabled}
          onclick={() => invoke(item)}
        >
          <span class="label">{item.label}</span>
          {#if item.shortcut}<span class="sc">{item.shortcut}</span>{/if}
        </button>
      {/each}
    {/each}
  </div>
{/if}

<style>
  /* GH-dark terminal-chrome palette (--term-*): this menu pops up over panes,
     which are terminals, so it deliberately matches the terminal's own accent
     family rather than the app's NASA-blue --accent. */
  .menu {
    position: fixed;
    z-index: 1000;
    min-width: 176px;
    padding: 4px;
    background: var(--space-700);
    border: 1px solid var(--term-border);
    border-radius: 8px;
    box-shadow:
      0 8px 28px rgba(0, 0, 0, 0.5),
      0 1px 0 var(--line-faint) inset;
    user-select: none;
    -webkit-user-select: none;
    font-family:
      ui-sans-serif, -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
  }

  .item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    width: 100%;
    padding: 5px 8px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--term-fg);
    font-size: 12.5px;
    text-align: left;
    cursor: default;
  }
  .item:hover:not(:disabled) {
    background: var(--term-accent-strong);
    /* Literal white: reads fine against --term-accent-strong in both themes. */
    color: #fff;
  }
  .item:disabled {
    color: var(--term-fg-subtle);
  }

  .sc {
    font-size: 11px;
    color: var(--term-fg-subtle);
  }
  .item:hover:not(:disabled) .sc {
    color: var(--term-fg-on-accent);
  }

  .divider {
    height: 1px;
    margin: 4px 6px;
    background: var(--term-border);
  }
</style>
