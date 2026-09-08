<script lang="ts">
  // The "What's new" (release notes) MODAL. Opened once per version on launch by
  // `whatsNew.maybeShowOnLaunch` (+page.svelte) and any time from the Settings
  // version button via `whatsNew.show()`. Renders the running version's
  // CHANGELOG.md section as titled groups of bullets, built from parsed inline
  // runs (never innerHTML). Dismiss with Esc, a backdrop click, the close
  // button, or "Got it". Follows HelpModal's backdrop/dialog pattern.

  import { whatsNew } from './whatsNewStore.svelte';
  import { autofocus } from '$lib/ui/autofocus';

  // On close, hand focus back to the dialog beneath (the Settings dialog when the
  // notes were opened from its version button): its Esc handler only fires with
  // focus inside it, and unmounting the focused "Got it" button would otherwise
  // drop focus to <body>, leaving Esc dead and the app shortcuts firing under it.
  function close() {
    whatsNew.close();
    queueMicrotask(() => {
      const below = document.querySelector<HTMLElement>('[role="dialog"]');
      if (below && document.activeElement === document.body) below.focus();
    });
  }

  // Esc closes. Scoped to the modal so it doesn't fight the global app shortcuts.
  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }
</script>

{#if whatsNew.open}
  <!-- Backdrop: a click outside the dialog closes. -->
  <div class="backdrop" role="presentation" onclick={close} onkeydown={onKeydown}>
    <!-- The dialog. stopPropagation on click so an inside click doesn't close. -->
    <div
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-label="What's new"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={onKeydown}
    >
      <header class="head">
        <h2>What's new in Agent Desktop {whatsNew.version === 'dev' ? '' : `v${whatsNew.version}`}</h2>
        <button class="x" aria-label="Close" onclick={close}>×</button>
      </header>

      {#if whatsNew.groups.length === 0}
        <p class="empty">No release notes for this version.</p>
      {:else}
        <div class="groups">
          {#each whatsNew.groups as group, gi (gi)}
            <section class="group">
              {#if group.heading}
                <span class="label">{group.heading}</span>
              {/if}
              <ul class="items">
                {#each group.items as runs, ii (ii)}
                  <li class="item">
                    {#each runs as run, ri (ri)}
                      {#if run.kind === 'bold'}
                        <strong>{run.text}</strong>
                      {:else if run.kind === 'code'}
                        <code>{run.text}</code>
                      {:else if run.kind === 'link'}
                        <!-- No external-URL opener in the app yet: show the text, keep the URL as a hint. -->
                        <span class="link" title={run.href}>{run.text}</span>
                      {:else}
                        {run.text}
                      {/if}
                    {/each}
                  </li>
                {/each}
              </ul>
            </section>
          {/each}
        </div>
      {/if}

      <footer class="foot">
        <button class="ok" onclick={close} use:autofocus>Got it</button>
      </footer>
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
    width: min(560px, calc(100vw - 32px));
    max-height: 80vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 18px 20px 18px;
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

  .empty {
    margin: 0;
    font-size: 13px;
    color: var(--fg-3);
  }

  .groups {
    display: flex;
    flex-direction: column;
    gap: 16px;
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
  .items {
    margin: 0;
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .item {
    font-size: 13px;
    line-height: 1.5;
    color: var(--fg-2);
  }
  .item strong {
    color: var(--fg-1);
    font-weight: 600;
  }
  .item code {
    padding: 1px 5px;
    border-radius: var(--r-sm);
    background: var(--space-650);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .link {
    text-decoration: underline dotted;
    text-underline-offset: 2px;
  }

  .foot {
    display: flex;
    justify-content: flex-end;
  }
  .ok {
    padding: 6px 14px;
    border: 1px solid var(--line-default);
    border-radius: var(--r-md);
    background: var(--space-650);
    color: var(--fg-1);
    font-family: var(--font-sans);
    font-size: 13px;
    cursor: pointer;
  }
  .ok:hover {
    background: var(--space-600);
  }
</style>
