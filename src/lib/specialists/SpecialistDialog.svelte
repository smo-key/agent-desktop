<script lang="ts">
  // Modal dialog for CREATING / EDITING a specialist. A thin shell (backdrop +
  // centered dialog, Esc / backdrop-close) that hosts the shared SpecialistForm as
  // its body. The form owns the fields + Save/Cancel actions; this frames it as a
  // dialog and routes the close affordances to `onCancel`. Mirrors ProjectDialog.

  import type { Specialist } from './specialists';
  import SpecialistForm from './SpecialistForm.svelte';
  import Icon from '../icons/Icon.svelte';

  let {
    mode,
    initial,
    onSave,
    onCancel
  }: {
    mode: 'create' | 'edit';
    initial?: Specialist;
    onSave: (specialist: Specialist) => void;
    onCancel: () => void;
  } = $props();

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  }
</script>

<!-- Backdrop: a click outside the dialog cancels. -->
<div class="backdrop" role="presentation" onclick={onCancel} onkeydown={onKeydown}>
  <!-- stopPropagation on click so an inside click doesn't cancel. -->
  <div
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-label={mode === 'edit' ? 'Edit specialist' : 'New specialist'}
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={onKeydown}
  >
    <!-- No static title: the form's big name input IS the title. Just a close. -->
    <button class="x" aria-label="Close" onclick={onCancel}>
      <Icon name="x" size={15} color="var(--fg-3)" />
    </button>

    <SpecialistForm {mode} {initial} {onSave} {onCancel} />
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 2000;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 12vh;
    background: rgba(4, 6, 10, 0.66);
    backdrop-filter: blur(3px);
  }
  .dialog {
    position: relative;
    width: min(440px, calc(100vw - 32px));
    box-sizing: border-box;
    max-height: 80vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    padding: 18px 18px 16px;
    background: var(--space-800);
    border: 1px solid var(--line-default);
    border-radius: var(--r-xl);
    box-shadow: var(--shadow-lg);
    color: var(--fg-1);
    font-family: var(--font-sans);
    outline: none;
  }
  .x {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 1;
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    cursor: pointer;
  }
  .x:hover {
    background: var(--line-faint);
  }
</style>
