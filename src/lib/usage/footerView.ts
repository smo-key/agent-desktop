// PURE view-model for the persistent AppFooter. Given the live pane_id ->
// snapshot map plus the focused pane id, its project id, and the projects list,
// it derives everything the footer renders: the focused pane's project, git, and
// context window usage, plus the account-wide 5h/7d rate-limit windows (reusing
// the tested `accountSummary`). Framework-free (no Svelte/Tauri imports), so it
// is unit-tested in footerView.test.ts; AppFooter is the thin reactive shell.

import { accountSummary, type RateWindow } from './rollup';
import type { GitStatus, SnapshotMap } from './snapshots.svelte';
import { projectForId, type Project } from '../projects/projects';

/** The footer's whole view-model. */
export interface FooterView {
  /** The focused pane's project (chip), or null when unassigned/unknown. */
  project: Project | null;
  /** The focused pane's git status, or null when unknown. */
  git: GitStatus | null;
  /** The focused pane's context window usage 0..100, or null when unknown. */
  context: number | null;
  /** Account-wide 5-hour rate-limit window. */
  fiveHour: RateWindow;
  /** Account-wide 7-day rate-limit window. */
  sevenDay: RateWindow;
}

/** Finite number in any range, else null (guards NaN/Infinity/strings). */
function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Build the footer view-model. `git`/`context` come from the focused pane's
 * snapshot (null when it has none); the rate-limit windows are account-global
 * (newest snapshot wins, via `accountSummary`); `project` is resolved from the
 * projects list by `projectId`. Pure: reads inputs, returns a fresh object.
 */
export function footerView(
  map: SnapshotMap,
  focusedPaneId: string | null,
  projectId: string | null,
  projects: ReadonlyArray<Project>
): FooterView {
  const focused = focusedPaneId ? map[focusedPaneId] : undefined;
  const git = focused ? (focused.git ?? null) : null;
  const context = focused ? finiteOrNull(focused.context_pct) : null;
  const account = accountSummary(map, git);
  return {
    project: projectForId(projects, projectId),
    git,
    context,
    fiveHour: account.fiveHour,
    sevenDay: account.sevenDay,
  };
}
