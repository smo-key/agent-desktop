<script lang="ts">
  // The session-launcher MODAL (session-launcher spec). Opened from three entry
  // points via the shared `launcher` store (SessionRail "+ new session" row, the
  // pane context-menu "New Session" item, and the Cmd-N shortcut). It lets the
  // user:
  //   1. choose/create a project — its folder is the launch cwd.
  // A session always opens as a new tab. On confirm it builds a PURE launch plan
  // (plan.ts, with an empty initial prompt — the agent starts at an idle prompt),
  // hands it to
  // `workspace.launch(plan)` (which records {program:'claude', cwd, initialInput}
  // in the registry — the existing TerminalPane spawn path then applies the
  // --settings wrapper override + AGENT_DESKTOP_PANE env; we do NOT duplicate
  // that), records the folder as most-recent, and closes. Cancelling (Esc /
  // backdrop / Cancel) aborts: no session, no PTY, recents unchanged.

  import { onMount, untrack } from 'svelte';
  import { launcher } from './launcherStore.svelte';
  import { buildLaunchPlan } from './plan';
  import { workspace } from '../layout/workspace.svelte';
  import { projects } from '../projects/projects.svelte';
  import { projectForId } from '../projects/projects';
  import { createWorktree } from './worktree';
  import { loadAutoWorktree } from '../projects/projectFolderConfig';
  import { toast } from '../ui/toastStore.svelte';
  import ProjectSelect from '../projects/ProjectSelect.svelte';

  // Warning shown when a worktree was requested but couldn't be created.
  const WORKTREE_FALLBACK_MSG =
    "Couldn't create a worktree — launched in the project folder instead.";

  // --- Local form state (the launcher store holds only open/close) ----------
  // The chosen project id (supplies the launch folder), null until picked/created.
  let selectedProjectId = $state<string | null>(null);

  // The resolved project (its folder is where the agent launches).
  const project = $derived(projectForId(projects.list, selectedProjectId));

  // A launch needs a chosen project (which supplies the folder).
  const canLaunch = $derived(project !== null);

  // Load persisted projects once on mount; (re)opening the modal shows them.
  onMount(() => {
    void projects.load();
  });

  // When the modal opens (the open transition only), reset the transient project
  // choice. The write is `untrack`ed so this effect depends ONLY on `launcher.open`
  // (it must not re-run when the user picks a project).
  $effect(() => {
    if (!launcher.open) return;
    untrack(() => {
      selectedProjectId = null;
    });
  });

  function cancel() {
    launcher.close();
  }

  async function confirm() {
    if (!project) return; // no project chosen -> abort (button is also disabled)

    // When the project has autoWorktree, create a git worktree FIRST and launch the
    // session there; on failure, fall back to the project folder with a non-blocking
    // warning. Resolved BEFORE buildLaunchPlan so the plan builder stays pure.
    let folder = project.path;
    let worktreePath: string | undefined;
    let worktreeBase: string | undefined;
    if (await loadAutoWorktree(project.path)) {
      const wt = await createWorktree(project.path);
      if (wt) {
        folder = wt.path;
        worktreePath = wt.path;
        worktreeBase = wt.base;
      } else {
        toast.show(WORKTREE_FALLBACK_MSG);
      }
    }

    // Build the NORMALIZED plan (pure): program is always claude, the prompt is
    // verbatim (never a synthesized /command), the cwd is the chosen folder (the
    // worktree when created, else the project's folder), and the projectId binds the
    // agent to its project. A session always opens as a new session (tab) — there is
    // no split-placement choice in the launcher.
    const plan = buildLaunchPlan({
      folder,
      prompt: '',
      placement: 'tab',
      projectId: project.id,
      worktreePath,
      worktreeBase
    });

    // Hand the plan to the store: it creates the tab/split and records the new
    // pane's {program:'claude', cwd, initialInput, projectId} in the registry.
    // Rendering the new leaf spawns the PTY via TerminalPane.
    workspace.launch(plan);

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

      <!-- Project section: pick an existing project (its folder is the launch
           cwd) or create one (name + folder + icon). -->
      <section class="field">
        <span class="label">Project</span>
        <ProjectSelect
          autofocus
          value={selectedProjectId}
          onChange={(id) => (selectedProjectId = id)}
        />
      </section>

      <footer class="actions">
        <button class="cancel" onclick={cancel}>Cancel</button>
        <button class="launch" onclick={confirm} disabled={!canLaunch}>
          New session
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
    padding-top: 10vh;
    background: rgba(4, 6, 10, 0.66);
    backdrop-filter: blur(3px);
  }

  .dialog {
    width: min(580px, calc(100vw - 32px));
    /* `visible` so the project dropdown can extend past the (short) dialog without
       being clipped. The dialog content is small — there's nothing to scroll. */
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
    background: var(--line-faint);
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
