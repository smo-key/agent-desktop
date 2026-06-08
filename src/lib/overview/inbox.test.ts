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
  deleteAllArchivedRequest
} from './inbox';

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
  it('resumes when the live hash differs from the paused-at hash', () => {
    expect(shouldAutoResume('h1', 'h2')).toBe(true);
    // Paused with no messages, then a message arrives: null -> a hash.
    expect(shouldAutoResume(null, 'h1')).toBe(true);
  });

  it('stays paused while no new message has arrived', () => {
    expect(shouldAutoResume('h1', 'h1')).toBe(false);
    expect(shouldAutoResume(null, null)).toBe(false);
    // A transient missing live hash must NOT resume (avoids a poll gap un-pausing).
    expect(shouldAutoResume('h1', null)).toBe(false);
    expect(shouldAutoResume('h1', undefined)).toBe(false);
  });
});

// A previewing (resumed-from-Archived) session unarchives on the SAME hash-diff
// signal a paused session resumes on: the inbox captures the user-message hash when
// preview begins (`previewHash`) and unarchives (commitPreview) once the live hash
// differs — i.e. the user sent a new message. Until then it stays previewing.
describe('Sending a message unarchives a previewing session', () => {
  it('unarchives once the live hash differs from the preview baseline', () => {
    // Baseline captured at preview start; a new message changes the live hash.
    expect(shouldAutoResume('preview-h1', 'preview-h2')).toBe(true);
    // Previewed an archived session that had no messages, then one arrives.
    expect(shouldAutoResume(null, 'preview-h1')).toBe(true);
  });

  it('stays previewing while no new message has arrived', () => {
    expect(shouldAutoResume('preview-h1', 'preview-h1')).toBe(false);
    // A transient missing live hash must NOT unarchive (poll-gap safe).
    expect(shouldAutoResume('preview-h1', null)).toBe(false);
    expect(shouldAutoResume('preview-h1', undefined)).toBe(false);
  });
});
