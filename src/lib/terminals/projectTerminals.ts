// PURE, framework-free model for PROJECT TERMINALS — the user-created terminals
// in the right-docked Terminals panel (project-terminals capability). Mirrors the
// projects model: no Svelte/Tauri/DOM imports, so it runs under the default (node)
// Vitest environment and is unit-tested in full. The reactive store
// (projectTerminals.svelte.ts) is a thin wrapper that runs these helpers over
// `$state` and persists the result via the Rust `terminals_load`/`terminals_save`
// commands — the SAME atomic tmp+rename mechanism as projects, against a sibling
// `terminals.json` file.
//
// A terminal is a DURABLE SLOT whose process may be running or stopped. Only the
// definition (id/name/command/cwd) and a single lifecycle hint (`wasRunning`,
// captured at quit) are persisted; live process handles / running status / exit
// codes are runtime-only and live in the store, never serialized.

/** The on-disk schema version for the persisted terminals envelope. */
export const TERMINALS_VERSION = 1 as const;

/** A user-created terminal definition (one slot in a project's panel stack). */
export interface TerminalDef {
  /** Stable unique id. */
  id: string;
  /** Human-readable label shown in the panel. */
  name: string;
  /** Command line to run; `null` ⇒ the default login shell. */
  command: string | null;
  /** Working directory; `null` ⇒ the project's path at start time. */
  cwd: string | null;
  /** Lifecycle hint captured at graceful quit: was this terminal running? Drives
   *  selective auto-restart on the next launch. Absent ⇒ treated as not-running. */
  wasRunning?: boolean;
  /** The command that was actively running at the last graceful quit (captured from
   *  the live terminal title), re-run on restore so a restored shell comes back to
   *  what it was doing. Absent ⇒ restore as a plain interactive shell. */
  lastCommand?: string;
}

/** Per-project terminal collections, keyed by `projectId`. */
export type TerminalsByProject = Record<string, TerminalDef[]>;

/** The top-level persisted envelope written to `terminals.json`. */
export interface PersistedTerminals {
  version: typeof TERMINALS_VERSION;
  projects: TerminalsByProject;
}

/** Cap on the displayed terminal name derived from a command (keeps the panel tidy). */
const NAME_MAX = 32;

/**
 * Default display name for a terminal: a whitespace-collapsed, length-capped form
 * of its command, or `shell` when there is no command (the default shell).
 */
export function defaultTerminalName(command: string | null | undefined): string {
  const cmd = typeof command === 'string' ? command.trim().replace(/\s+/g, ' ') : '';
  if (cmd === '') return 'shell';
  return cmd.length > NAME_MAX ? `${cmd.slice(0, NAME_MAX - 1)}…` : cmd;
}

/** Concrete spawn parameters for a terminal, resolved against its project path. */
export interface TerminalSpawnSpec {
  /** Program to exec (always the user's shell — commands run through it). */
  program: string;
  /** Args: empty for an interactive shell; `['-lc', command]` for a command. */
  args: string[];
  /** Resolved working directory (the def's cwd, else the project path, else null). */
  cwd: string | null;
}

/**
 * Resolve a terminal's spawn parameters. A command runs through the user's login
 * shell (`shell -lc "<command>"`) so PATH/profile (nvm, etc.) are loaded and the
 * full command line (pipes, env) works; when it exits the shell exits, surfacing
 * EOF so the terminal flips to stopped. A null/blank command is an interactive
 * shell. The cwd defaults to the project path unless the def pins its own.
 */
export function terminalSpawnSpec(
  def: TerminalDef,
  projectPath: string | null,
  shell: string
): TerminalSpawnSpec {
  const cwd = def.cwd ?? projectPath ?? null;
  const cmd = typeof def.command === 'string' ? def.command.trim() : '';
  if (cmd === '') return { program: shell, args: [], cwd };
  return { program: shell, args: ['-lc', cmd], cwd };
}

/** The terminals for `projectId` (empty array when the project has none). */
export function terminalsForProject(
  map: TerminalsByProject,
  projectId: string
): TerminalDef[] {
  return map[projectId] ?? [];
}

/** Append `def` to `projectId`'s collection (immutably). */
export function addTerminal(
  map: TerminalsByProject,
  projectId: string,
  def: TerminalDef
): TerminalsByProject {
  const current = map[projectId] ?? [];
  return { ...map, [projectId]: [...current, def] };
}

/** Remove the terminal with id `id` from whichever project holds it (immutably). */
export function removeTerminal(map: TerminalsByProject, id: string): TerminalsByProject {
  const next: TerminalsByProject = {};
  for (const [projectId, list] of Object.entries(map)) {
    next[projectId] = list.filter((t) => t.id !== id);
  }
  return next;
}

/** Rename the terminal with id `id`. A blank/whitespace name is ignored (no-op). */
export function renameTerminal(
  map: TerminalsByProject,
  id: string,
  name: string
): TerminalsByProject {
  const clean = typeof name === 'string' ? name.trim() : '';
  if (clean === '') return map;
  return mapTerminals(map, (t) => (t.id === id ? { ...t, name: clean } : t));
}

/**
 * Capture each terminal's running state into its `wasRunning` flag, given the set
 * of currently-running terminal ids. Called at graceful quit so the next launch
 * can selectively auto-restart only what was running.
 */
export function markRunningState(
  map: TerminalsByProject,
  runningIds: ReadonlySet<string>
): TerminalsByProject {
  return mapTerminals(map, (t) => ({ ...t, wasRunning: runningIds.has(t.id) }));
}

/**
 * Capture each terminal's running state AND its actively-running command into the
 * persisted def, given per-terminal runtime info (running flag + live title). Sets
 * `wasRunning` and, for a running terminal with a non-empty title, `lastCommand`
 * (cleared otherwise). Called at graceful quit so the next launch can restore each
 * shell — and re-run what it was doing.
 */
export function captureRunningState(
  map: TerminalsByProject,
  infoById: Record<string, { running: boolean; title?: string } | undefined>
): TerminalsByProject {
  return mapTerminals(map, (t) => {
    const info = infoById[t.id];
    const running = info?.running === true;
    const cmd = running && info?.title ? info.title.trim() : '';
    const next: TerminalDef = { ...t, wasRunning: running };
    if (cmd) next.lastCommand = cmd;
    else delete next.lastCommand;
    return next;
  });
}

/**
 * The ids of terminals that should auto-start on launch — exactly those whose
 * persisted `wasRunning` flag is true. All others are restored as stopped.
 */
export function autoRestartIds(map: TerminalsByProject): string[] {
  const ids: string[] = [];
  for (const list of Object.values(map)) {
    for (const t of list) if (t.wasRunning) ids.push(t.id);
  }
  return ids;
}

/** Map a transform over every terminal in every project (immutably). */
function mapTerminals(
  map: TerminalsByProject,
  fn: (t: TerminalDef) => TerminalDef
): TerminalsByProject {
  const next: TerminalsByProject = {};
  for (const [projectId, list] of Object.entries(map)) {
    next[projectId] = list.map(fn);
  }
  return next;
}

/**
 * Parse the persisted terminals JSON (or `null`/empty for "no file") into clean
 * per-project collections. Accepts the `{ version, projects: {...} }` envelope.
 * ANY failure collapses to empty collections — NEVER throws.
 */
export function parseTerminals(raw: string | null | undefined): TerminalsByProject {
  try {
    if (raw == null || raw.trim() === '') return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const projects = (parsed as { projects?: unknown }).projects;
    if (projects === null || typeof projects !== 'object' || Array.isArray(projects)) return {};
    const out: TerminalsByProject = {};
    for (const [projectId, list] of Object.entries(projects as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      const clean = list.map(normalize).filter((t): t is TerminalDef => t !== null);
      if (clean.length > 0) out[projectId] = clean;
    }
    return out;
  } catch {
    return {};
  }
}

/** Coerce one persisted entry into a clean `TerminalDef`, or `null` if unusable. */
function normalize(raw: unknown): TerminalDef | null {
  if (raw === null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id === '') return null;
  const command = typeof r.command === 'string' ? r.command : null;
  const cwd = typeof r.cwd === 'string' ? r.cwd : null;
  const name = typeof r.name === 'string' && r.name.trim() !== '' ? r.name : defaultTerminalName(command);
  const def: TerminalDef = { id: r.id, name, command, cwd };
  if (typeof r.wasRunning === 'boolean') def.wasRunning = r.wasRunning;
  if (typeof r.lastCommand === 'string' && r.lastCommand.trim() !== '') {
    def.lastCommand = r.lastCommand;
  }
  return def;
}

/** Serialize collections into the persisted `{ version, projects }` envelope.
 *  Empty project buckets are dropped so the file stays tidy. */
export function serializeTerminals(map: TerminalsByProject): string {
  const projects: TerminalsByProject = {};
  for (const [projectId, list] of Object.entries(map)) {
    if (list.length > 0) projects[projectId] = list;
  }
  const envelope: PersistedTerminals = { version: TERMINALS_VERSION, projects };
  return JSON.stringify(envelope);
}
