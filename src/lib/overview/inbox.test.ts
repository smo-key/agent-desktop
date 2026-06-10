// src/lib/overview/inbox.test.ts
import { describe, expect, it } from 'vitest';
import type { AgentRow, AgentStatus } from './roster';
import {
  isAttention,
  attentionQueue,
  resolveFocus,
  nextInQueue,
  shouldClearPin,
  archiveDecision,
  autoArchiveAction,
  shouldAutoResume,
  deleteAllArchivedRequest,
  rowSub,
  clipLine,
  ROW_SUB_MAX_LEN
} from './inbox';
import type { PendingQuestion } from './roster';

// Minimal AgentRow factory — only the fields the inbox cores read.
function row(paneId: string, status: AgentStatus, over: Partial<AgentRow> = {}): AgentRow {
  return {
    paneId,
    workspaceId: 'w-' + paneId,
    name: paneId,
    cwd: null,
    model: null,
    task: null,
    summary: null,
    question: null,
    questions: null,
    currentAction: null,
    contextPct: null,
    cost: null,
    lastTs: null,
    status,
    projectId: null,
    ...over
  };
}

describe('autoArchiveAction', () => {
  it('only acts on a freshly finished, live session', () => {
    // Not finished yet -> leave it alone.
    expect(autoArchiveAction(row('a', 'working'), 'h')).toBe('none');
    expect(autoArchiveAction(row('a', 'waiting'), 'h')).toBe('none');
    // Already closed / paused / previewing -> the effect must not fire again.
    expect(autoArchiveAction(row('a', 'finished', { closed: true }), 'h')).toBe('none');
    expect(autoArchiveAction(row('a', 'finished', { paused: true }), 'h')).toBe('none');
    expect(autoArchiveAction(row('a', 'finished', { preview: true }), 'h')).toBe('none');
  });

  it('deletes a finished session with no user messages (e.g. the user only typed /exit)', () => {
    // userHash is empty because /exit no longer counts as a user message.
    expect(autoArchiveAction(row('a', 'finished'), null)).toBe('delete');
    expect(autoArchiveAction(row('a', 'finished'), undefined)).toBe('delete');
    expect(autoArchiveAction(row('a', 'finished'), '')).toBe('delete');
  });

  it('archives a finished session that has real user messages', () => {
    expect(autoArchiveAction(row('a', 'finished'), 'abc123')).toBe('archive');
  });
});

describe('isAttention', () => {
  it('treats waiting and error as needing attention', () => {
    expect(isAttention('waiting')).toBe(true);
    expect(isAttention('error')).toBe(true);
    expect(isAttention('working')).toBe(false);
    expect(isAttention('finished')).toBe(false);
    expect(isAttention('idle')).toBe(false);
  });
});

describe('Attention queue surfaces waiting and errored agents', () => {
  it('keeps roster order and includes only waiting/error rows', () => {
    const rows = [
      row('a', 'working'),
      row('b', 'waiting'),
      row('c', 'finished'),
      row('d', 'error')
    ];
    expect(attentionQueue(rows).map((r) => r.paneId)).toEqual(['b', 'd']);
  });

  it('excludes paused and archived agents even when waiting/errored', () => {
    const rows = [
      row('a', 'waiting'),
      row('b', 'waiting', { paused: true }),
      row('c', 'error', { closed: true }),
      row('d', 'error')
    ];
    expect(attentionQueue(rows).map((r) => r.paneId)).toEqual(['a', 'd']);
  });

  it('a paused agent is not the auto-focus target, nor in queue nav', () => {
    const rows = [row('a', 'waiting', { paused: true }), row('b', 'working')];
    // No un-paused attention agent => focus falls through to null (All clear).
    expect(resolveFocus(rows, null)).toBeNull();
    expect(nextInQueue(rows, null, 1)).toBeNull();
  });
});

describe('Focus resolves to the user selection before the queue', () => {
  it('returns the user-selected row when it still exists', () => {
    const rows = [row('a', 'waiting'), row('b', 'working')];
    expect(resolveFocus(rows, 'b')?.paneId).toBe('b');
  });
});

describe('Focus falls back to the attention queue when nothing is selected', () => {
  it('returns the first attention row when there is no selection', () => {
    const rows = [row('a', 'working'), row('b', 'waiting'), row('c', 'error')];
    expect(resolveFocus(rows, null)?.paneId).toBe('b');
  });

  it('falls back to the queue when the selected pane is gone', () => {
    const rows = [row('a', 'waiting')];
    expect(resolveFocus(rows, 'missing')?.paneId).toBe('a');
  });
});

describe('Focus is empty when nothing needs attention and nothing is selected', () => {
  it('returns null', () => {
    const rows = [row('a', 'working'), row('b', 'finished')];
    expect(resolveFocus(rows, null)).toBe(null);
  });
});

describe('Queue navigation steps through waiting agents', () => {
  it('advances to the next attention row and wraps', () => {
    const rows = [row('a', 'waiting'), row('b', 'error'), row('c', 'waiting')];
    expect(nextInQueue(rows, 'a', 1)).toBe('b');
    expect(nextInQueue(rows, 'c', 1)).toBe('a');
    expect(nextInQueue(rows, 'b', -1)).toBe('a');
  });

  it('returns null when the queue is empty', () => {
    expect(nextInQueue([row('a', 'working')], 'a', 1)).toBe(null);
  });
});

describe('Addressed attention agent advances the focus to the next', () => {
  it('clears the pin when the pinned agent leaves attention', () => {
    // pinned 'a' transitions waiting -> working: pin should clear so the queue takes over
    expect(shouldClearPin('waiting', 'working', true)).toBe(true);
  });

  it('keeps the pin while the agent still needs attention', () => {
    expect(shouldClearPin('waiting', 'waiting', true)).toBe(false);
    expect(shouldClearPin('error', 'waiting', true)).toBe(false);
  });

  it('does nothing when the agent was not pinned', () => {
    expect(shouldClearPin('waiting', 'working', false)).toBe(false);
  });
});

describe('Delete all archived agents', () => {
  const archived = (id: string) => row(id, 'finished', { closed: true });
  // A test harness capturing deletions + a mutable selection, mirroring the live deps.
  function harness(selected: string | null = null) {
    const deleted: string[] = [];
    let sel = selected;
    const deps = {
      deleteAgent: (id: string) => deleted.push(id),
      getSelected: () => sel,
      setSelected: (v: string | null) => (sel = v)
    };
    return { deleted, deps, sel: () => sel };
  }

  it('Deleting all archived agents after confirming', () => {
    const rows = [row('live', 'working'), archived('a1'), archived('a2')];
    const h = harness('a1'); // the current selection points at an archived pane
    const req = deleteAllArchivedRequest(rows, h.deps);
    expect(req).not.toBeNull();
    expect(req!.message).toContain('2 archived agents');
    // Nothing is deleted until the user actually confirms (runs onConfirm).
    expect(h.deleted).toEqual([]);
    req!.onConfirm();
    expect(h.deleted).toEqual(['a1', 'a2']); // every archived agent removed
    expect(h.sel()).toBeNull(); // selection cleared — it pointed at a deleted pane
  });

  it('Cancelling the confirmation keeps the archived agents', () => {
    const rows = [archived('a1'), archived('a2'), row('live', 'working')];
    const h = harness();
    // The request is built to show the dialog, but cancelling never invokes onConfirm.
    const req = deleteAllArchivedRequest(rows, h.deps);
    expect(req).not.toBeNull();
    expect(h.deleted).toEqual([]); // nothing removed without confirming
  });

  it('The action targets only archived agents', () => {
    const rows = [
      row('live', 'working'),
      row('attn', 'waiting'),
      row('paused', 'working', { paused: true }),
      archived('a1'),
      row('preview', 'working', { preview: true }) // previewing-archived counts too
    ];
    const h = harness();
    deleteAllArchivedRequest(rows, h.deps)!.onConfirm();
    expect(h.deleted).toEqual(['a1', 'preview']); // only the Archived (done) lane
  });

  it('The action is hidden when nothing is archived', () => {
    const rows = [
      row('live', 'working'),
      row('attn', 'waiting'),
      row('paused', 'working', { paused: true })
    ];
    // No archived agents → no request to show (the caller hides the action).
    expect(deleteAllArchivedRequest(rows, harness().deps)).toBeNull();
  });
});

describe('Archiving an empty session deletes it instead', () => {
  it('deletes when the session has no user messages (no hash)', () => {
    expect(archiveDecision(null)).toBe('delete');
    expect(archiveDecision(undefined)).toBe('delete');
    expect(archiveDecision('')).toBe('delete');
  });

  it('archives when the session has user messages', () => {
    expect(archiveDecision('abc123')).toBe('archive');
  });
});

describe('A new message resumes a paused session', () => {
  it('resumes only when the live user-message COUNT strictly exceeds the paused-at count', () => {
    expect(shouldAutoResume(1, 2)).toBe(true);
    // Paused at 2 messages, two more arrive.
    expect(shouldAutoResume(2, 4)).toBe(true);
  });

  it('stays paused while no new message has arrived', () => {
    expect(shouldAutoResume(1, 1)).toBe(false);
    // A LOWER live count (e.g. the windowed read momentarily under-counts) never
    // resumes — only a strict increase does.
    expect(shouldAutoResume(2, 1)).toBe(false);
    // A transient missing live count must NOT resume (avoids a poll gap un-pausing).
    expect(shouldAutoResume(1, null)).toBe(false);
    expect(shouldAutoResume(1, undefined)).toBe(false);
    // An unestablished baseline never resumes — the inbox establishes it lazily from
    // the first known reading rather than treating unknown as 0.
    expect(shouldAutoResume(null, 3)).toBe(false);
    expect(shouldAutoResume(undefined, 3)).toBe(false);
  });
});

// A previewing (resumed-from-Archived) session unarchives on the SAME count-increase
// signal a paused session resumes on: the inbox captures the user-message COUNT when
// preview begins (`previewCount`) and unarchives (commitPreview) once the live count
// strictly exceeds it — i.e. the user sent a new message. The count (whole-file) is
// used, NOT the windowed hash, so resuming the session for preview (which grows its
// transcript) can never masquerade as a reply. Until a real new message it stays
// previewing.
describe('Sending a message unarchives a previewing session', () => {
  it('unarchives once the live count exceeds the preview baseline', () => {
    // Baseline captured at preview start; a new message lifts the live count.
    expect(shouldAutoResume(3, 4)).toBe(true);
  });

  it('stays previewing while no new message has arrived', () => {
    expect(shouldAutoResume(3, 3)).toBe(false);
    // Assistant output growing the resumed transcript does NOT change the count, so a
    // steady count keeps it previewing — this is the bug fix.
    expect(shouldAutoResume(3, 3)).toBe(false);
    // A transient missing live count must NOT unarchive (poll-gap safe).
    expect(shouldAutoResume(3, null)).toBe(false);
    expect(shouldAutoResume(3, undefined)).toBe(false);
    // An unestablished baseline never unarchives (lazily established instead).
    expect(shouldAutoResume(null, 3)).toBe(false);
  });
});

// clipLine collapses a (possibly multi-line) message to a single line and trims it
// to a sensible length for the one-line roster sub-line + its tooltip.
describe('clipLine', () => {
  it('returns the text unchanged when short and single-line', () => {
    expect(clipLine('All done')).toBe('All done');
  });

  it('collapses internal newlines/whitespace to single spaces', () => {
    expect(clipLine('line one\nline two\t  three')).toBe('line one line two three');
  });

  it('trims leading/trailing whitespace', () => {
    expect(clipLine('  hello  ')).toBe('hello');
  });

  it('clips an over-long message to the max length with an ellipsis', () => {
    const long = 'x'.repeat(ROW_SUB_MAX_LEN + 50);
    const out = clipLine(long);
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(ROW_SUB_MAX_LEN + 1); // + the ellipsis char
    expect(out!.endsWith('…')).toBe(true);
  });

  it('returns null for empty/whitespace-only/null input', () => {
    expect(clipLine('   ')).toBeNull();
    expect(clipLine('')).toBeNull();
    expect(clipLine(null)).toBeNull();
    expect(clipLine(undefined)).toBeNull();
  });
});

// rowSub is the PURE sub-line text for a roster row: a pending question, else the
// last assistant message (live `summary`, else the per-session cached summary the
// caller injects for an archived/closed pane whose live activity is gone), else a
// STATE-APPROPRIATE generic fallback (`stateFallback`) — closed → 'Archived',
// paused → the resume hint, error/attention → 'Errored — needs you' / 'Needs input',
// finished → the formatted cost, working/idle → currentAction ?? 'Working…'. The
// message (question/summary/cached) always WINS over the state word, including for an
// archived (closed) row that still has a cached summary.
describe('rowSub — last message/question on every row', () => {
  const q = (question: string): PendingQuestion => ({
    header: '',
    question,
    multiSelect: false,
    options: []
  });

  it('shows a pending structured question first', () => {
    const r = row('a', 'waiting', {
      questions: [q('Which database should I use?')],
      summary: 'last assistant message'
    });
    expect(rowSub(r)).toBe('Which database should I use?');
  });

  it('shows the compact pending question string when there is no structured one', () => {
    const r = row('a', 'waiting', { question: 'Pick a branch', summary: 'msg' });
    expect(rowSub(r)).toBe('Pick a branch');
  });

  it('shows the last assistant message when there is no pending question', () => {
    const r = row('a', 'working', { summary: 'I refactored the parser.' });
    expect(rowSub(r)).toBe('I refactored the parser.');
  });

  it('an ARCHIVED row with a live summary shows that summary, NOT "Archived · restore or delete"', () => {
    const r = row('a', 'finished', { closed: true, summary: 'Shipped the fix.' });
    expect(rowSub(r)).toBe('Shipped the fix.');
    expect(rowSub(r)).not.toContain('Archived');
  });

  it('an ARCHIVED row with NO live summary falls back to the injected cached summary', () => {
    // A closed pane has no live activity (`summary` is null), so the caller injects
    // the last summary it recorded while the pane was live.
    const r = row('a', 'finished', { closed: true, summary: null });
    expect(rowSub(r, () => 'Last thing it said before archiving')).toBe(
      'Last thing it said before archiving'
    );
    expect(rowSub(r, () => 'Last thing it said before archiving')).not.toContain('Archived');
  });

  it('prefers a pending question over both the live summary and the cached one', () => {
    const r = row('a', 'waiting', {
      question: 'Need your call here',
      summary: 'older message'
    });
    expect(rowSub(r, () => 'cached')).toBe('Need your call here');
  });

  it('prefers the live summary over the cached one', () => {
    const r = row('a', 'working', { summary: 'live message' });
    expect(rowSub(r, () => 'cached message')).toBe('live message');
  });

  it('clips a very long last message for the one-line display', () => {
    const long = 'y'.repeat(ROW_SUB_MAX_LEN + 80);
    const r = row('a', 'working', { summary: long });
    const out = rowSub(r);
    expect(out.length).toBeLessThanOrEqual(ROW_SUB_MAX_LEN + 1);
    expect(out.endsWith('…')).toBe(true);
  });
});

// When a row has NO pending question and NO (live or cached) summary, the sub-line
// falls back to a STATE-APPROPRIATE word — the per-lane strings restored from the old
// inline rowSub. The more-specific lifecycle states win, in order: closed → paused →
// error/attention → finished → working/idle.
describe('rowSub — state-appropriate fallback when there is no message', () => {
  it('a CLOSED row with no message falls back to "Archived"', () => {
    const r = row('a', 'finished', { closed: true, summary: null, question: null, questions: null });
    expect(rowSub(r, () => null)).toBe('Archived');
  });

  it('a PAUSED row with no message falls back to the resume hint', () => {
    const r = row('a', 'working', { paused: true, summary: null, question: null, questions: null });
    expect(rowSub(r, () => null)).toBe('Paused · send a message to resume');
  });

  it('an ERROR row with no question/summary falls back to "Errored — needs you"', () => {
    const r = row('a', 'error', { summary: null, question: null, questions: null });
    expect(rowSub(r, () => null)).toBe('Errored — needs you');
  });

  it('a WAITING row with no question/summary falls back to "Needs input"', () => {
    const r = row('a', 'waiting', { summary: null, question: null, questions: null });
    expect(rowSub(r, () => null)).toBe('Needs input');
  });

  it('a FINISHED row with no summary falls back to the formatted cost', () => {
    const withCost = row('a', 'finished', { summary: null, cost: 1.5 });
    expect(rowSub(withCost, () => null)).toBe('$1.50');
    // Unknown cost renders an em dash.
    const noCost = row('a', 'finished', { summary: null, cost: null });
    expect(rowSub(noCost, () => null)).toBe('—');
  });

  it('a WORKING/idle row with no summary falls back to currentAction, else "Working…"', () => {
    const acting = row('a', 'working', { summary: null, currentAction: 'Bash:npm test' });
    expect(rowSub(acting, () => null)).toBe('Bash:npm test');
    // No current action -> the generic working word.
    const idleish = row('a', 'idle', { summary: null, currentAction: null });
    expect(rowSub(idleish, () => null)).toBe('Working…');
    expect(rowSub(idleish)).toBe('Working…');
  });

  it('ignores a whitespace-only summary and cache, then uses the state fallback', () => {
    const r = row('a', 'idle', { summary: '   ', currentAction: null });
    expect(rowSub(r, () => '  ')).toBe('Working…');
  });

  // The message ALWAYS wins over the state word — including a CLOSED row whose only
  // message is the injected cached summary (shows the summary, NOT 'Archived').
  it('a message (question/summary/cached) wins over the state word for every lane', () => {
    // Closed + cached summary -> summary, not 'Archived'.
    const closedCached = row('a', 'finished', { closed: true, summary: null });
    expect(rowSub(closedCached, () => 'Shipped it')).toBe('Shipped it');
    // Paused + live summary -> summary, not the resume hint.
    const pausedMsg = row('b', 'working', { paused: true, summary: 'Mid-task note' });
    expect(rowSub(pausedMsg)).toBe('Mid-task note');
    // Error + question -> the question, not 'Errored — needs you'.
    const errQ = row('c', 'error', { question: 'Retry or abort?' });
    expect(rowSub(errQ)).toBe('Retry or abort?');
    // Finished + summary -> summary, not the cost.
    const finMsg = row('d', 'finished', { summary: 'All tests green', cost: 2 });
    expect(rowSub(finMsg)).toBe('All tests green');
  });
});
