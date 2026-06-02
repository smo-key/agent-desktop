// PURE board view-model for workflow-board STAGE 2 (spec: workflow-board).
//
// The Rust side (STAGE 1) returns each script's parsed JSON as a tolerant
// `serde_json::Value` passthrough — the frontend OWNS rendering. This module is
// the framework-free, deterministic layer between that raw `unknown` JSON and the
// read-only board UI: it validates/normalizes the shapes documented in the spec
// (Parse Temp-File-Path JSON Outputs) and groups issues into the three canonical
// status columns the board renders (To Do / In Progress / Done).
//
// It imports nothing from Svelte or Tauri so it is unit-testable in plain vitest
// (board-model.test.ts). The live script execution + Markdown render are MANUAL.
//
// Robustness over strictness: every parser is total. Unknown/garbage input yields
// empty/skipped entries rather than throwing, so a partially-shaped payload never
// blanks the whole board (the structured WorkflowError path owns hard failures).

/** One row in a `list`/children array, or a card on the board. */
export interface BoardIssue {
  /** Jira key, e.g. `SKIPA-123`. The stable identity / card title prefix. */
  key: string;
  /** One-line summary. */
  summary: string;
  /** Raw Jira status name, e.g. `To Do`, `In Progress`, `Done`, `In Review`. */
  status: string;
  /** Issue type name when present (`Feature`/`Task`/`Bug`/…), else null. */
  type: string | null;
  /** Parent epic key when present, else null. */
  epic: string | null;
}

/** An epic in the `epics.sh list` array (no children rollup). */
export interface BoardEpic {
  key: string;
  summary: string;
  status: string;
}

/** The three canonical columns the board groups issues into, in display order. */
export type ColumnId = 'todo' | 'in-progress' | 'done';

/** A single column: its id, human label, and the issues that fall in it. */
export interface BoardColumn {
  id: ColumnId;
  /** Display label: "To Do" / "In Progress" / "Done". */
  label: string;
  /** Issues whose status maps to this column, in input order. */
  issues: BoardIssue[];
}

/** The fixed column order + labels the board renders. */
const COLUMN_DEFS: ReadonlyArray<{ id: ColumnId; label: string }> = [
  { id: 'todo', label: 'To Do' },
  { id: 'in-progress', label: 'In Progress' },
  { id: 'done', label: 'Done' }
];

/**
 * Map a raw Jira status name to one of the three board columns. The mapping is
 * deliberately tolerant (case-insensitive, substring-based) because each repo's
 * Jira project may use its own status vocabulary (e.g. `In Review`, `Blocked`,
 * `Backlog`): anything that reads as terminal/closed lands in Done, anything
 * actively-worked lands in In Progress, and everything else (including unknown
 * statuses) falls back to To Do so no card is ever dropped.
 */
export function columnForStatus(status: string): ColumnId {
  const s = status.trim().toLowerCase();
  if (s === '') return 'todo';
  // Terminal / closed states -> Done.
  if (
    s.includes('done') ||
    s.includes('closed') ||
    s.includes('complete') ||
    s.includes('resolved') ||
    s.includes('shipped') ||
    s === 'cancelled' ||
    s === 'canceled'
  ) {
    return 'done';
  }
  // Actively-worked states -> In Progress.
  if (
    s.includes('progress') ||
    s.includes('review') ||
    s.includes('doing') ||
    s.includes('started') ||
    s.includes('testing') ||
    s.includes('qa')
  ) {
    return 'in-progress';
  }
  // To Do / Backlog / Open / Blocked / unknown -> the first column.
  return 'todo';
}

/** Narrow an unknown value to a non-null record (object) for field access. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A required string field: returns the string, or null if absent/non-string. */
function str(rec: Record<string, unknown>, key: string): string | null {
  const v = rec[key];
  return typeof v === 'string' ? v : null;
}

/**
 * Normalize ONE raw issue/child object into a `BoardIssue`, or null if it lacks
 * the two required fields (`key`, `status`). `summary` defaults to '' and the
 * optional `type`/`epic` to null. Accepts the union of the `issues.sh list`,
 * `epic.children.issues`, and `next.sh`-adjacent shapes.
 */
export function parseIssue(raw: unknown): BoardIssue | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const key = str(rec, 'key');
  const status = str(rec, 'status');
  if (key === null || status === null) return null;
  return {
    key,
    summary: str(rec, 'summary') ?? '',
    status,
    type: str(rec, 'type'),
    epic: str(rec, 'epic')
  };
}

/**
 * Normalize a raw `list`-style payload (the tolerant `Value` array from
 * `issues.sh <type> list` or an epic's `children.issues`) into a clean
 * `BoardIssue[]`. Non-array input yields `[]`; malformed rows are skipped (never
 * throws) so one bad row can't blank the column.
 */
export function parseIssues(raw: unknown): BoardIssue[] {
  if (!Array.isArray(raw)) return [];
  const out: BoardIssue[] = [];
  for (const item of raw) {
    const issue = parseIssue(item);
    if (issue) out.push(issue);
  }
  return out;
}

/**
 * Normalize a raw `epics.sh list` payload into `BoardEpic[]`. Same tolerance as
 * `parseIssues`: non-array -> [], malformed rows skipped. Requires `key` +
 * `status`; `summary` defaults to ''.
 */
export function parseEpics(raw: unknown): BoardEpic[] {
  if (!Array.isArray(raw)) return [];
  const out: BoardEpic[] = [];
  for (const item of raw) {
    const rec = asRecord(item);
    if (!rec) continue;
    const key = str(rec, 'key');
    const status = str(rec, 'status');
    if (key === null || status === null) continue;
    out.push({ key, summary: str(rec, 'summary') ?? '', status });
  }
  return out;
}

/**
 * Group a list of issues into the three fixed columns (To Do / In Progress /
 * Done) by their status, preserving input order within each column. The columns
 * are always returned in display order, even when empty, so the board renders a
 * stable three-column skeleton regardless of which statuses are present.
 *
 * This is the load-bearing view-model the board renders and the unit tests own
 * (the live script execution + Markdown render are MANUAL).
 */
export function groupByStatus(issues: BoardIssue[]): BoardColumn[] {
  const buckets: Record<ColumnId, BoardIssue[]> = {
    todo: [],
    'in-progress': [],
    done: []
  };
  for (const issue of issues) {
    buckets[columnForStatus(issue.status)].push(issue);
  }
  return COLUMN_DEFS.map((def) => ({
    id: def.id,
    label: def.label,
    issues: buckets[def.id]
  }));
}

/**
 * Convenience: parse a raw `list` payload AND group it into columns in one call —
 * the exact transform the board applies to `issues.sh <type> list` / an epic's
 * `children.issues` output. Tolerant end-to-end (bad input -> three empty cols).
 */
export function columnsFromRaw(raw: unknown): BoardColumn[] {
  return groupByStatus(parseIssues(raw));
}
