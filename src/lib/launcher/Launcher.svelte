<script lang="ts">
  // The session-launcher MODAL (session-launcher spec). Opened from three entry
  // points via the shared `launcher` store (SessionRail "+ new session" row, the
  // pane context-menu "New Session" item, and the Cmd-N shortcut). It lets the
  // user:
  //   1. choose a target folder — a "Browse…" button calling the native picker
  //      (pickFolder) OR a one-click recent-folders list;
  //   2. optionally enter a multi-line initial prompt;
  //   3. pick a placement — New session (tab) / Split right / Split down.
  // On confirm it builds a PURE launch plan (plan.ts), hands it to
  // `workspace.launch(plan)` (which records {program:'claude', cwd, initialInput}
  // in the registry — the existing TerminalPane spawn path then applies the
  // --settings wrapper override + AGENT_DESKTOP_PANE env; we do NOT duplicate
  // that), records the folder as most-recent, and closes. Cancelling (Esc /
  // backdrop / Cancel) aborts: no session, no PTY, recents unchanged.

  import { onMount, tick, untrack } from 'svelte';
  import { launcher } from './launcherStore.svelte';
  import { recents } from './recents.svelte';
  import { pickFolder } from './pick';
  import { buildLaunchPlan, type Placement } from './plan';
  import { workspace } from '../layout/workspace.svelte';

  // --- Local form state (the launcher store holds only open/close) ----------
  // The chosen folder (absolute path), '' until picked or chosen from recents.
  let folder = $state('');
  // The optional multi-line initial prompt.
  let prompt = $state('');
  // The chosen placement. Defaults to a new tab (always available).
  let placement = $state<Placement>('tab');
  // Whether the native picker is mid-flight (disables the Browse button).
  let browsing = $state(false);

  // The prompt textarea, focused when the modal opens.
  let promptEl = $state<HTMLTextAreaElement | null>(null);

  // A split placement is only possible when a pane is focused (a workspace with
  // at least one leaf). On a brand-new/empty workspace, split is disabled and the
  // launch falls back to a new tab (enforced again in buildLaunchPlan + the store).
  const canSplit = $derived(workspace.focusedPaneId !== null);

  // A launch needs a chosen folder. (A prompt is optional.)
  const canLaunch = $derived(folder.trim() !== '');

  // Load persisted recents once on mount; (re)opening the modal shows them.
  onMount(() => {
    void recents.load();
  });

  // When the modal opens (the open transition only), reset transient form state
  // and focus the prompt so the user can pick a recent + type immediately. Keep
  // the chosen folder cleared so a stale path from a previous (cancelled) open
  // never leaks into a new launch. The form writes are `untrack`ed so this effect
  // depends ONLY on `launcher.open` (it must not re-run when the user later edits
  // the form, which would wipe their input).
  $effect(() => {
    if (!launcher.open) return;
    untrack(() => {
      folder = '';
      prompt = '';
      // If no pane is focused, force a tab (split is disabled in that case).
      if (workspace.focusedPaneId === null) placement = 'tab';
    });
    void tick().then(() => promptEl?.focus());
  });

  async function browse() {
    if (browsing) return;
    browsing = true;
    try {
      // Seed the dialog at the current folder if one is chosen, else let it use
      // the OS default. Cancel -> null leaves the chosen folder unchanged.
      const picked = await pickFolder(folder.trim() || undefined);
      if (picked) folder = picked;
    } finally {
      browsing = false;
    }
  }

  function chooseRecent(path: string) {
    folder = path;
  }

  function cancel() {
    launcher.close();
  }

  async function confirm() {
    const cwd = folder.trim();
    if (!cwd) return; // no folder chosen -> abort (button is also disabled)

    // Build the NORMALIZED plan (pure): program is always claude, the prompt is
    // verbatim (never a synthesized /command), and a split with no focused pane
    // falls back to a new tab.
    const plan = buildLaunchPlan(
      { folder: cwd, prompt, placement },
      canSplit
    );

    // Hand the plan to the store: it creates the tab/split and records the new
    // pane's {program:'claude', cwd, initialInput} in the registry. Rendering the
    // new leaf spawns the PTY via TerminalPane (which applies the --settings
    // wrapper override + AGENT_DESKTOP_PANE env — reused, not duplicated here).
    workspace.launch(plan);

    // Record the launched folder as most-recent AFTER a successful launch (the
    // pure model dedupes + caps; persistence is best-effort and never blocks).
    void recents.add(plan.cwd);

    launcher.close();
  }

  // Keyboard: Esc cancels; Cmd/Ctrl-Enter confirms (so the prompt textarea keeps
  // plain Enter for newlines). Scoped to the modal so it doesn't fight the global
  // app shortcuts while open.
  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (canLaunch) void confirm();
    }
  }
</script>

{#if launcher.open}
  <!-- Backdrop: a click outside the dialog cancels. -->
  <div
    class="backdrop"
    role="presentation"
    onclick={cancel}
    onkeydown={onKeydown}
  >
    <!-- The dialog. stopPropagation on click so an inside click doesn't cancel. -->
    <div
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-label="New session"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={onKeydown}
    >
      <header class="head">
        <h2>New session</h2>
        <button class="x" aria-label="Close" onclick={cancel}>×</button>
      </header>

      <!-- Folder section: Browse + the chosen path + a one-click recents list. -->
      <section class="field">
        <div class="label-row">
          <span class="label">Folder</span>
          <button class="browse" onclick={browse} disabled={browsing}>
            {browsing ? 'Opening…' : 'Browse…'}
          </button>
        </div>
        <div class="chosen" class:empty={!folder.trim()} title={folder}>
          {folder.trim() || 'No folder chosen'}
        </div>

        {#if recents.list.length > 0}
          <div class="recents-label">Recent</div>
          <ul class="recents">
            {#each recents.list as path (path)}
              <li>
                <button
                  class="recent"
                  class:selected={folder.trim() === path}
                  title={path}
                  onclick={() => chooseRecent(path)}
                >
                  {path}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <!-- Optional initial prompt (multi-line). Plain Enter = newline. -->
      <section class="field">
        <label class="label" for="launcher-prompt">
          Initial prompt <span class="optional">(optional)</span>
        </label>
        <textarea
          id="launcher-prompt"
          class="prompt"
          rows="3"
          placeholder="What should this session start working on? (leave blank for an idle prompt)"
          bind:this={promptEl}
          bind:value={prompt}
        ></textarea>
      </section>

      <!-- Placement choice. Split options disabled when no pane is focused. -->
      <section class="field">
        <span class="label">Placement</span>
        <div class="placements">
          <label class="placement">
            <input type="radio" value="tab" bind:group={placement} />
            <span>New session (tab)</span>
          </label>
          <label class="placement" class:disabled={!canSplit}>
            <input
              type="radio"
              value="split-right"
              bind:group={placement}
              disabled={!canSplit}
            />
            <span>Split right</span>
          </label>
          <label class="placement" class:disabled={!canSplit}>
            <input
              type="radio"
              value="split-down"
              bind:group={placement}
              disabled={!canSplit}
            />
            <span>Split down</span>
          </label>
        </div>
      </section>

      <footer class="actions">
        <button class="cancel" onclick={cancel}>Cancel</button>
        <button class="launch" onclick={confirm} disabled={!canLaunch}>
          Launch session
        </button>
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
    padding-top: 12vh;
    background: rgba(1, 4, 9, 0.6);
    backdrop-filter: blur(2px);
  }

  .dialog {
    width: min(560px, calc(100vw - 32px));
    max-height: 76vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px 18px 14px;
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 12px;
    box-shadow: 0 18px 60px rgba(0, 0, 0, 0.55);
    color: #e6edf3;
    font-family:
      ui-sans-serif, -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
    outline: none;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .head h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }
  .x {
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: #8b949e;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
  }
  .x:hover {
    background: #21262d;
    color: #f0f6fc;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #8b949e;
  }
  .optional {
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
    color: #6e7681;
  }

  .browse {
    padding: 3px 10px;
    border: 1px solid #30363d;
    border-radius: 6px;
    background: #21262d;
    color: #c9d1d9;
    font-size: 12px;
    cursor: pointer;
  }
  .browse:hover:not(:disabled) {
    border-color: #58a6ff;
    color: #fff;
  }
  .browse:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .chosen {
    padding: 7px 9px;
    border: 1px solid #30363d;
    border-radius: 7px;
    background: #0d1117;
    font-family:
      ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 12px;
    color: #c9d1d9;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chosen.empty {
    color: #6e7681;
    font-style: italic;
  }

  .recents-label {
    margin-top: 2px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #6e7681;
  }
  .recents {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 132px;
    overflow-y: auto;
  }
  .recent {
    width: 100%;
    padding: 5px 8px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: #adbac7;
    font-family:
      ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .recent:hover {
    background: #1c2128;
    color: #e6edf3;
  }
  .recent.selected {
    border-color: #1f6feb;
    background: #182030;
    color: #e6edf3;
  }

  .prompt {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 9px;
    border: 1px solid #30363d;
    border-radius: 7px;
    background: #0d1117;
    color: #e6edf3;
    font-family:
      ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 12.5px;
    line-height: 1.45;
    resize: vertical;
    outline: none;
  }
  .prompt:focus {
    border-color: #58a6ff;
  }

  .placements {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .placement {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border: 1px solid #30363d;
    border-radius: 7px;
    background: #0d1117;
    font-size: 12.5px;
    color: #c9d1d9;
    cursor: pointer;
  }
  .placement:hover {
    border-color: #444c56;
  }
  .placement.disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 2px;
  }
  .cancel,
  .launch {
    padding: 7px 14px;
    border-radius: 7px;
    font-size: 12.5px;
    cursor: pointer;
  }
  .cancel {
    border: 1px solid #30363d;
    background: #21262d;
    color: #c9d1d9;
  }
  .cancel:hover {
    border-color: #444c56;
    color: #fff;
  }
  .launch {
    border: 1px solid #238636;
    background: #238636;
    color: #fff;
    font-weight: 600;
  }
  .launch:hover:not(:disabled) {
    background: #2ea043;
    border-color: #2ea043;
  }
  .launch:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
