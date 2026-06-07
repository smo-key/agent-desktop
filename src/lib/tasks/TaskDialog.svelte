<script lang="ts">
  // The task create/edit MODAL (tasks-panel spec — "Create/edit task dialog").
  // Opened from the Tasks launcher header `＋` (create) and a row's Edit action /
  // double-click (edit) via the shared `taskDialog` store. It lets the user set a
  // task's kind (terminal | agent), name, and either a command (terminal) or a
  // prompt (agent), then Save. On save it calls `projectTasks.update` (edit) or
  // `projectTasks.create` (create) and closes. Cancelling (Esc / backdrop /
  // Cancel) aborts with no change. Modeled on Launcher.svelte so it looks
  // identical to the New session dialog.

  import { untrack } from 'svelte';
  import { taskDialog } from './taskDialogStore.svelte';
  import { projectTasks } from './projectTasks.svelte';
  import type { TaskKind } from './projectTasks';

  // --- Local form state (the store holds only open/edit-target/project) -------
  let kind = $state<TaskKind>('terminal');
  let name = $state('');
  let command = $state('');
  let prompt = $state('');

  // A save needs a non-empty name; an agent task also needs a non-empty prompt.
  // An empty command IS allowed for a terminal — it means an interactive shell.
  const canSave = $derived(
    name.trim() !== '' && (kind !== 'agent' || prompt.trim() !== '')
  );

  // When the dialog opens (the open transition only), seed the form: EDIT mode
  // prefills from the existing def; CREATE mode resets to a blank terminal. The
  // writes are `untrack`ed so this effect depends ONLY on `taskDialog.open` (it
  // must not re-run as the user types or toggles kind).
  $effect(() => {
    if (!taskDialog.open) return;
    untrack(() => {
      const def = taskDialog.editId ? projectTasks.defForId(taskDialog.editId) : undefined;
      if (def) {
        kind = def.kind;
        name = def.name ?? '';
        command = def.command ?? '';
        prompt = def.prompt ?? '';
      } else {
        kind = 'terminal';
        name = '';
        command = '';
        prompt = '';
      }
    });
  });

  function cancel() {
    taskDialog.close();
  }

  async function save() {
    if (!canSave) return;
    if (taskDialog.editId) {
      // Pass only the relevant field per kind (the store normalizes the rest).
      if (kind === 'agent') {
        await projectTasks.update(taskDialog.editId, { name, kind, prompt });
      } else {
        await projectTasks.update(taskDialog.editId, { name, kind, command });
      }
    } else {
      if (!taskDialog.projectId) return;
      if (kind === 'agent') {
        await projectTasks.create(taskDialog.projectId, { kind, name, prompt });
      } else {
        await projectTasks.create(taskDialog.projectId, { kind, name, command });
      }
    }
    taskDialog.close();
  }

  // Keyboard: Esc cancels; Cmd/Ctrl-Enter saves (so the prompt textarea keeps
  // plain Enter for newlines). Scoped to the dialog so it doesn't fight the
  // global app shortcuts while open.
  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (canSave) void save();
    }
  }
</script>

{#if taskDialog.open}
  <!-- Backdrop: a click outside the dialog cancels. -->
  <div class="backdrop" role="presentation" onclick={cancel} onkeydown={onKeydown}>
    <!-- The dialog. stopPropagation on click so an inside click doesn't cancel. -->
    <div
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-label={taskDialog.editId ? 'Edit task' : 'New task'}
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={onKeydown}
    >
      <header class="head">
        <h2>{taskDialog.editId ? 'Edit task' : 'New task'}</h2>
        <button class="x" aria-label="Close" onclick={cancel}>×</button>
      </header>

      <!-- Kind: a segmented Terminal | Agent toggle (active one blue). -->
      <section class="field">
        <span class="label">Kind</span>
        <div class="seg" role="group" aria-label="Task kind">
          <button
            type="button"
            class:active={kind === 'terminal'}
            onclick={() => (kind = 'terminal')}
          >Terminal</button>
          <button
            type="button"
            class:active={kind === 'agent'}
            onclick={() => (kind = 'agent')}
          >Agent</button>
        </div>
      </section>

      <!-- Name: required. -->
      <section class="field">
        <span class="label">Name</span>
        <!-- svelte-ignore a11y_autofocus -->
        <input bind:value={name} autofocus placeholder="Task name" />
      </section>

      <!-- Command (terminal) or Prompt (agent) — only one shows per kind. -->
      {#if kind === 'terminal'}
        <section class="field">
          <span class="label">Command</span>
          <input
            class="mono"
            bind:value={command}
            placeholder="npm run dev — blank for an interactive shell"
          />
        </section>
      {:else}
        <section class="field">
          <span class="label">Prompt</span>
          <textarea class="mono" rows="4" bind:value={prompt} placeholder="Claude prompt…"></textarea>
        </section>
      {/if}

      <footer class="actions">
        <button class="cancel" onclick={cancel}>Cancel</button>
        <button class="launch" onclick={save} disabled={!canSave}>Save</button>
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
    width: min(580px, calc(100vw - 32px));
    overflow: visible;
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 18px 20px 16px;
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

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .label {
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-weight: 500;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--fg-3);
  }

  .field input,
  .field textarea {
    font-family: var(--font-sans);
    font-size: 13px;
    color: var(--fg-1);
    background: var(--space-900);
    border: 1px solid var(--line-subtle);
    border-radius: var(--r-md);
    padding: 9px 11px;
    outline: none;
  }
  .field input:focus,
  .field textarea:focus {
    border-color: var(--blue-500);
  }
  .field textarea {
    resize: vertical;
    min-height: 72px;
  }
  /* The command/prompt input renders in a monospace font. */
  .field input.mono,
  .field textarea.mono {
    font-family: var(--font-mono);
  }

  .seg {
    display: flex;
    gap: 0;
    border: 1px solid var(--line-subtle);
    border-radius: var(--r-md);
    overflow: hidden;
    align-self: flex-start;
  }
  .seg button {
    padding: 7px 18px;
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 600;
    color: var(--fg-3);
    background: transparent;
    border: none;
    cursor: pointer;
  }
  .seg button.active {
    color: #fff;
    background: var(--blue-500);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 2px;
  }
  .cancel,
  .launch {
    padding: 9px 16px;
    border-radius: var(--r-md);
    font-family: var(--font-sans);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition:
      background var(--dur-fast),
      border-color var(--dur-fast);
  }
  .cancel {
    border: 1px solid var(--line-default);
    background: var(--space-650);
    color: var(--fg-1);
  }
  .cancel:hover {
    background: var(--space-600);
  }
  .launch {
    border: 1px solid transparent;
    background: var(--blue-500);
    color: #fff;
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.12) inset;
  }
  .launch:hover:not(:disabled) {
    background: var(--blue-600);
  }
  .launch:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
