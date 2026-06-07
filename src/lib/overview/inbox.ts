// src/lib/overview/inbox.ts
// PURE selection cores for the inbox overview (design 2026-06-04). The focus pane
// shows ONE agent: the user's explicit selection if any, else the first agent that
// needs attention, else none ("All clear"). Addressing the focused attention agent
// (it transitions out of the attention status) advances the focus to the next in
// the queue. Framework-free so it is trivially unit-tested; Inbox.svelte is the
// thin reactive shell that feeds it the live roster and renders the result.

import { needsAttention, type AgentRow, type AgentStatus } from './roster';

/** Whether a status means the agent is waiting on YOU (waiting or errored). This is
 *  the STATUS-only check (used for badge/label styling); the attention QUEUE uses
 *  the row-level `needsAttention` so paused/archived agents are excluded. */
export function isAttention(status: AgentStatus): boolean {
  return status === 'waiting' || status === 'error';
}

/**
 * The attention queue: every agent that needs you, in roster order — waiting/errored
 * AND not paused/archived (`needsAttention`). These are the rows the focus pane
 * auto-fills from (top first) and drains as each is addressed.
 */
export function attentionQueue(rows: AgentRow[]): AgentRow[] {
  return rows.filter((r) => needsAttention(r));
}

/**
 * The focused agent for the right pane:
 *   1. the user's explicit selection, if that pane still exists in the roster;
 *   2. else the first agent in the attention queue;
 *   3. else null ("All clear").
 */
export function resolveFocus(rows: AgentRow[], userSelected: string | null): AgentRow | null {
  if (userSelected) {
    const picked = rows.find((r) => r.paneId === userSelected);
    if (picked) return picked;
  }
  return attentionQueue(rows)[0] ?? null;
}

/**
 * Step through the attention queue from `currentPaneId` by `dir` (+1 / -1),
 * wrapping around. Returns the next attention pane id, or null when the queue is
 * empty. Used by the focus header's ↑/↓ queue-nav.
 */
export function nextInQueue(
  rows: AgentRow[],
  currentPaneId: string | null,
  dir: 1 | -1
): string | null {
  const q = attentionQueue(rows);
  if (q.length === 0) return null;
  const i = q.findIndex((r) => r.paneId === currentPaneId);
  const base = i < 0 ? 0 : i;
  const next = (base + dir + q.length) % q.length;
  return q[next].paneId;
}

/**
 * Whether to drop the user's pin on the focused agent: it WAS pinned, it used to
 * need attention, and it no longer does (you addressed it). Dropping the pin lets
 * `resolveFocus` advance to the next agent in the queue — "addressing one moves to
 * the next". A non-pinned agent, or one still needing attention, keeps its state.
 */
export function shouldClearPin(
  prev: AgentStatus,
  next: AgentStatus,
  isPinned: boolean
): boolean {
  return isPinned && isAttention(prev) && !isAttention(next);
}

/**
 * PURE: archiving a session with NO user messages is pointless (there's nothing to
 * resume), so it is deleted outright; a session with messages is archived (kept,
 * restorable). `userHash` is the transcript's user-message hash — falsy (null /
 * undefined / empty) means zero user messages.
 */
export function archiveDecision(userHash: string | null | undefined): 'delete' | 'archive' {
  return userHash ? 'archive' : 'delete';
}

/**
 * PURE: what the auto-archive effect should do for a row that just settled. Only a
 * LIVE session that finished cleanly is acted on — already closed/paused/previewing
 * rows are left alone (`'none'`) so the effect fires once. A finished session with
 * NO user messages (e.g. the user only typed `/exit`, which doesn't count) has
 * nothing to resume, so it is DELETED rather than archived; otherwise it is archived
 * (kept, restorable). Mirrors the manual `archiveAgent` decision via `archiveDecision`.
 */
export function autoArchiveAction(
  row: Pick<AgentRow, 'closed' | 'paused' | 'preview' | 'status'>,
  userHash: string | null | undefined
): 'delete' | 'archive' | 'none' {
  if (row.closed || row.paused || row.preview || row.status !== 'finished') return 'none';
  return archiveDecision(userHash);
}

/**
 * PURE: whether a paused agent should auto-resume — true once the LIVE user-message
 * hash is present and differs from the hash captured when it was paused (the user
 * sent a new message). A missing/empty live hash never resumes, so a transient poll
 * gap can't un-pause an agent.
 */
export function shouldAutoResume(
  pausedHash: string | null | undefined,
  liveHash: string | null | undefined
): boolean {
  if (!liveHash) return false;
  return liveHash !== (pausedHash ?? null);
}
