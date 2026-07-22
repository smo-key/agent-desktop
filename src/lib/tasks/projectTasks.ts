// PURE, framework-free model for PROJECT TERMINALS — the user-created terminals
// in the right-docked Terminals panel (project-terminals capability). Mirrors the
// projects model: no Svelte/Tauri/DOM imports, so it runs under the default (node)
// Vitest environment and is unit-tested in full. The reactive store
// (projectTasks.svelte.ts) is a thin wrapper that runs these helpers over
// `$state` and persists the result via the Rust `tasks_load`/`tasks_save`
// commands — the SAME atomic tmp+rename mechanism as projects, against a sibling
// `terminals.json` file.
//
// A terminal is a DURABLE SLOT whose process may be running or stopped. Only the
// definition (id/name/command/cwd) and a single lifecycle hint (`wasRunning`,
// captured at quit) are persisted; live process handles / running status / exit
// codes are runtime-only and live in the store, never serialized.

/** The on-disk schema version for the persisted terminals envelope. */
export const TASKS_VERSION = 1 as const;

/** The kind of a task: a shell `terminal` (runs a `command`) or a Claude `agent`
 *  (runs a `prompt`). Legacy entries with no kind are treated as terminals. */
export type TaskKind = 'terminal' | 'agent';

/** A user-created task definition (one slot in a project's panel stack). A
 *  `terminal` task runs a shell `command`; an `agent` task runs a Claude `prompt`
 *  (and carries `command: null`). */
export interface TaskDef {
  /** Stable unique id. */
  id: string;
  /** Human-readable label shown in the panel. */
  name: string;
  /** What this task runs: a shell `command` (`terminal`) or a Claude `prompt` (`agent`). */
  kind: TaskKind;
  /** Command line to run; `null` ⇒ the default login shell (or, for an agent, unused). */
  command: string | null;
  /** Working directory; `null` ⇒ the project's path at start time. */
  cwd: string | null;
  /** The Claude prompt for an `agent` task. Absent for `terminal` tasks. */
  prompt?: string;
  /** Whether a `terminal` task auto-closes its pane on a SUCCESSFUL exit (code 0).
   *  Absent ⇒ the default `true` (close). Stored ONLY when the user unticks the
   *  "Close automatically when complete" box (`false`) — a kept-open terminal stays
   *  as a stopped slot so its output remains readable. A non-zero (failed) exit
   *  always stays open regardless of this flag. */
  closeOnComplete?: boolean;
  /** Lifecycle hint captured at graceful quit: was this terminal running? Drives
   *  selective auto-restart on the next launch. Absent ⇒ treated as not-running. */
  wasRunning?: boolean;
  /** The command that was actively running at the last graceful quit (captured from
   *  the live terminal title), re-run on restore so a restored shell comes back to
   *  what it was doing. Absent ⇒ restore as a plain interactive shell. */
  lastCommand?: string;
}

/** Per-project terminal collections, keyed by `projectId`. */
export type TasksByProject = Record<string, TaskDef[]>;

/** The top-level persisted envelope written to `terminals.json`. */
export interface PersistedTasks {
  version: typeof TASKS_VERSION;
  projects: TasksByProject;
}

/** Cap on the displayed terminal name derived from a command (keeps the panel tidy). */
const NAME_MAX = 32;

/**
 * Default display name for a terminal: a whitespace-collapsed, length-capped form
 * of its command, or `shell` when there is no command (the default shell).
 */
export function defaultTaskName(command: string | null | undefined): string {
  const cmd = typeof command === 'string' ? command.trim().replace(/\s+/g, ' ') : '';
  if (cmd === '') return 'shell';
  return cmd.length > NAME_MAX ? `${cmd.slice(0, NAME_MAX - 1)}…` : cmd;
}

/**
 * Default display name for an `agent` task: a whitespace-collapsed, length-capped
 * form of its prompt (same shaping as {@link defaultTaskName}), or `agent` when the
 * prompt is empty.
 */
export function defaultAgentName(prompt: string | null | undefined): string {
  const text = typeof prompt === 'string' ? prompt.trim().replace(/\s+/g, ' ') : '';
  if (text === '') return 'agent';
  return text.length > NAME_MAX ? `${text.slice(0, NAME_MAX - 1)}…` : text;
}

/** Concrete spawn parameters for a terminal, resolved against its project path. */
export interface TaskSpawnSpec {
  /** Program to exec (always the user's shell — commands run through it). */
  program: string;
  /** Args: empty for an interactive shell; `['-lc', command]` for a command. */
  args: string[];
  /** Resolved working directory (the def's cwd, else the project path, else null). */
  cwd: string | null;
}

/**
 * The flags that make `shell` run a single command string and then exit.
 *
 * POSIX shells take `-lc <cmd>` (login + command), which loads PATH/profile
 * (nvm, etc.). PowerShell has no such flag — `-lc` matches no parameter and the
 * task dies immediately — so it gets `-Command`, and `cmd.exe` gets `/C`.
 *
 * PURE and exported so the mapping is unit-tested per shell family rather than
 * assumed.
 */
export function shellCommandFlags(shell: string): string[] {
  const name = (shell.split(/[/\\]/).pop() || shell).toLowerCase();
  if (name === 'cmd' || name === 'cmd.exe') return ['/C'];
  if (name === 'pwsh' || name === 'pwsh.exe' || name === 'powershell' || name === 'powershell.exe') {
    // -NoLogo keeps the banner out of the terminal; -Command must come last so
    // the command string is its argument.
    return ['-NoLogo', '-Command'];
  }
  return ['-lc'];
}

/**
 * Resolve a terminal's spawn parameters. A command runs through the user's shell
 * with that shell's run-a-command flags (see {@link shellCommandFlags}) so
 * PATH/profile are loaded and the full command line (pipes, env) works; when it
 * exits the shell exits, surfacing EOF so the terminal flips to stopped. A
 * null/blank command is an interactive shell. The cwd defaults to the project
 * path unless the def pins its own.
 */
export function taskSpawnSpec(
  def: TaskDef,
  projectPath: string | null,
  shell: string
): TaskSpawnSpec {
  const cwd = def.cwd ?? projectPath ?? null;
  const cmd = typeof def.command === 'string' ? def.command.trim() : '';
  if (cmd === '') return { program: shell, args: [], cwd };
  return { program: shell, args: [...shellCommandFlags(shell), cmd], cwd };
}

/** The terminals for `projectId` (empty array when the project has none). */
export function tasksForProject(
  map: TasksByProject,
  projectId: string
): TaskDef[] {
  return map[projectId] ?? [];
}

/** Append `def` to `projectId`'s collection (immutably). */
export function addTask(
  map: TasksByProject,
  projectId: string,
  def: TaskDef
): TasksByProject {
  const current = map[projectId] ?? [];
  return { ...map, [projectId]: [...current, def] };
}

/** Remove the terminal with id `id` from whichever project holds it (immutably). */
export function removeTask(map: TasksByProject, id: string): TasksByProject {
  const next: TasksByProject = {};
  for (const [projectId, list] of Object.entries(map)) {
    next[projectId] = list.filter((t) => t.id !== id);
  }
  return next;
}

/**
 * Move task `fromId` to the slot of `toId` WITHIN their shared project (drag-to-
 * reorder in the launcher) — the standard array-move keyed by id, so the manual
 * order the user arranges is reproduced 1:1.
 *
 * Pure: never mutates inputs. A no-op returning the SAME map reference (so callers
 * can cheaply detect "nothing changed") when either id is absent, the two tasks
 * belong to DIFFERENT projects, or they are the same task.
 */
export function reorderTask(
  map: TasksByProject,
  fromId: string,
  toId: string
): TasksByProject {
  if (fromId === toId) return map;
  // Reorder only within the single project that owns BOTH ids; cross-project drops
  // (and unknown ids) leave the map untouched.
  for (const [projectId, list] of Object.entries(map)) {
    const from = list.findIndex((t) => t.id === fromId);
    const to = list.findIndex((t) => t.id === toId);
    if (from < 0 || to < 0) continue;
    const next = [...list];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return { ...map, [projectId]: next };
  }
  return map;
}

/** Rename the terminal with id `id`. A blank/whitespace name is ignored (no-op). */
export function renameTask(
  map: TasksByProject,
  id: string,
  name: string
): TasksByProject {
  const clean = typeof name === 'string' ? name.trim() : '';
  if (clean === '') return map;
  return mapTasks(map, (t) => (t.id === id ? { ...t, name: clean } : t));
}

/** Map a transform over every terminal in every project (immutably). */
function mapTasks(
  map: TasksByProject,
  fn: (t: TaskDef) => TaskDef
): TasksByProject {
  const next: TasksByProject = {};
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
export function parseTasks(raw: string | null | undefined): TasksByProject {
  try {
    if (raw == null || raw.trim() === '') return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const projects = (parsed as { projects?: unknown }).projects;
    if (projects === null || typeof projects !== 'object' || Array.isArray(projects)) return {};
    const out: TasksByProject = {};
    for (const [projectId, list] of Object.entries(projects as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      const clean = list.map(normalize).filter((t): t is TaskDef => t !== null);
      if (clean.length > 0) out[projectId] = clean;
    }
    return out;
  } catch {
    return {};
  }
}

/** Coerce one persisted entry into a clean `TaskDef`, or `null` if unusable. */
function normalize(raw: unknown): TaskDef | null {
  if (raw === null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id === '') return null;
  const command = typeof r.command === 'string' ? r.command : null;
  const cwd = typeof r.cwd === 'string' ? r.cwd : null;
  // Legacy/old entries (and anything not exactly one of the two literals) default to
  // a terminal task — so a legacy terminals.json parses straight into terminal tasks.
  const kind: TaskKind = r.kind === 'agent' ? 'agent' : 'terminal';
  const name = typeof r.name === 'string' && r.name.trim() !== '' ? r.name : defaultTaskName(command);
  const def: TaskDef = { id: r.id, name, kind, command, cwd };
  if (typeof r.prompt === 'string') def.prompt = r.prompt;
  // Only `false` is meaningful (the opted-out keep-open choice); `true`/absent are
  // the default and stay unstored so the on-disk file stays tidy.
  if (r.closeOnComplete === false) def.closeOnComplete = false;
  if (typeof r.wasRunning === 'boolean') def.wasRunning = r.wasRunning;
  if (typeof r.lastCommand === 'string' && r.lastCommand.trim() !== '') {
    def.lastCommand = r.lastCommand;
  }
  return def;
}

/**
 * One-time migration: parse a legacy `terminals.json` payload (the old name for
 * this store, which has no `kind` field) into per-project collections with every
 * task `kind: 'terminal'`. Delegates to {@link parseTasks} — whose `normalize`
 * already defaults absent/unknown `kind` to `'terminal'` — but is exported under
 * its own name so the store can call it explicitly for the migration. ANY failure
 * collapses to empty collections — NEVER throws.
 */
export function importLegacyTasks(rawTerminalsJson: string | null | undefined): TasksByProject {
  return parseTasks(rawTerminalsJson);
}

/** Serialize collections into the persisted `{ version, projects }` envelope.
 *  Empty project buckets are dropped so the file stays tidy. */
export function serializeTasks(map: TasksByProject): string {
  const projects: TasksByProject = {};
  for (const [projectId, list] of Object.entries(map)) {
    if (list.length > 0) projects[projectId] = list;
  }
  const envelope: PersistedTasks = { version: TASKS_VERSION, projects };
  return JSON.stringify(envelope);
}

// ─── Per-project tasks file (`<project>/.agent-desktop/tasks.json`) ──────────
// A FLAT, single-project envelope `{ version, tasks: TaskDef[] }` that is the
// committed source of truth for one project. Unlike the user-level store, this
// file EXCLUDES the machine-local restore hints (`wasRunning`, `lastCommand`) —
// those describe one machine's live session at quit and must not be shared
// across checkouts.

/** The flat per-project persisted envelope written to `tasks.json`. */
export interface PersistedProjectTasks {
  version: typeof TASKS_VERSION;
  tasks: TaskDef[];
}

/**
 * Serialize one project's tasks into the flat `{ version, tasks }` envelope,
 * STRIPPING the machine-local restore hints (`wasRunning`, `lastCommand`) so the
 * committed file is portable. All other fields (`id`, `name`, `kind`, `command`,
 * `cwd`, `prompt`, `closeOnComplete`) are retained as-is. The array is serialized
 * verbatim — empty arrays are NOT dropped.
 */
export function serializeProjectTasks(defs: TaskDef[]): string {
  const tasks = defs.map((d) => {
    const { wasRunning: _wasRunning, lastCommand: _lastCommand, ...rest } = d;
    return rest as TaskDef;
  });
  const envelope: PersistedProjectTasks = { version: TASKS_VERSION, tasks };
  return JSON.stringify(envelope);
}

/**
 * Parse the flat per-project tasks JSON (or `null`/empty for "no file") into a
 * clean `TaskDef[]`. Accepts the `{ version, tasks: [...] }` envelope and reuses
 * the same {@link normalize} coercion as {@link parseTasks}. ANY failure
 * (null/empty/malformed/not-an-object/`tasks` not an array) collapses to `[]` —
 * NEVER throws.
 */
export function parseProjectTasks(raw: string | null | undefined): TaskDef[] {
  try {
    if (raw == null || raw.trim() === '') return [];
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    const tasks = (parsed as { tasks?: unknown }).tasks;
    if (!Array.isArray(tasks)) return [];
    return tasks.map(normalize).filter((t): t is TaskDef => t !== null);
  } catch {
    return [];
  }
}

// ─── Per-project config file (`<project>/.agent-desktop/config.json`) ────────

/** The on-disk schema version for the per-project config envelope. */
export const PROJECT_CONFIG_VERSION = 1 as const;

/** Per-project configuration. `autoWorktree` absent ⇒ defaults to `false`. */
export interface ProjectConfig {
  /** Whether new sessions in this project auto-create a git worktree. */
  autoWorktree?: boolean;
}

/**
 * Parse the per-project config JSON (or `null`/empty for "no file") into a clean
 * {@link ProjectConfig}. Accepts the `{ version, autoWorktree }` envelope and only
 * sets `autoWorktree` when it is a real boolean. ANY failure (absent/malformed/
 * not-an-object) collapses to `{}` (⇒ `autoWorktree` defaults false) — NEVER throws.
 */
export function parseProjectConfig(raw: string | null | undefined): ProjectConfig {
  try {
    if (raw == null || raw.trim() === '') return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const cfg: ProjectConfig = {};
    const autoWorktree = (parsed as { autoWorktree?: unknown }).autoWorktree;
    if (typeof autoWorktree === 'boolean') cfg.autoWorktree = autoWorktree;
    return cfg;
  } catch {
    return {};
  }
}

/**
 * Serialize a {@link ProjectConfig} into the versioned `{ version, ... }` envelope,
 * including `autoWorktree` ONLY when it is a boolean so an unset config stays tidy.
 */
export function serializeProjectConfig(cfg: ProjectConfig): string {
  const envelope: { version: typeof PROJECT_CONFIG_VERSION; autoWorktree?: boolean } = {
    version: PROJECT_CONFIG_VERSION
  };
  if (typeof cfg.autoWorktree === 'boolean') envelope.autoWorktree = cfg.autoWorktree;
  return JSON.stringify(envelope);
}
