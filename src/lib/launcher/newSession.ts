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

/**
 * Start a new agent session. Launches directly into the currently-filtered project
 * when one is selected (no popup); otherwise opens the launcher dialog.
 */
export function startNewSession(): void {
  const proj = projectForId(projects.list, projectFilter.selected);
  if (proj) {
    workspace.launch(
      buildLaunchPlan({ folder: proj.path, prompt: '', placement: 'tab', projectId: proj.id })
    );
  } else {
    launcher.show();
  }
}
