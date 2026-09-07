<script lang="ts">
  // A keyboard-shortcut RECORDER control for Settings → Keyboard shortcuts
  // (keyboard-shortcuts spec: "Keyboard shortcuts are user-customizable"). Shows
  // the shortcut's current chord as <kbd> chips; clicking it arms recording
  // ("Press keys…"), and the NEXT recordable keydown becomes the binding. Esc
  // cancels. A chord another shortcut already uses is refused and the conflict is
  // named inline for a moment. A reset glyph appears when the row is customized.
  // All mechanics are the pure `keybindings` helpers + the `shortcuts` store; this
  // component only owns the recording latch and the transient hint.
  import { shortcuts } from '$lib/settings/shortcuts.svelte';
  import { chordFromEvent, formatChord, isRecordableChord, shortcutLabel, type ShortcutId } from './keybindings';
  import { tooltip } from './tooltip';
  import Icon from '../icons/Icon.svelte';

  let { id }: { id: ShortcutId } = $props();

  let recording = $state(false);
  let hint = $state<string | null>(null);
  let hintTimer: ReturnType<typeof setTimeout> | undefined;
  let button = $state<HTMLButtonElement | null>(null);

  const keys = $derived(formatChord(shortcuts.chord(id)));
  const customized = $derived(shortcuts.isCustomized(id));

  function showHint(text: string) {
    hint = text;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => (hint = null), 2200);
  }

  function arm() {
    recording = true;
    hint = null;
  }

  function disarm() {
    recording = false;
  }

  function onKeydown(e: KeyboardEvent) {
    if (!recording) return;
    // While recording, EVERY key is ours — nothing bubbles to the app shortcuts.
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      disarm();
      return;
    }
    const chord = chordFromEvent(e);
    if (!chord) return; // a lone modifier: keep waiting for the key
    if (!isRecordableChord(chord)) {
      showHint('Add ⌘, ⌃ or ⌥');
      return;
    }
    const res = shortcuts.setBinding(id, chord);
    if (!res.ok) {
      showHint(`Used by “${shortcutLabel(res.conflict)}”`);
      return;
    }
    disarm();
  }
</script>

<span class="recorder" class:recording>
  <button
    type="button"
    class="chord"
    bind:this={button}
    aria-label={`Change shortcut for ${shortcutLabel(id)}`}
    aria-pressed={recording}
    onclick={() => (recording ? disarm() : arm())}
    onkeydown={onKeydown}
    onblur={disarm}
  >
    {#if recording}
      <span class="prompt">Press keys…</span>
    {:else}
      {#each keys as k, i (i)}
        <kbd>{k}</kbd>
      {/each}
    {/if}
  </button>
  {#if hint}
    <span class="hint" role="status">{hint}</span>
  {/if}
  {#if customized && !recording}
    <button
      type="button"
      class="reset"
      aria-label={`Reset ${shortcutLabel(id)} to its default`}
      use:tooltip={'Reset to default'}
      onclick={() => shortcuts.resetBinding(id)}
    >
      <Icon name="rotate-ccw" size={12} />
    </button>
  {/if}
</span>

<style>
  .recorder {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    position: relative;
  }
  .chord {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 96px;
    height: 30px;
    padding: 0 8px;
    justify-content: center;
    border: 1px solid var(--line-default);
    border-radius: var(--r-sm);
    background: var(--space-650);
    color: var(--fg-1);
    font-family: var(--font-sans);
    font-size: 12.5px;
    cursor: pointer;
  }
  .chord:hover {
    border-color: var(--line-strong);
  }
  .chord:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: var(--focus-ring);
  }
  .recording .chord {
    border-color: var(--accent);
    color: var(--fg-2);
  }
  .prompt {
    font-size: 12px;
    font-style: italic;
  }
  kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border: 1px solid var(--line-default);
    border-bottom-width: 2px;
    border-radius: 4px;
    background: var(--space-750);
    color: var(--fg-1);
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1;
  }
  .hint {
    position: absolute;
    right: 0;
    top: 100%;
    margin-top: 4px;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--orange-300);
  }
  .reset {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--fg-3);
    cursor: pointer;
  }
  .reset:hover {
    background: rgba(255, 255, 255, 0.05);
    color: var(--fg-1);
  }
</style>
