// PURE, framework-free model for the launcher's recent-folders list (Milestone 5
// / session-launcher spec, Requirement: Recent-Folders Persistence Across
// Restarts). No Svelte/Tauri/DOM imports so it runs under the default (node)
// Vitest environment and is unit-tested in full. The reactive `recents` runes
// store (recents.svelte.ts) is a thin wrapper that runs these helpers over
// `$state` and persists the result via the Rust `recents_load`/`recents_save`
// commands — the SAME atomic tmp+rename mechanism as `layout_load`/`layout_save`,
// just against a sibling `recents.json` file (see recents.svelte.ts).

/** Default cap on how many recent folders are remembered (newest-first). */
export const DEFAULT_MAX_RECENTS = 10;

/** The on-disk schema version for the persisted recents envelope. */
export const RECENTS_VERSION = 1 as const;

/** The top-level persisted envelope written to `recents.json`. */
export interface PersistedRecents {
  version: typeof RECENTS_VERSION;
  /** Absolute folder paths, most-recent first. */
  recents: string[];
}

/**
 * Add `path` to the front of `list` as the most-recent entry.
 *
 *  - DEDUPE: any existing occurrence of `path` is removed first, so the result
 *    contains exactly one copy (re-launching a folder MOVES it to the head
 *    rather than adding a duplicate).
 *  - ORDER: most-recent first (the just-added `path` is always index 0).
 *  - CAP: the list is truncated to at most `max` entries, dropping the OLDEST
 *    (tail) entries past the cap.
 *
 * Blank/empty `path` is ignored (the list is returned unchanged). Pure: never
 * mutates the input array.
 */
export function addRecent(
  list: ReadonlyArray<string>,
  path: string,
  max: number = DEFAULT_MAX_RECENTS
): string[] {
  const trimmed = typeof path === 'string' ? path.trim() : '';
  if (!trimmed) return [...list];
  const deduped = list.filter((p) => p !== trimmed);
  const next = [trimmed, ...deduped];
  return max > 0 ? next.slice(0, max) : next;
}

/**
 * Normalize an arbitrary array into a clean recents list: keep only non-empty
 * strings, dedupe (first occurrence wins, preserving order), and cap. Used by
 * `parseRecents` to sanitize an untrusted persisted file.
 */
function normalize(
  arr: ReadonlyArray<unknown>,
  max: number = DEFAULT_MAX_RECENTS
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of arr) {
    if (typeof item !== 'string') continue;
    const p = item.trim();
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Parse the persisted recents JSON (or `null`/empty for "no file") into a clean,
 * deduped, capped list. Accepts either a bare array of paths or the documented
 * `{ version, recents: [...] }` envelope. ANY failure (missing file, parse
 * error, wrong shape, garbage entries) collapses to an empty list — this NEVER
 * throws, mirroring `restoreState`'s graceful-fallback contract.
 */
export function parseRecents(raw: string | null | undefined): string[] {
  try {
    if (raw == null || raw.trim() === '') return [];
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return normalize(parsed);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as { recents?: unknown }).recents)
    ) {
      return normalize((parsed as { recents: unknown[] }).recents);
    }
    return [];
  } catch {
    return [];
  }
}

/** Serialize a recents list into the persisted `{ version, recents }` envelope. */
export function serializeRecents(list: ReadonlyArray<string>): string {
  const envelope: PersistedRecents = {
    version: RECENTS_VERSION,
    recents: [...list]
  };
  return JSON.stringify(envelope);
}
