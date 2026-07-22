<script lang="ts">
  // A GENERIC confirmation MODAL — a reusable "are you sure?" dialog driven by the
  // shared `confirmModal` store. A caller opens it with
  // `confirmModal.show({ title, message, confirmLabel?, onConfirm })`; the danger
  // button confirms (closes then runs the callback), and Cancel / Esc / backdrop /
  // × dismiss without running it. Follows the Help/Settings modal backdrop/dialog
  // pattern. Mounted once globally (see +page.svelte).

  import { confirmModal } from './confirmStore.svelte';
  import { autofocus } from './autofocus';

  function cancel() {
    confirmModal.close();
  }

  function confirm() {
    void confirmModal.confirm();
  }

  // Esc cancels. Scoped to the modal so it doesn't fight global app shortcuts.
  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  }
</script>

{#if confirmModal.open}
  <!-- Backdrop: a click outside the dialog cancels. -->
  <div class="backdrop" role="presentation" onclick={cancel} onkeydown={onKeydown}>
    <!-- The dialog. stopPropagation on click so an inside click doesn't dismiss. -->
    <div
      class="dialog"
      role="alertdialog"
      aria-modal="true"
      aria-label={confirmModal.title}
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={onKeydown}
    >
      <header class="head">
        <h2>{confirmModal.title}</h2>
        <button class="x" aria-label="Cancel" onclick={cancel}>×</button>
      </header>

      <p class="message">{confirmModal.message}</p>

      <div class="actions">
        <!-- Focus the safe (non-destructive) action on open so a stray Enter
             dismisses rather than confirms. -->
        <button type="button" class="btn cancel" onclick={cancel} use:autofocus>Cancel</button>
        <button type="button" class="btn danger" onclick={confirm}>
          {confirmModal.confirmLabel}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 2100; /* above Settings/Help (2000) so a confirm can sit over them */
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 16vh;
    background: rgba(4, 6, 10, 0.66);
    backdrop-filter: blur(3px);
  }

  .dialog {
    width: min(420px, calc(100vw - 32px));
    display: flex;
    flex-direction: column;
    gap: 14px;
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
    font-size: 16px;
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
    background: var(--line-faint);
    color: var(--fg-1);
  }

  .message {
    margin: 0;
    font-size: 13px;
    line-height: 1.5;
    color: var(--fg-2);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .btn {
    height: 30px;
    padding: 0 14px;
    border-radius: var(--r-sm);
    border: 1px solid var(--line-default);
    background: var(--space-650);
    color: var(--fg-1);
    font-family: var(--font-sans);
    font-size: 12.5px;
    cursor: pointer;
  }
  .btn.cancel:hover {
    border-color: var(--line-strong);
    background: var(--space-600);
  }
  .btn.danger {
    color: var(--danger);
    border-color: var(--line-default);
  }
  .btn.danger:hover {
    border-color: var(--danger);
    background: var(--space-600);
  }
</style>
