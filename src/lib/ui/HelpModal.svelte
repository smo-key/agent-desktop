<script lang="ts">
  // The keyboard-shortcuts help MODAL. Opened from three entry points via the
  // shared `help` store (the ⌘/ shortcut and bare ? in +page.svelte's onKeydown,
  // and the title-bar "?" button). Read-only: it renders the SHORTCUTS registry as
  // titled sections of label + <kbd> chips. Dismiss with Esc, a backdrop click, or
  // the close button. Follows the Launcher modal's backdrop/dialog pattern.

  import { help } from './helpStore.svelte';
  import { SHORTCUTS } from './shortcuts';
  import { autofocus } from './autofocus';

  function close() {
    help.close();
  }

  // Esc closes. Scoped to the modal so it doesn't fight the global app shortcuts
  // while open (the global onKeydown also returns early when help.open).
  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }
</script>

{#if help.open}
  <!-- Backdrop: a click outside the dialog closes. -->
  <div class="backdrop" role="presentation" onclick={close} onkeydown={onKeydown}>
    <!-- The dialog. stopPropagation on click so an inside click doesn't close. -->
    <div
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={onKeydown}
    >
      <header class="head">
        <h2>Keyboard shortcuts</h2>
        <!-- Read-only modal: the close button is its only control, so it takes focus. -->
        <button class="x" aria-label="Close" onclick={close} use:autofocus>×</button>
      </header>

      <div class="groups">
        {#each SHORTCUTS as group (group.title)}
          <section class="group">
            <span class="label">{group.title}</span>
            <ul class="rows">
              {#each group.items as item (item.label)}
                <li class="row">
                  <span class="desc">{item.label}</span>
                  <span class="keys">
                    {#each item.keys as k (k)}
                      <kbd>{k}</kbd>
                    {/each}
                  </span>
                </li>
              {/each}
            </ul>
          </section>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 2000;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 10vh;
    background: rgba(4, 6, 10, 0.66);
    backdrop-filter: blur(3px);
  }

  .dialog {
    width: min(620px, calc(100vw - 32px));
    max-height: 80vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding: 18px 20px 20px;
    background: var(--space-800);
    border: 1px solid var(--line-default);
    border-radius: var(--r-xl);
    box-shadow: var(--shadow-lg);
    color: var(--fg-1);
    font-family: var(--font-sans);
    outline: none;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .head h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 17px;
    font-weight: 600;
    letter-spacing: var(--tracking-tight);
  }
  .x {
    width: 28px;
    height: 28px;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--fg-3);
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
  }
  .x:hover {
    background: rgba(255, 255, 255, 0.05);
    color: var(--fg-1);
  }

  .groups {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px 28px;
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .label {
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-weight: 500;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--fg-3);
  }

  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 0;
    border-bottom: 1px solid var(--line-faint);
  }
  .row:last-child {
    border-bottom: none;
  }
  .desc {
    font-size: 13px;
    color: var(--fg-2);
  }
  .keys {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }
  kbd {
    min-width: 20px;
    padding: 2px 6px;
    border: 1px solid var(--line-default);
    border-radius: var(--r-sm);
    background: var(--space-650);
    color: var(--fg-1);
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.4;
    text-align: center;
  }

  @media (max-width: 520px) {
    .groups {
      grid-template-columns: 1fr;
    }
  }
</style>
