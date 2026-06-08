// The single "start a new session" entry point, shared by every trigger (the
// inbox "+" button, the Cmd-N global shortcut, and any future caller) so they all
// behave identically:
//   - When a concrete PROJECT is selected in the project filter, launch straight
//     into it (a new tab in its folder) with NO dialog — you stay in flow.
//   - Otherwise (the filter is All / Unassigned, i.e. no single project), open the
//     launcher so you can pick or create a project first. The launcher auto-focuses
//     its project dropdown on open.
//
// Plain module (no component) so both the keyboard handler in +page and the inbox
// can call it; it only touches the runes singletons + the pure launch-plan builder.

import { projects } from '../projects/projects.svelte';
import { projectForId } from '../projects/projects';
import { projectFilter } from '../projects/projectFilter.svelte';
import { workspace } from '../layout/workspace.svelte';
import { buildLaunchPlan } from './plan';
import { launcher } from './launcherStore.svelte';
import { createWorktree } from './worktree';
import { loadAutoWorktree } from '../projects/projectFolderConfig';
import { toast } from '../ui/toastStore.svelte';

/** Warning shown when a worktree was requested but couldn't be created. */
const WORKTREE_FALLBACK_MSG =
  "Couldn't create a worktree — launched in the project folder instead.";

/**
 * Start a new agent session. Launches directly into the currently-filtered project
 * when one is selected (no popup); otherwise opens the launcher dialog.
 *
 * Async because a project with `autoWorktree` first creates a git worktree (via
 * the Rust `worktree_create` command) and launches the session there. On failure
 * it falls back to the project's own folder with a non-blocking warning toast.
 * Most callers fire-and-forget (the returned promise resolves once the launch is
 * recorded).
 */
export async function startNewSession(): Promise<void> {
  const proj = projectForId(projects.list, projectFilter.selected);
  if (!proj) {
    launcher.show();
    return;
  }

  // Default: launch in the project's own folder, with no worktree association.
  let folder = proj.path;
  let worktreePath: string | undefined;
  let worktreeBase: string | undefined;

  if (await loadAutoWorktree(proj.path)) {
    const wt = await createWorktree(proj.path);
    if (wt) {
      folder = wt.path;
      worktreePath = wt.path;
      worktreeBase = wt.base;
    } else {
      // Non-blocking: warn, then fall back to the project folder.
      toast.show(WORKTREE_FALLBACK_MSG);
    }
  }

  workspace.launch(
    buildLaunchPlan({
      folder,
      prompt: '',
      placement: 'tab',
      projectId: proj.id,
      worktreePath,
      worktreeBase
    })
  );
}
