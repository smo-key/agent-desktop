// PURE helper: the set of app-pane SESSION REFS ({sessionId, cwd}) the subagents
// store seeds the Rust `subagents_for` command with (Stage 3 of agent-overview).
// Each app pane's snapshot carries the Claude `session_id`; the Rust side also
// needs the session's cwd to locate its project dir
// (`~/.claude/projects/<encoded-cwd>/<session_id>/`). The cwd is NOT in the
// snapshot — it lives in the workspace registry, keyed by `pane_id` — so this
// helper joins the two by pane id.
//
// Framework-free (no Svelte/Tauri imports): it takes the snapshot map plus a
// `paneId -> cwd` lookup (the route passes `workspace.session(paneId).cwd`), so it
// is trivially unit-tested. The result is sorted + de-duped by session id so a
// re-seed effect only fires on a real change, not on map-reference churn.

import type { SnapshotMap } from '../usage/snapshots.svelte';
import type { SessionRef } from './subagents.svelte';

/** A pane-id -> cwd lookup (the workspace registry, projected). */
export type CwdLookup = (paneId: string) => string | null;

/**
 * The sorted, de-duplicated app-pane session refs across all per-pane snapshots:
 * one `{sessionId, cwd}` per distinct non-empty `session_id`, with the cwd looked
 * up from the pane that reported it. A pane whose snapshot has no/empty
 * `session_id` is skipped (no Claude session yet). When two panes share a session
 * id (resume/fork), the FIRST encountered (by sorted pane id) wins the cwd — they
 * resolve to the same project dir anyway. Sorted by session id for a stable value.
 *
 * @param map     the live pane_id -> snapshot map
 * @param cwdFor  pane id -> cwd lookup (the workspace registry)
 */
export function appSessionRefs(map: SnapshotMap, cwdFor: CwdLookup): SessionRef[] {
  const bySession = new Map<string, string | null>();
  // Iterate pane ids in a stable (sorted) order so the "first wins" cwd choice
  // is deterministic regardless of map insertion order.
  for (const paneId of Object.keys(map).sort()) {
    const snap = map[paneId];
    const sessionId = snap?.session_id;
    if (typeof sessionId !== 'string' || sessionId.length === 0) continue;
    if (!bySession.has(sessionId)) bySession.set(sessionId, cwdFor(paneId));
  }
  return [...bySession.entries()]
    .map(([sessionId, cwd]) => ({ sessionId, cwd }))
    .sort((a, b) => a.sessionId.localeCompare(b.sessionId));
}
