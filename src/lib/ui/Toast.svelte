<script lang="ts">
  // Root-mounted TOAST overlay: renders the live `toast.items` as a bottom-left
  // stack of self-dismissing cards (e.g. "Build completed" on task success).
  // Click a toast to dismiss it early; otherwise the store auto-removes it. Kept
  // dead simple — one success style — matching the app's dark tokens.
  import { toast } from './toastStore.svelte';
</script>

<div class="toast-layer" aria-live="polite" aria-atomic="false">
  {#each toast.items as item (item.id)}
    <button type="button" class="toast" onclick={() => toast.dismiss(item.id)} title="Dismiss">
      <span class="tick" aria-hidden="true">✓</span>
      <span class="msg">{item.message}</span>
    </button>
  {/each}
</div>

<style>
  .toast-layer {
    position: fixed;
    left: 16px;
    bottom: 16px;
    z-index: 2100; /* above the modals (2000) */
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: flex-start;
    pointer-events: none; /* the layer ignores clicks; each toast re-enables them */
  }

  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 11px;
    max-width: 440px;
    padding: 14px 18px;
    background: var(--space-800);
    border: 1px solid var(--line-default);
    border-left: 4px solid var(--nominal-500, #3ccb7f);
    border-radius: var(--r-md);
    box-shadow: var(--shadow-lg);
    color: var(--fg-1);
    font-family: var(--font-sans);
    font-size: 14.5px;
    text-align: left;
    cursor: pointer;
    animation: toast-in var(--dur-base, 200ms) var(--ease-out, ease-out);
  }

  .tick {
    flex: none;
    display: grid;
    place-items: center;
    width: 19px;
    height: 19px;
    color: var(--nominal-500, #3ccb7f);
    font-size: 15px;
    font-weight: 700;
    line-height: 1;
  }

  .msg {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }

  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
