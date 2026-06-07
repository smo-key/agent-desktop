// PURE resolver for the Terminals panel's "active project" — the project whose
// terminal collection the panel displays. Per the design, this FOLLOWS the focused
// agent: it is the project bound to the currently-focused pane in the active
// workspace. No Svelte/Tauri imports, so it is unit-tested under node Vitest; the
// reactive glue (reading the live workspace store) lives in the panel component.

import { projectForId, type Project } from '../projects/projects';

/** The focus context the resolver reads, decoupled from the workspace store. */
export interface FocusContext {
  /** The active workspace's focused pane id, or '' when there is no active pane. */
  focusedId: string;
  /** The `projectId` bound to a pane at launch (undefined when unbound/unknown). */
  projectIdOf: (paneId: string) => string | undefined;
  /**
   * A concrete project EXPLICITLY selected in the overview's project filter, or
   * null when the filter is on "All"/"Unassigned" (no concrete project). When set,
   * it takes precedence so the panel respects the user's chosen project even with
   * no agent focused.
   */
  selectedProjectId?: string | null;
}

/**
 * The active project id for the panel. An explicit project selection in the
 * overview's project filter wins (so the panel respects the selected project even
 * when no agent is focused); otherwise it follows the focused pane's `projectId`.
 * Null — nothing selected and nothing focused (the panel's empty state).
 */
export function activeProjectId(ctx: FocusContext): string | null {
  if (ctx.selectedProjectId) return ctx.selectedProjectId;
  if (!ctx.focusedId) return null;
  return ctx.projectIdOf(ctx.focusedId) ?? null;
}

/** The resolved active `Project` (or null), looked up in `list`. */
export function activeProject(
  list: ReadonlyArray<Project>,
  ctx: FocusContext
): Project | null {
  return projectForId(list, activeProjectId(ctx));
}
