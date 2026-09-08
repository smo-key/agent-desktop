// The "start a new session" entry points, shared by every trigger (the inbox "+"
// button, the Cmd-N global shortcut, the new-worktree-session shortcut, and any
// future caller) so they all behave identically:
//   - When a concrete PROJECT is selected in the project filter, launch straight
//     into it (a new tab in its folder) with NO dialog — you stay in flow.
//   - Otherwise (the filter is All / Unassigned, i.e. no single project), open the
//     launcher so you can pick or create a project first. The launcher auto-focuses
//     its project dropdown on open.
//   - `startNewWorktreeSession` ALWAYS opens the launcher — with the worktree
//     option preset and the filtered project preselected — because the worktree
//     name is optional but must be enterable before launch.
//
// Plain module (no component) so both the keyboard handler in +page and the inbox
// can call it; it only touches the runes singletons + the pure launch-plan builder.

import { projects } from '../projects/projects.svelte';
import { projectForId } from '../projects/projects';
import { projectFilter } from '../projects/projectFilter.svelte';
import { workspace } from '../layout/workspace.svelte';
import { buildLaunchPlan } from './plan';
import { launcher } from './launcherStore.svelte';

/**
 * Start a new agent session. Launches directly into the currently-filtered project
 * when one is selected (no popup); otherwise opens the launcher dialog.
 *
 * The session always runs in the project's own folder. An ARCHIVED project is never
 * launched into directly (it is hidden from the launcher's picker too), so a filter
 * that points at one falls through to the dialog.
 */
export function startNewSession(): void {
  const proj = projectForId(projects.active, projectFilter.selected);
  if (!proj) {
    launcher.show();
    return;
  }

  workspace.launch(
    buildLaunchPlan({
      folder: proj.path,
      prompt: '',
      placement: 'tab',
      projectId: proj.id
    })
  );
}

/**
 * Start a new agent session in a NEW git worktree (session-launcher: Launch A
 * Session In A New Git Worktree). Always opens the launcher with the worktree
 * option checked (so an optional name can be typed), preselecting the currently
 * filtered project when there is one.
 */
export function startNewWorktreeSession(): void {
  const proj = projectForId(projects.active, projectFilter.selected);
  launcher.show({ worktree: true, projectId: proj?.id ?? null });
}
