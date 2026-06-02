import { describe, expect, it } from 'vitest';
import {
  columnForStatus,
  columnsFromRaw,
  groupByStatus,
  parseEpics,
  parseIssue,
  parseIssues,
  type BoardIssue
} from './board-model';

// Tests for the PURE workflow board view-model (workflow-board STAGE 2). The Rust
// side (STAGE 1) owns the spec's parse/temp-file/exit-code scenarios under exactly
// one covering test each (workflow::tests); these assert the FRONTEND view-model —
// the tolerant normalization of the tolerant `Value` passthrough and the
// status->column grouping the read-only board renders. The live script execution +
// Markdown render are MANUAL (see the stage report).

const issue = (over: Partial<BoardIssue> = {}): BoardIssue => ({
  key: 'SKIPA-1',
  summary: 'Do the thing',
  status: 'To Do',
  type: null,
  epic: null,
  ...over
});

describe('board-model — status to column mapping', () => {
  it('maps known and unknown statuses to the three canonical columns', () => {
    // To Do family + backlog/open/blocked/unknown all fall to the first column.
    expect(columnForStatus('To Do')).toBe('todo');
    expect(columnForStatus('Backlog')).toBe('todo');
    expect(columnForStatus('Open')).toBe('todo');
    expect(columnForStatus('Blocked')).toBe('todo');
    expect(columnForStatus('Something Custom')).toBe('todo');
    expect(columnForStatus('')).toBe('todo');

    // Actively-worked states -> In Progress (case-insensitive, substring).
    expect(columnForStatus('In Progress')).toBe('in-progress');
    expect(columnForStatus('in progress')).toBe('in-progress');
    expect(columnForStatus('In Review')).toBe('in-progress');
    expect(columnForStatus('QA')).toBe('in-progress');

    // Terminal states -> Done.
    expect(columnForStatus('Done')).toBe('done');
    expect(columnForStatus('Closed')).toBe('done');
    expect(columnForStatus('Resolved')).toBe('done');
    expect(columnForStatus('Cancelled')).toBe('done');
  });
});

describe('board-model — parsing tolerant Value payloads', () => {
  it('parses a single issue row, defaulting optional fields', () => {
    expect(parseIssue({ key: 'SKIPA-9', summary: 'S', status: 'Done' })).toEqual({
      key: 'SKIPA-9',
      summary: 'S',
      status: 'Done',
      type: null,
      epic: null
    });
    // type + epic are carried through when present.
    expect(
      parseIssue({ key: 'K', summary: 'S', status: 'To Do', type: 'Task', epic: 'E-1' })
    ).toEqual({ key: 'K', summary: 'S', status: 'To Do', type: 'Task', epic: 'E-1' });
    // summary defaults to '' when absent.
    expect(parseIssue({ key: 'K', status: 'To Do' })?.summary).toBe('');
  });

  it('rejects rows missing required key/status, and non-objects', () => {
    expect(parseIssue({ summary: 'no key', status: 'To Do' })).toBeNull();
    expect(parseIssue({ key: 'K', summary: 'no status' })).toBeNull();
    expect(parseIssue(null)).toBeNull();
    expect(parseIssue(42)).toBeNull();
    expect(parseIssue([])).toBeNull();
  });

  it('parses a list array, skipping malformed rows without throwing', () => {
    const raw = [
      { key: 'A', summary: 'a', status: 'To Do' },
      { key: 'B', status: 'Done' }, // valid (summary defaults)
      { summary: 'no key', status: 'To Do' }, // dropped
      null, // dropped
      'garbage' // dropped
    ];
    const parsed = parseIssues(raw);
    expect(parsed.map((i) => i.key)).toEqual(['A', 'B']);
  });

  it('returns [] for non-array list payloads', () => {
    expect(parseIssues(null)).toEqual([]);
    expect(parseIssues({})).toEqual([]);
    expect(parseIssues(undefined)).toEqual([]);
  });

  it('parses the epics.sh list array shape', () => {
    const raw = [
      { key: 'SKIPA-100', summary: 'Epic One', status: 'In Progress' },
      { key: 'SKIPA-200', status: 'To Do' }, // summary defaults to ''
      { summary: 'no key' } // dropped
    ];
    expect(parseEpics(raw)).toEqual([
      { key: 'SKIPA-100', summary: 'Epic One', status: 'In Progress' },
      { key: 'SKIPA-200', summary: '', status: 'To Do' }
    ]);
    expect(parseEpics('nope')).toEqual([]);
  });
});

describe('board-model — grouping issues by status into columns', () => {
  it('groups issues into To Do / In Progress / Done preserving order', () => {
    const issues: BoardIssue[] = [
      issue({ key: 'A', status: 'To Do' }),
      issue({ key: 'B', status: 'In Progress' }),
      issue({ key: 'C', status: 'Done' }),
      issue({ key: 'D', status: 'In Review' }), // -> in-progress
      issue({ key: 'E', status: 'Backlog' }), // -> todo
      issue({ key: 'F', status: 'Closed' }) // -> done
    ];
    const cols = groupByStatus(issues);

    // Always three columns, in display order, with stable labels.
    expect(cols.map((c) => c.id)).toEqual(['todo', 'in-progress', 'done']);
    expect(cols.map((c) => c.label)).toEqual(['To Do', 'In Progress', 'Done']);

    expect(cols[0].issues.map((i) => i.key)).toEqual(['A', 'E']);
    expect(cols[1].issues.map((i) => i.key)).toEqual(['B', 'D']);
    expect(cols[2].issues.map((i) => i.key)).toEqual(['C', 'F']);
  });

  it('returns three empty columns for no issues', () => {
    const cols = groupByStatus([]);
    expect(cols).toHaveLength(3);
    expect(cols.every((c) => c.issues.length === 0)).toBe(true);
  });

  it('parses and groups a raw list payload end-to-end (columnsFromRaw)', () => {
    const raw = [
      { key: 'A', summary: 'a', status: 'To Do' },
      { key: 'B', summary: 'b', status: 'In Progress' },
      'garbage', // dropped, does not throw
      { key: 'C', summary: 'c', status: 'Done' }
    ];
    const cols = columnsFromRaw(raw);
    expect(cols[0].issues.map((i) => i.key)).toEqual(['A']);
    expect(cols[1].issues.map((i) => i.key)).toEqual(['B']);
    expect(cols[2].issues.map((i) => i.key)).toEqual(['C']);

    // Bad top-level input -> three empty columns, never a throw / blank board.
    expect(columnsFromRaw('nope').every((c) => c.issues.length === 0)).toBe(true);
  });
});
