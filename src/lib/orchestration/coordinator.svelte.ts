// Runtime wiring for the per-project COORDINATOR (add-agent-specialists, tasks
// 6.2–6.3). Thin glue over the PURE helpers in `coordinator.ts` + the existing
// spawn path — it touches only the runes singletons + Tauri, so the load-bearing
// logic (reuse lookup, args composition) stays in the unit-tested pure module.
//
// `startCoordinator(project)`:
//   1. SINGLE-COORDINATOR GATE (6.3): if a live coordinator pane already exists for
//      the project, FOCUS it and return — never launch a second.
//   2. Otherwise resolve the installed adapter + control-socket paths (the same
//      memoized `usage_paths` round-trip every claude pane uses), build the toolkit
//      mcp-config scoped to THIS project, compose the coordinator launch args
//      (`--append-system-prompt` + `--mcp-config`), and launch a `claude` pane via
//      the shared `workspace.launch` path with `role:'coordinator'`.
//   3. Persist the project's `coordinatorPaneId` back-reference.

import { workspace } from '../layout/workspace.svelte';
import { leavesInOrder } from '../layout/tree';
import { buildLaunchPlan } from '../launcher/plan';
import { getUsagePaths } from '../usage/paths';
import { buildMcpToolkitConfig } from '../usage/spawn';
import { projects } from '../projects/projects.svelte';
import type { Project } from '../projects/projects';
import { toast } from '../ui/toastStore.svelte';
import {
  coordinatorLaunchArgs,
  findCoordinatorPane,
  type CoordinatorPaneView
} from './coordinator';

/** Shown when the orchestration adapter paths can't be resolved (no toolkit). */
const NO_TOOLKIT_MSG =
  "Couldn't start the coordinator — the orchestration toolkit is unavailable.";

/**
 * Flatten every pane across all workspaces into the framework-free view the reuse
 * lookup needs. Reads the live workspaces/registries (so a caller's effect re-runs
 * on change) but returns plain data.
 */
function allCoordinatorPanes(): CoordinatorPaneView[] {
  const out: CoordinatorPaneView[] = [];
  for (const entry of workspace.workspaces) {
    for (const leaf of leavesInOrder(entry.ws.root)) {
      const s = entry.registry[leaf.paneId];
      if (!s) continue;
      out.push({
        paneId: leaf.paneId,
        program: s.program,
        projectId: s.projectId ?? null,
        role: s.role,
        closed: s.closed
      });
    }
  }
  return out;
}

/**
 * The LIVE coordinator pane for `projectId`, or null. Exposed so the UI can render
 * a "Focus coordinator" vs "Start coordinator" affordance (task 6.3).
 */
export function liveCoordinator(projectId: string): CoordinatorPaneView | null {
  return findCoordinatorPane(allCoordinatorPanes(), projectId);
}

/**
 * Start (or focus) the project's coordinator. Returns the coordinator's paneId, or
 * null when the launch couldn't proceed (no toolkit paths). Fire-and-forget for most
 * callers; the promise resolves once the launch is recorded.
 */
export async function startCoordinator(project: Project): Promise<string | null> {
  // 1. Single-coordinator gate: reuse + focus an existing live coordinator.
  const existing = liveCoordinator(project.id);
  if (existing) {
    workspace.focusPane(existing.paneId);
    return existing.paneId;
  }

  // 2. Resolve the installed adapter + control socket (same memoized round-trip as
  //    every claude pane). Without them the toolkit can't attach — bail with a toast.
  const paths = await getUsagePaths();
  if (!paths) {
    toast.show(NO_TOOLKIT_MSG);
    return null;
  }

  // The toolkit config is SCOPED to this project: its projectId rides in the server
  // env so the adapter stamps it into every forwarded tool call's args (the executor
  // rejects ops without it).
  const mcpConfig = buildMcpToolkitConfig(
    paths.adapterPath,
    paths.controlSocketPath,
    project.id
  );
  const extraArgs = coordinatorLaunchArgs(mcpConfig);

  // 3. Launch through the shared spawn path with the coordinator role marker. The
  //    coordinator runs in the project's own folder (it orchestrates; it isn't the
  //    one editing files in a worktree).
  const paneId = workspace.launch({
    ...buildLaunchPlan({ folder: project.path, prompt: '', placement: 'tab', projectId: project.id }),
    extraArgs,
    role: 'coordinator'
  });

  // Persist the back-reference so the affordance can re-identify the coordinator.
  if (paneId) void projects.update(project.id, { coordinatorPaneId: paneId });
  return paneId || null;
}
