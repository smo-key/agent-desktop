// Pure helpers for terminal file-link detection (terminal-file-links spec).
//
// Given a terminal buffer line and a column, we (1) extract the contiguous
// non-whitespace run under the pointer and (2) strip the decorations that
// commonly wrap a printed path — surrounding quotes/backticks, one layer of
// bracket wrapping, a trailing `:line[:col]` suffix, and trailing sentence
// punctuation. The cleaned token is what we resolve against the filesystem; the
// returned offsets are used to draw the underline over JUST the path.
//
// These functions are intentionally side-effect free and DOM-free so they are
// unit-testable in isolation; the xterm link provider in TerminalPane.svelte
// composes them via `fileLinkAt`.

/** A run of non-whitespace characters and its [start, end) range within a line. */
export interface RawToken {
  raw: string;
  /** 0-based column of the first character (inclusive). */
  start: number;
  /** 0-based column one past the last character (exclusive). */
  end: number;
}

/** A cleaned path token and its [start, end) range within the source string. */
export interface CleanToken {
  text: string;
  /** Offset of the first kept character within the input (inclusive). */
  start: number;
  /** Offset one past the last kept character within the input (exclusive). */
  end: number;
}

/**
 * Extract the contiguous non-whitespace run that the column `col` falls within.
 * Returns null when `col` is out of range or lands on whitespace (no token to
 * linkify there).
 */
export function extractToken(line: string, col: number): RawToken | null {
  if (col < 0 || col >= line.length) return null;
  if (/\s/.test(line[col])) return null;
  let start = col;
  while (start > 0 && !/\s/.test(line[start - 1])) start--;
  let end = col + 1;
  while (end < line.length && !/\s/.test(line[end])) end++;
  return { raw: line.slice(start, end), start, end };
}

/**
 * Strip path decorations from `raw`, returning the cleaned token and the offsets
 * (relative to `raw`) of what was kept. Peels iteratively from both ends so the
 * decorations compose in any order, e.g. `"src/foo.ts:42:8".` → `src/foo.ts`.
 */
export function normalizeToken(raw: string): CleanToken {
  let left = 0;
  let right = raw.length; // exclusive

  let changed = true;
  while (changed && left < right) {
    changed = false;
    const seg = raw.slice(left, right);
    const first = raw[left];
    const last = raw[right - 1];

    // `:line` or `:line:col` suffix.
    const m = seg.match(/:\d+(:\d+)?$/);
    if (m) {
      right -= m[0].length;
      changed = true;
      continue;
    }
    // Trailing sentence punctuation (the bare `:` case — `:line` is handled above).
    if ('.,;!?:'.includes(last)) {
      right--;
      changed = true;
      continue;
    }
    // One matched layer of wrapping brackets.
    if (
      (first === '(' && last === ')') ||
      (first === '[' && last === ']') ||
      (first === '<' && last === '>')
    ) {
      left++;
      right--;
      changed = true;
      continue;
    }
    // Surrounding quotes/backticks (either side independently).
    if (first === '"' || first === "'" || first === '`') {
      left++;
      changed = true;
      continue;
    }
    if (last === '"' || last === "'" || last === '`') {
      right--;
      changed = true;
      continue;
    }
    // Stray (unmatched) brackets clinging to one end.
    if (last === ')' || last === ']' || last === '>') {
      right--;
      changed = true;
      continue;
    }
    if (first === '(' || first === '[' || first === '<') {
      left++;
      changed = true;
      continue;
    }
  }

  return { text: raw.slice(left, right), start: left, end: right };
}

/**
 * Compose `extractToken` + `normalizeToken`: from a line + column, return the
 * cleaned path candidate and its [start, end) range in LINE coordinates, or null
 * when there is nothing to linkify. The caller still validates existence (via the
 * `resolve_path` backend command) before drawing a link.
 */
export function fileLinkAt(line: string, col: number): CleanToken | null {
  const tok = extractToken(line, col);
  if (!tok) return null;
  const clean = normalizeToken(tok.raw);
  if (!clean.text) return null;
  return {
    text: clean.text,
    start: tok.start + clean.start,
    end: tok.start + clean.end
  };
}
