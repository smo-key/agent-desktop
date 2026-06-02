// PURE helper: the set of app-launched Claude session ids, derived from the
// per-pane snapshot map (Milestone 4, design D7). Each app-launched pane's
// snapshot carries the `session_id` Claude assigned it; the foreign-sessions
// subsystem excludes exactly these ids so the app never shows one of its own
// panes as an "external" session.
//
// Framework-free (no Svelte/Tauri imports) so it is trivially unit-tested. The
// route feeds the result to `foreign.seed(...)` (which pushes it to the Rust
// exclude-set) and to `foreign.setAppSessions(...)` (the cheap client guard).

import type { SnapshotMap } from './snapshots.svelte';

/**
 * The sorted, de-duplicated list of non-empty `session_id`s across all per-pane
 * snapshots. A pane with a null/empty `session_id` (no Claude session yet) is
 * skipped. Sorted for a stable, deterministic value so a re-seed effect only
 * fires when the actual set changes, not on map-reference churn.
 */
export function appSessionIds(map: SnapshotMap): string[] {
  const ids = new Set<string>();
  for (const snap of Object.values(map)) {
    const id = snap.session_id;
    if (typeof id === 'string' && id.length > 0) ids.add(id);
  }
  return [...ids].sort();
}
