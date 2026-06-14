<script lang="ts" module>
  /** One choice in a `Dropdown`. `icon` is an optional leading brand-icon key
   *  (from `BRAND_ICONS`), supplied only where relevant (the open-with rows). */
  export interface DropdownOption {
    value: string;
    label: string;
    icon?: string;
  }
</script>

<script lang="ts">
  // A reusable, accessible dropdown control replacing the native <select> across the
  // Settings dialog. A trigger button shows the active option (icon + label); opening
  // reveals a fixed-position listbox popover (so it escapes the dialog's scroll
  // clipping), dismissed on Escape / outside-click / select. Keyboard: arrows + Home/
  // End move the highlight (pure `rovingIndex`), Enter/Space select, Escape closes.
  // The active option is checkmarked. Icons render only when an option carries one.
  import { rovingIndex } from './dropdown';
  import { autofocus } from './autofocus';
  import BrandIcon from '../icons/BrandIcon.svelte';

  let {
    value,
    options,
    onChange,
    width = 170,
    ariaLabel,
    disabled = false,
    autofocusTrigger = false
  }: {
    value: string;
    options: DropdownOption[];
    onChange: (value: string) => void;
    width?: number;
    ariaLabel?: string;
    disabled?: boolean;
    /** Focus this dropdown's trigger when it mounts (the dialog's first control). */
    autofocusTrigger?: boolean;
  } = $props();

  let open = $state(false);
  let highlight = $state(0);
  let triggerEl = $state<HTMLButtonElement>();
  // Fixed-position coordinates for the popover, measured from the trigger on open.
  let pos = $state({ left: 0, top: 0, width: 0 });

  const selected = $derived(options.find((o) => o.value === value));

  function openMenu() {
    if (disabled) return;
    const r = triggerEl?.getBoundingClientRect();
    if (r) {
      // Open downward, but flip upward when the trigger sits too low for the menu to
      // fit below it (e.g. the Notification rows near the dialog bottom).
      const estH = Math.min(options.length * 34 + 10, 264);
      const below = window.innerHeight - r.bottom;
      const flipUp = below < estH + 8 && r.top > below;
      pos = {
        left: r.left,
        top: flipUp ? Math.max(8, r.top - estH - 4) : r.bottom + 4,
        width: r.width
      };
    }
    const idx = options.findIndex((o) => o.value === value);
    highlight = idx >= 0 ? idx : 0;
    open = true;
  }

  function closeMenu(refocus = true) {
    open = false;
    if (refocus) triggerEl?.focus();
  }

  function choose(opt: DropdownOption) {
    onChange(opt.value);
    closeMenu();
  }

  function onTriggerKeydown(e: KeyboardEvent) {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openMenu();
    }
  }

  function onMenuKeydown(e: KeyboardEvent) {
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        closeMenu();
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (options[highlight]) choose(options[highlight]);
        break;
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Home':
      case 'End':
        e.preventDefault();
        highlight = rovingIndex(highlight, e.key, options.length);
        break;
    }
  }

  // Keep the highlighted index valid when `options` changes while the menu is open
  // (e.g. async install-detection resolves and adds rows): re-anchor to the current
  // value's row so the highlight never points past the array or at a shifted row.
  // Only fires on options/value change — arrow-key navigation (which mutates only
  // `highlight`) is untouched, so in-progress keyboard navigation is preserved.
  $effect(() => {
    if (!open) return;
    const idx = options.findIndex((o) => o.value === value);
    if (idx >= 0) highlight = idx;
  });

  // The fixed popover detaches from the trigger when the page scrolls/resizes, so
  // close it rather than letting it float in the wrong place.
  $effect(() => {
    if (!open) return;
    const close = () => closeMenu(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  });
</script>

<div class="dd" style:width={`${width}px`}>
  <button
    type="button"
    class="dd-trigger"
    bind:this={triggerEl}
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label={ariaLabel}
    {disabled}
    use:autofocus={{ enabled: autofocusTrigger }}
    onclick={() => (open ? closeMenu() : openMenu())}
    onkeydown={onTriggerKeydown}
  >
    {#if selected?.icon}<span class="dd-ic"><BrandIcon name={selected.icon} size={15} /></span>{/if}
    <span class="dd-text">{selected?.label ?? ''}</span>
    <span class="dd-caret" aria-hidden="true">▾</span>
  </button>

  {#if open}
    <!-- Transparent full-screen catcher closes the menu on any outside click. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="dd-scrim" role="presentation" onclick={() => closeMenu(false)}></div>
    <ul
      class="dd-menu"
      role="listbox"
      tabindex="-1"
      aria-label={ariaLabel}
      use:autofocus
      style:left={`${pos.left}px`}
      style:top={`${pos.top}px`}
      style:min-width={`${pos.width}px`}
      onkeydown={onMenuKeydown}
    >
      {#each options as opt, i (opt.value)}
        <li role="option" aria-selected={opt.value === value}>
          <button
            type="button"
            class="dd-opt"
            class:highlight={i === highlight}
            tabindex="-1"
            onclick={() => choose(opt)}
            onmousemove={() => (highlight = i)}
          >
            {#if opt.icon}<span class="dd-ic"><BrandIcon name={opt.icon} size={15} /></span>{/if}
            <span class="dd-text">{opt.label}</span>
            {#if opt.value === value}<span class="dd-check" aria-hidden="true">✓</span>{/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .dd {
    position: relative;
    display: inline-block;
  }
  /* Trigger mirrors the native <select> it replaces (height/colors/tokens). */
  .dd-trigger {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    height: 30px;
    padding: 0 8px;
    border: 1px solid var(--line-default);
    border-radius: var(--r-sm);
    background: var(--space-650);
    color: var(--fg-1);
    font-family: var(--font-sans);
    font-size: 12.5px;
    cursor: pointer;
    text-align: left;
  }
  .dd-trigger:hover {
    border-color: var(--line-strong);
  }
  .dd-trigger:focus-visible {
    outline: none;
    border-color: var(--accent);
  }
  .dd-trigger:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .dd-text {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dd-caret {
    flex: none;
    color: var(--fg-3);
    font-size: 10px;
    line-height: 1;
  }
  .dd-ic {
    display: inline-flex;
    flex: none;
    color: var(--fg-2);
  }

  .dd-scrim {
    position: fixed;
    inset: 0;
    z-index: 3000;
  }
  .dd-menu {
    position: fixed;
    z-index: 3001;
    margin: 0;
    padding: 5px;
    list-style: none;
    max-height: 264px;
    overflow-y: auto;
    background: var(--space-700);
    border: 1px solid var(--line-default);
    border-radius: var(--r-md);
    box-shadow: var(--shadow-pop);
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .dd-menu li {
    display: block;
  }
  .dd-opt {
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
    padding: 7px 9px;
    border-radius: var(--r-sm);
  }
  .dd-opt.highlight {
    background: rgba(255, 255, 255, 0.05);
    color: var(--fg-1);
  }
  .dd-opt.highlight .dd-ic {
    color: var(--fg-1);
  }
  .dd-check {
    flex: none;
    margin-left: auto;
    color: var(--accent);
    font-size: 11px;
  }
</style>
