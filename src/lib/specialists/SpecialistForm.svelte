<script lang="ts">
  // The shared CREATE/EDIT form for a specialist (a native Claude Code subagent),
  // hosted by SpecialistDialog. Top: the specialist name as a big title input.
  // Then description, an optional model override, a free-text tools allow-list, and
  // the system-prompt editor (a textarea for the markdown body). A single full-width
  // Create / Save button commits; it is blocked (with the reason shown) while the
  // name is invalid. Mirrors ProjectForm.svelte's structure + styling tokens.
  //
  // The form assembles the Specialist via the PURE `buildSpecialist` helper and
  // validates the name via the store's `validateName` (filename-safety +
  // uniqueness); the actual write is delegated to `onSave` (the dialog owns the
  // active project path).

  import type { Specialist } from './specialists';
  import { specialists } from './specialists.svelte';
  import { buildSpecialist, formatToolsInput } from './specialistForm';

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

  // Seed the editable fields ONCE from the initial specialist (the dialog remounts
  // per open, so `initial` never changes mid-life).
  // svelte-ignore state_referenced_locally
  const seed = initial;
  let name = $state(seed?.name ?? '');
  let description = $state(seed?.description ?? '');
  let model = $state(seed?.model ?? '');
  let tools = $state(formatToolsInput(seed?.tools));
  let prompt = $state(seed?.prompt ?? '');

  // Validate the name against the loaded entries. On EDIT, exclude the specialist's
  // own name so an in-place edit (without renaming) is allowed.
  const nameCheck = $derived(
    specialists.validateName(name, mode === 'edit' ? seed?.name : undefined)
  );
  const nameError = $derived(name.trim() === '' ? null : nameCheck.ok ? null : nameCheck.reason);
  const canSave = $derived(nameCheck.ok && description.trim() !== '');

  function submit() {
    if (!canSave) return;
    onSave(buildSpecialist({ name, description, model, tools, prompt }));
  }

  function onNameKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  }
</script>

<div class="sf">
  <!-- Identity: the name as the dialog's title input. -->
  <!-- svelte-ignore a11y_autofocus -->
  <input
    class="sf-title"
    autofocus
    bind:value={name}
    placeholder="specialist-name…"
    aria-label="Specialist name"
    onkeydown={onNameKey}
  />
  {#if nameError}
    <p class="sf-err" role="alert">{nameError}</p>
  {/if}

  <div class="sf-field">
    <span class="sf-flabel">Description</span>
    <input
      class="sf-input"
      bind:value={description}
      placeholder="What this specialist is for…"
      aria-label="Description"
    />
  </div>

  <div class="sf-field">
    <span class="sf-flabel">Model</span>
    <input
      class="sf-input"
      bind:value={model}
      placeholder="Inherit (e.g. claude-sonnet-4-6)"
      aria-label="Model override"
    />
  </div>

  <div class="sf-field">
    <span class="sf-flabel">Tools</span>
    <input
      class="sf-input"
      bind:value={tools}
      placeholder="All tools (e.g. Read, Edit, Bash)"
      aria-label="Tools allow-list"
    />
  </div>

  <div class="sf-field">
    <span class="sf-flabel">System prompt</span>
    <textarea
      class="sf-prompt"
      bind:value={prompt}
      placeholder="You are a meticulous reviewer. Focus on…"
      aria-label="System prompt"
      rows="8"
    ></textarea>
  </div>

  <button type="button" class="sf-submit" disabled={!canSave} onclick={submit}>
    {mode === 'edit' ? 'Save changes' : 'Create specialist'}
  </button>
</div>

<style>
  .sf {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .sf-title {
    box-sizing: border-box;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--line-subtle);
    /* Right padding clears the dialog's floating close button. */
    padding: 4px 30px 8px 2px;
    color: var(--fg-1);
    font-family: var(--font-display);
    font-size: 22px;
    font-weight: 600;
    letter-spacing: var(--tracking-tight);
    outline: none;
    transition: border-color var(--dur-fast);
  }
  .sf-title:focus {
    border-bottom-color: var(--blue-500);
  }
  .sf-title::placeholder {
    color: var(--fg-4);
  }
  .sf-err {
    margin: -8px 0 0;
    color: #ff8077;
    font-size: 12px;
  }

  .sf-field {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .sf-flabel {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: var(--tracking-label, 0.07em);
    text-transform: uppercase;
    color: var(--fg-3);
  }

  .sf-input,
  .sf-prompt {
    box-sizing: border-box;
    width: 100%;
    background: var(--space-900);
    border: 1px solid var(--line-default);
    border-radius: var(--r-sm);
    padding: 9px 11px;
    color: var(--fg-1);
    font-family: var(--font-sans);
    font-size: 12.5px;
    outline: none;
    transition: border-color var(--dur-fast);
  }
  .sf-input:focus,
  .sf-prompt:focus {
    border-color: var(--blue-500);
  }
  .sf-input::placeholder,
  .sf-prompt::placeholder {
    color: var(--fg-4);
  }
  .sf-prompt {
    resize: vertical;
    min-height: 120px;
    line-height: 1.5;
    font-family: var(--font-mono);
    font-size: 12px;
  }

  /* Full-width primary commit. */
  .sf-submit {
    width: 100%;
    box-sizing: border-box;
    margin-top: 2px;
    padding: 11px 16px;
    border: 1px solid transparent;
    border-radius: var(--r-md);
    background: var(--blue-500);
    color: #fff;
    font-family: var(--font-sans);
    font-size: 13.5px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.12) inset;
    transition:
      background var(--dur-fast),
      opacity var(--dur-fast);
  }
  .sf-submit:hover:not(:disabled) {
    background: var(--blue-600);
  }
  .sf-submit:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
