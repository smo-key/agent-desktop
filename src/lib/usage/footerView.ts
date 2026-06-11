// PURE view-model for the persistent AppFooter. Given the live pane_id ->
// snapshot map plus the focused pane id, its project id, and the projects list,
// it derives everything the footer renders: the focused pane's project, git, and
// context window usage, plus the account-wide 5h/7d rate-limit windows (reusing
// the tested `accountSummary`). Framework-free (no Svelte/Tauri imports), so it
// is unit-tested in footerView.test.ts; AppFooter is the thin reactive shell.

import { accountSummary, type RateWindow } from './rollup';
import type { GitStatus, SnapshotMap } from './snapshots.svelte';
import { projectForId, type Project } from '../projects/projects';
import { ALL, UNASSIGNED } from '../projects/projectRollup';

/** The footer's whole view-model. */
export interface FooterView {
  /** The focused pane's project (chip), or null when unassigned/unknown. */
  project: Project | null;
  /** The focused pane's git status, or null when unknown. */
  git: GitStatus | null;
  /** The focused pane's context window usage 0..100, or null when unknown. */
  context: number | null;
  /** The focused pane's total session cost in USD, or null when unknown. */
  cost: number | null;
  /** The focused pane's last-snapshot time (unix SECONDS), or null when none. */
  lastTs: number | null;
  /** The focused pane's model display name (e.g. "Claude Opus 4.8"), or null. */
  model: string | null;
  /** The focused pane's model id (e.g. "claude-opus-4-8"), or null. */
  model_id: string | null;
  /** The focused pane's reasoning effort level (e.g. "high"), or null. */
  effort: string | null;
  /** Account-wide 5-hour rate-limit window. */
  fiveHour: RateWindow;
  /** Account-wide 7-day rate-limit window. */
  sevenDay: RateWindow;
}

/**
 * The id of the project whose FOLDER git the footer's left zone shows: the focused
 * pane's project when it has one, else the project-panel's current selection when
 * that is a concrete project (not the ALL / UNASSIGNED buckets). Null when neither
 * yields a concrete project — the footer then shows no project git. This keeps the
 * git meaningful in overview (no focused pane) by tracking the selected project.
 * Pure + unit-tested.
 */
export function footerGitProjectId(
  focusedProjectId: string | null,
  panelSelection: string
): string | null {
  if (focusedProjectId) return focusedProjectId;
  if (panelSelection === ALL || panelSelection === UNASSIGNED) return null;
  return panelSelection || null;
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
  const cost = focused ? finiteOrNull(focused.cost) : null;
  const lastTs = focused ? finiteOrNull(focused.ts) : null;
  const model = focused ? (focused.model ?? null) : null;
  const model_id = focused ? (focused.model_id ?? null) : null;
  const effort = focused ? (focused.effort ?? null) : null;
  const account = accountSummary(map, git);
  return {
    project: projectForId(projects, projectId),
    git,
    context,
    cost,
    lastTs,
    model,
    model_id,
    effort,
    fiveHour: account.fiveHour,
    sevenDay: account.sevenDay,
  };
}
