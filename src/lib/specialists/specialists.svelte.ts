// Reactive runes store for AGENT SPECIALISTS — native Claude Code subagents stored
// as `.claude/agents/<name>.md` files under the ACTIVE PROJECT. A thin wrapper over
// the PURE `specialists.ts` model: it holds the loaded entries for one project in
// `$state` and persists via the Rust `specialists_list`/`specialists_write`/
// `specialists_delete` commands (camelCase args: { projectPath, name, content }).
//
// TOLERANCE BY CONSTRUCTION: a `.claude/agents/*.md` file that fails to parse must
// NOT drop out of the list or break the rest — it surfaces as a per-entry
// `SpecialistError` (the file's `name` + the parse `error` message) so the panel can
// render it as "broken" instead of crashing or silently hiding it. The pure
// `normalizeSpecialistEntries` helper owns that map-and-capture logic and is the
// unit-tested core; the reactive class itself only does Tauri I/O and, like the
// other stores in this repo (projectTasks, subagents), tolerates being outside
// Tauri by logging once and leaving state as-is.

import { invoke } from '@tauri-apps/api/core';
import {
  parseSpecialist,
  serializeSpecialist,
  validateSpecialistName,
  SpecialistParseError,
  type Specialist,
} from './specialists';

/** The raw wire shape of one entry from `specialists_list`: the file's basename
 *  (no `.md`) and the RAW `.md` contents to be parsed. */
export interface RawSpecialist {
  /** File basename without `.md` — the specialist's name as stored on disk. */
  name: string;
  /** The raw `.md` file contents (frontmatter + body), to parse via `parseSpecialist`. */
  content: string;
}

/** A `.claude/agents/*.md` file that failed to parse — kept in the list (rather than
 *  dropped) so the panel can show it as broken. Carries the file's basename and the
 *  human-readable parse error. Discriminated from a parsed {@link Specialist} by the
 *  presence of `error`. */
export interface SpecialistError {
  /** File basename without `.md` — the entry's name as stored on disk. */
  name: string;
  /** The parse failure message (from {@link SpecialistParseError}). */
  error: string;
}

/** A loaded list item: either a parsed specialist or a per-entry parse error. */
export type SpecialistEntry = Specialist | SpecialistError;

/** Narrow a {@link SpecialistEntry} to an error entry (failed to parse). */
export function isSpecialistError(entry: SpecialistEntry): entry is SpecialistError {
  return typeof (entry as SpecialistError).error === 'string';
}

/**
 * PURE: map a raw `{ name, content }[]` list (from `specialists_list`) into loaded
 * entries, parsing each `content` via {@link parseSpecialist}. An entry that parses
 * cleanly becomes a {@link Specialist}; an entry whose content throws
 * {@link SpecialistParseError} becomes a {@link SpecialistError} carrying the file's
 * basename + the error message — so a single malformed file never throws or drops the
 * rest of the list. A non-array input yields an empty list. Never mutates its input.
 * This is the unit-tested core of the store.
 */
export function normalizeSpecialistEntries(raw: unknown): SpecialistEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: SpecialistEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const name = typeof (item as RawSpecialist).name === 'string' ? (item as RawSpecialist).name : '';
    const content =
      typeof (item as RawSpecialist).content === 'string' ? (item as RawSpecialist).content : '';
    try {
      out.push(parseSpecialist(content));
    } catch (err) {
      // Keep the broken file visible as an error entry rather than dropping it.
      const message = err instanceof SpecialistParseError ? err.message : String(err);
      out.push({ name, error: message });
    }
  }
  return out;
}

/**
 * Reactive specialists store for the active project. Holds the loaded list (parsed
 * specialists + per-entry parse errors) in `$state`, seeded from `specialists_list`
 * and refreshed after each write/delete. A single instance is exported below.
 */
export class SpecialistsStore {
  /** The loaded entries for the active project: parsed specialists interleaved with
   *  per-entry parse errors (broken files), in `specialists_list` order. */
  entries = $state<SpecialistEntry[]>([]);

  /** The project path the current `entries` were loaded for, or null before any load. */
  projectPath = $state<string | null>(null);

  /** True once `load()` has resolved at least once. */
  loaded = $state(false);

  /** The parsed (well-formed) specialists only — drops the error entries. */
  get specialists(): Specialist[] {
    return this.entries.filter((e): e is Specialist => !isSpecialistError(e));
  }

  /** The parse-error entries only (broken files the panel renders as broken). */
  get errors(): SpecialistError[] {
    return this.entries.filter(isSpecialistError);
  }

  /** The names already present (parsed + broken) — pass to {@link validateName}
   *  / `validateSpecialistName` to enforce uniqueness on create. */
  get names(): string[] {
    return this.entries.map((e) => e.name);
  }

  /**
   * Validate a candidate `name` for create/save against the currently-loaded entries.
   * Reuses {@link validateSpecialistName} (filename-safety + case-insensitive
   * uniqueness). When `excludeName` is given (an edit/save of an existing specialist),
   * that name is removed from the existing set so renaming a specialist to its own
   * name is allowed. Exposed so the panel (task 5.x) can validate inline too.
   */
  validateName(name: string, excludeName?: string) {
    const existing =
      excludeName == null
        ? this.names
        : this.names.filter((n) => n.toLowerCase() !== excludeName.toLowerCase());
    return validateSpecialistName(name, existing);
  }

  /**
   * Load the active project's specialists: call `specialists_list(projectPath)`, parse
   * each returned `{ name, content }`, and store the normalized entries (parsed +
   * per-entry errors). On a command failure (e.g. running outside Tauri) it logs once
   * and leaves the current state untouched — never throws.
   */
  async load(projectPath: string): Promise<void> {
    try {
      const raw = await invoke<RawSpecialist[]>('specialists_list', { projectPath });
      this.entries = normalizeSpecialistEntries(raw);
      this.projectPath = projectPath;
      this.loaded = true;
    } catch (err) {
      console.warn('specialists_list failed; leaving specialists unchanged:', err);
    }
  }

  /**
   * Create a NEW specialist in `projectPath`: validate the name for uniqueness against
   * the loaded entries, serialize via {@link serializeSpecialist}, write via
   * `specialists_write`, then refresh. Throws an `Error` carrying the validation reason
   * (rather than writing an invalid/duplicate file) when the name is rejected.
   */
  async create(projectPath: string, specialist: Specialist): Promise<void> {
    const check = this.validateName(specialist.name);
    if (!check.ok) throw new Error(check.reason);
    await this.write(projectPath, specialist);
  }

  /**
   * Save (overwrite) an EXISTING specialist in `projectPath`: validate the name,
   * excluding the specialist's own name from the uniqueness check so an in-place edit
   * is allowed, then serialize + write + refresh. Throws an `Error` with the reason
   * when the name is invalid.
   */
  async save(projectPath: string, specialist: Specialist): Promise<void> {
    const check = this.validateName(specialist.name, specialist.name);
    if (!check.ok) throw new Error(check.reason);
    await this.write(projectPath, specialist);
  }

  /** Serialize + `specialists_write` + reload. Shared by {@link create}/{@link save}. */
  private async write(projectPath: string, specialist: Specialist): Promise<void> {
    const content = serializeSpecialist(specialist);
    await invoke('specialists_write', { projectPath, name: specialist.name, content });
    await this.load(projectPath);
  }

  /**
   * Delete the specialist `name` from `projectPath` via `specialists_delete`, then
   * refresh the list.
   */
  async remove(projectPath: string, name: string): Promise<void> {
    await invoke('specialists_delete', { projectPath, name });
    await this.load(projectPath);
  }
}

/** The singleton specialists store, imported by the specialists panel + page chrome. */
export const specialists = new SpecialistsStore();
