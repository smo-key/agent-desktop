// Reactive runes store for PROJECT TERMINALS (the right-docked Terminals panel).
// A thin wrapper over the PURE `projectTasks.ts` model: it holds the per-
// project definitions in `$state`, runs the model helpers over them, and persists
// via the Rust `tasks_load`/`tasks_save` commands (SAME atomic tmp+rename
// as projects, against a sibling `terminals.json`).
//
// LIFECYCLE MODEL: a terminal is a durable slot. Its RUNTIME state (the live
// PTY-bearing `paneId`, whether the process is up, and the last exit code) lives
// here in `runtime` keyed by terminal id and is NEVER serialized. The panel renders
// a `TerminalPane` (keyed by `runtime.paneId`) only while a terminal is running;
// stopping flips `running` false (the pane unmounts → its PTY is killed/reaped by
// TerminalPane.onDestroy), restarting allocates a fresh `paneId` (the `{#key}`
// remounts → a new PTY spawns). Because the panel chrome stays MOUNTED (hidden via
// CSS) while toggled off or showing another project, running PTYs survive a hide or
// project switch untouched.

import { invoke } from '@tauri-apps/api/core';
import { migrateToProjectFolders } from '../projects/migrateProjectFolders';
import {
  addTask,
  removeTask,
  renameTask,
  defaultTaskName,
  defaultAgentName,
  parseProjectTasks,
  serializeProjectTasks,
  tasksForProject,
  type TaskDef,
  type TaskKind,
  type TasksByProject
} from './projectTasks';

/** Runtime (never-persisted) state for one terminal slot. */
export interface TaskRuntime {
  /** The current PTY-bearing pane id; changes on each (re)start so `{#key}` remounts. */
  paneId: string;
  /** True while the child process is up. */
  running: boolean;
  /** Last exit code when the process exited on its own; null otherwise. */
  exitCode: number | null;
  /** Live terminal title (OSC 0/2) — the actively running command when the shell
   *  emits it; empty until one arrives. Drives the displayed name. */
  title: string;
  /** One-shot command to type+run after spawn (restore path), or undefined. */
  initialInput?: string;
}

/**
 * A TRANSIENT bare interactive shell (⌘T / launcher "Terminal" action) — a live
 * PTY pane that is NOT a persisted task def. It never touches `byProject` and is
 * never serialized; it lives only here for the lifetime of the session. Unlike a
 * terminal task, a bare shell stays in the list as a stopped slot when it exits
 * (even on a clean exit) — a different experience from a task.
 */
export interface BareTerminal {
  /** Stable unique id (process-local). */
  id: string;
  /** The project this bare shell belongs to. */
  projectId: string;
  /** The current PTY-bearing pane id; changes only via remove + relaunch. */
  paneId: string;
  /** True while the child process is up. */
  running: boolean;
  /** Last exit code when the process exited on its own; null otherwise. */
  exitCode: number | null;
  /** Live terminal title (OSC 0/2) — the actively running command; empty until one arrives. */
  title: string;
  /** One-shot command typed+run after spawn (e.g. a failed `git push` opened in a
   *  terminal), or undefined for a plain interactive shell. */
  initialInput?: string;
}

/** The user's interactive login shell (commands run through it). */
function loginShell(): string {
  const fromEnv = typeof process !== 'undefined' && process.env && process.env.SHELL;
  return fromEnv || '/bin/zsh';
}

/** The shell's basename (e.g. `/bin/zsh` → `zsh`) — the default name for a shell. */
function shellName(shell: string): string {
  return shell.split('/').pop() || shell;
}

/** Monotonic id factories (process-local). */
let termCounter = 0;
function nextTaskId(): string {
  termCounter += 1;
  return `term-${Date.now().toString(36)}-${termCounter.toString(36)}`;
}
let paneCounter = 0;
function nextPaneId(): string {
  paneCounter += 1;
  return `tpane-${Date.now().toString(36)}-${paneCounter.toString(36)}`;
}
let bareCounter = 0;
function nextBareId(): string {
  bareCounter += 1;
  return `bare-${Date.now().toString(36)}-${bareCounter.toString(36)}`;
}

/** The reactive project-terminals store. A single instance is exported below. */
export class ProjectTasksStore {
  /** Per-project terminal definitions. Deep-reactive via the runes proxy. */
  byProject = $state<TasksByProject>({});

  /** Runtime state keyed by terminal id (live pane id + running/exit). Not persisted. */
  runtime = $state<Record<string, TaskRuntime>>({});

  /** Transient bare interactive shells, keyed by project id. Not persisted, not task defs. */
  bareByProject = $state<Record<string, BareTerminal[]>>({});

  /** True once `load()` has resolved. */
  loaded = $state(false);

  /**
   * App-provided launcher for agent-kind tasks: opens a Claude session seeded with
   * the prompt. Injected so the store stays free of Svelte/workspace imports; null
   * until the app sets it.
   */
  agentLauncher: ((def: TaskDef, projectId: string) => void) | null = null;

  /** Set the injected launcher used to open a Claude session for an agent task. */
  setAgentLauncher(fn: (def: TaskDef, projectId: string) => void): void {
    this.agentLauncher = fn;
  }

  /**
   * App-provided accessor for the projects registry: resolves each project's id +
   * folder path so the store can read/write `<project>/.agent-desktop/tasks.json`.
   * Injected so the store does NOT import the projects store directly; null until set.
   */
  projectsAccessor: (() => Array<{ id: string; path: string }>) | null = null;

  /** Set the injected projects-registry accessor (id + path per project). */
  setProjectsAccessor(fn: () => Array<{ id: string; path: string }>): void {
    this.projectsAccessor = fn;
  }

  /** Project ids whose last per-project save FAILED (unwritable/missing folder).
   *  Retried at the start of the next `saveProject`. */
  private dirty = new Set<string>();

  /** Resolve a project's folder path from the injected accessor, or null. */
  private pathForProject(projectId: string): string | null {
    const list = this.projectsAccessor?.() ?? [];
    return list.find((p) => p.id === projectId)?.path ?? null;
  }

  /**
   * Injected handler fired when a terminal task COMPLETES SUCCESSFULLY (its command
   * exits with code 0), with the task's display name. The app wires this to a toast.
   * Injected so the store stays UI-free; null until the app sets it.
   */
  onTaskComplete: ((name: string) => void) | null = null;

  /** Set the injected success handler (the app shows a "<name> completed" toast). */
  setTaskCompleteHandler(fn: (name: string) => void): void {
    this.onTaskComplete = fn;
  }

  /** The user's login shell, resolved once. */
  readonly shell = loginShell();

  /** Terminals belonging to `projectId` (empty when none / null). */
  forProject(projectId: string | null): TaskDef[] {
    if (!projectId) return [];
    return tasksForProject(this.byProject, projectId);
  }

  /** Project ids that currently have at least one terminal (any state). */
  get projectIds(): string[] {
    return Object.keys(this.byProject).filter((id) => (this.byProject[id]?.length ?? 0) > 0);
  }

  /** True if the terminal `id` has a live process. */
  isRunning(id: string): boolean {
    return this.runtime[id]?.running === true;
  }

  /** The set of currently-running terminal ids. */
  runningIds(): Set<string> {
    const s = new Set<string>();
    for (const [id, rt] of Object.entries(this.runtime)) if (rt.running) s.add(id);
    return s;
  }

  /** Count of running terminals + bare shells across ALL projects (drives the toggle indicator). */
  get runningCount(): number {
    let n = 0;
    for (const rt of Object.values(this.runtime)) if (rt.running) n += 1;
    for (const list of Object.values(this.bareByProject)) {
      for (const b of list) if (b.running) n += 1;
    }
    return n;
  }

  /**
   * Load persisted definitions and seed the store. First runs the one-time
   * user-level → per-project-folder migration, then reads each project's
   * `<project>/.agent-desktop/tasks.json` via the injected projects accessor.
   * On ANY per-project failure that project is skipped (logged) — never throws.
   * NO terminal is auto-started: terminals always restore stopped. Call once on mount.
   */
  async load(): Promise<void> {
    await migrateToProjectFolders();
    const projects = this.projectsAccessor?.() ?? [];
    const next: TasksByProject = {};
    for (const { id, path } of projects) {
      try {
        const raw = await invoke<string | null>('project_tasks_load', { projectPath: path });
        const defs = parseProjectTasks(raw);
        if (defs.length > 0) next[id] = defs;
      } catch (err) {
        console.error('project_tasks_load failed', id, err);
      }
    }
    this.byProject = next;
    this.loaded = true;
  }

  /**
   * Create (register) a new task in `projectId` WITHOUT starting it — creation just
   * adds the def. A `terminal` task stores its `command`; an `agent` task stores its
   * `prompt` (and `command: null`). Returns the new task id; call `startTask` to run it.
   */
  async create(
    projectId: string,
    opts: {
      kind: TaskKind;
      command?: string | null;
      cwd?: string | null;
      prompt?: string;
      name?: string;
      closeOnComplete?: boolean;
    }
  ): Promise<string> {
    let def: TaskDef;
    if (opts.kind === 'agent') {
      const prompt = typeof opts.prompt === 'string' ? opts.prompt.trim() : '';
      def = {
        id: nextTaskId(),
        name: opts.name?.trim() || defaultAgentName(prompt),
        kind: 'agent',
        command: null,
        cwd: opts.cwd ?? null,
        prompt
      };
    } else {
      const command = opts.command && opts.command.trim() !== '' ? opts.command.trim() : null;
      def = {
        id: nextTaskId(),
        // A shell's default name is the shell basename (e.g. `zsh`); a command's is
        // the command. The live OSC title (the running command) overrides it at runtime.
        name: opts.name?.trim() || (command ? defaultTaskName(command) : shellName(this.shell)),
        kind: 'terminal',
        command,
        cwd: opts.cwd ?? null
      };
      // Persist the keep-open choice ONLY when the user opted out (false); the
      // default (close on success) is the absence of the flag.
      if (opts.closeOnComplete === false) def.closeOnComplete = false;
    }
    this.byProject = addTask(this.byProject, projectId, def);
    await this.saveProject(projectId);
    return def.id;
  }

  /**
   * Edit task `id`'s definition (name / kind / command / prompt) and persist. A kind
   * switch normalizes the payload: a `terminal` keeps `command` (prompt cleared); an
   * `agent` keeps `prompt` (command nulled). The running process, if any, is left
   * untouched — the change applies on the next run.
   */
  async update(
    id: string,
    fields: {
      name?: string;
      kind?: TaskKind;
      command?: string | null;
      prompt?: string;
      closeOnComplete?: boolean;
    }
  ): Promise<void> {
    let changed = false;
    let owningProjectId: string | null = null;
    const next: TasksByProject = {};
    for (const [projectId, list] of Object.entries(this.byProject)) {
      next[projectId] = list.map((t) => {
        if (t.id !== id) return t;
        changed = true;
        owningProjectId = projectId;
        const kind: TaskKind = fields.kind ?? t.kind;
        const name = fields.name?.trim() || t.name;
        if (kind === 'agent') {
          const prompt = (fields.prompt ?? t.prompt ?? '').trim();
          const upd: TaskDef = { ...t, kind: 'agent', name, command: null, prompt };
          // closeOnComplete is terminal-only — drop any residue when converting.
          delete upd.closeOnComplete;
          return upd;
        }
        const command =
          fields.command !== undefined
            ? fields.command && fields.command.trim() !== ''
              ? fields.command.trim()
              : null
            : t.command;
        const upd: TaskDef = { ...t, kind: 'terminal', name, command };
        delete upd.prompt;
        // Keep-open is stored only at its non-default (`false`); ticking the box
        // back on (`true`) clears the flag. Absent ⇒ preserve the prior choice.
        if (fields.closeOnComplete === false) upd.closeOnComplete = false;
        else if (fields.closeOnComplete === true) delete upd.closeOnComplete;
        return upd;
      });
    }
    if (changed) {
      this.byProject = next;
      if (owningProjectId) await this.saveProject(owningProjectId);
    }
  }

  /** The id of the project that holds task `id`, or null. */
  projectIdForTask(id: string): string | null {
    for (const [projectId, list] of Object.entries(this.byProject)) {
      if (list.some((t) => t.id === id)) return projectId;
    }
    return null;
  }

  /**
   * Start task `id`, dispatching by kind: a `terminal` allocates a fresh PTY pane in
   * the right panel (via `start`); an `agent` opens a Claude session via the injected
   * `agentLauncher` and gets NO right-panel runtime.
   */
  startTask(id: string): void {
    const def = this.defForId(id);
    if (!def) return;
    if (def.kind === 'agent') {
      const projectId = this.projectIdForTask(id);
      if (projectId) this.agentLauncher?.(def, projectId);
      return;
    }
    this.start(id);
  }

  /** Rename a terminal (blank ignored) and persist. */
  async rename(id: string, name: string): Promise<void> {
    const projectId = this.projectIdForTask(id);
    this.byProject = renameTask(this.byProject, id, name);
    if (projectId) await this.saveProject(projectId);
  }

  /** Remove a terminal entirely: stop its process, drop the def, persist. */
  async remove(id: string): Promise<void> {
    // Capture the owning project BEFORE the def is removed.
    const projectId = this.projectIdForTask(id);
    this.stop(id);
    delete this.runtime[id];
    this.byProject = removeTask(this.byProject, id);
    if (projectId) await this.saveProject(projectId);
  }

  /** The def with id `id` across all projects, or undefined. */
  defForId(id: string): TaskDef | undefined {
    for (const list of Object.values(this.byProject)) {
      const found = list.find((t) => t.id === id);
      if (found) return found;
    }
    return undefined;
  }

  /**
   * Start (or no-op if already running) the terminal `id` by allocating a live pane.
   * An optional `initialInput` command is typed+run once after spawn (restore path).
   */
  start(id: string, initialInput?: string): void {
    // Agent tasks never get a right-panel pane — they open a Claude session instead.
    if (this.defForId(id)?.kind === 'agent') return;
    if (this.runtime[id]?.running) return;
    const cmd = initialInput?.trim();
    this.runtime[id] = {
      paneId: nextPaneId(),
      running: true,
      exitCode: null,
      title: '',
      initialInput: cmd || undefined
    };
  }

  /**
   * Stop the terminal `id`: flip running false so the panel unmounts its
   * `TerminalPane`, whose onDestroy kills + reaps the PTY. The slot remains.
   */
  stop(id: string): void {
    const rt = this.runtime[id];
    if (!rt || !rt.running) return;
    this.runtime[id] = { ...rt, running: false };
  }

  /** Restart the terminal `id`: stop (if up) then start with a fresh pane id. */
  restart(id: string): void {
    this.stop(id);
    this.runtime[id] = { paneId: nextPaneId(), running: true, exitCode: null, title: '' };
  }

  /**
   * Record that terminal task `id`'s process exited on its own (EOF from the PTY).
   * A clean exit (code 0) CLOSES the terminal — its running pane is removed from the
   * right panel (the def stays in `byProject` as idle). A non-zero exit (failed)
   * stays as a stopped slot remembering the exit code, so the error is readable.
   */
  noteExit(id: string, code: number): void {
    const rt = this.runtime[id];
    if (!rt) return;
    if (code === 0) {
      // Success: announce completion (the app shows a "<name> completed" toast)
      // either way. Then, unless the user opted out via "Close automatically when
      // complete" (closeOnComplete === false), close the pane. When opted out, keep
      // it as a stopped, non-failed slot (exitCode 0) so its output stays readable.
      const def = this.defForId(id);
      if (def) this.onTaskComplete?.(this.displayName(def));
      if (def?.closeOnComplete === false) {
        this.runtime[id] = { ...rt, running: false, exitCode: 0 };
      } else {
        delete this.runtime[id];
      }
      return;
    }
    this.runtime[id] = { ...rt, running: false, exitCode: code };
  }

  /** True when task `id`'s pane is stopped with a non-zero exit code (a failure). */
  isFailed(id: string): boolean {
    const rt = this.runtime[id];
    return !!rt && !rt.running && rt.exitCode != null && rt.exitCode !== 0;
  }

  /** Clear task `id`'s pane from the right panel (failed/stopped) WITHOUT removing its def. */
  dismiss(id: string): void {
    delete this.runtime[id];
  }

  // --- Transient bare terminals (runtime-only, never persisted) ---------------

  /**
   * Launch a transient bare interactive shell in `projectId` (⌘T / launcher
   * "Terminal"). Adds a running {@link BareTerminal} with a fresh id + pane id and
   * returns its id. NOT persisted and NOT a task def. An optional `initialInput`
   * command is typed+run once after spawn (e.g. a failed `git push`/`git pull`
   * opened in a terminal); a blank/whitespace command leaves a plain shell.
   */
  launchBareTerminal(projectId: string, initialInput?: string): string {
    const cmd = initialInput?.trim();
    const bare: BareTerminal = {
      id: nextBareId(),
      projectId,
      paneId: nextPaneId(),
      running: true,
      exitCode: null,
      title: '',
      initialInput: cmd || undefined
    };
    const current = this.bareByProject[projectId] ?? [];
    this.bareByProject = { ...this.bareByProject, [projectId]: [...current, bare] };
    return bare.id;
  }

  /** The bare shell with id `id` (and its project bucket), or null. */
  private bareById(id: string): { projectId: string; bare: BareTerminal } | null {
    for (const [projectId, list] of Object.entries(this.bareByProject)) {
      const bare = list.find((b) => b.id === id);
      if (bare) return { projectId, bare };
    }
    return null;
  }

  /**
   * Record that bare shell `id`'s process exited. A clean exit (code 0) CLOSES the
   * terminal — the slot is removed. A non-zero exit stays as a stopped slot so the
   * error is readable (dismiss it with the × action).
   */
  noteBareExit(id: string, code: number): void {
    const found = this.bareById(id);
    if (!found) return;
    const { projectId } = found;
    if (code === 0) {
      this.removeBareTerminal(id);
      return;
    }
    this.bareByProject = {
      ...this.bareByProject,
      [projectId]: (this.bareByProject[projectId] ?? []).map((b) =>
        b.id === id ? { ...b, running: false, exitCode: code } : b
      )
    };
  }

  /** Record the live terminal title (OSC 0/2) for bare shell `id`. */
  noteBareTitle(id: string, title: string): void {
    const found = this.bareById(id);
    if (!found) return;
    const clean = title.trim();
    if (clean === '' || clean === found.bare.title) return;
    const { projectId } = found;
    this.bareByProject = {
      ...this.bareByProject,
      [projectId]: (this.bareByProject[projectId] ?? []).map((b) =>
        b.id === id ? { ...b, title: clean } : b
      )
    };
  }

  /** Drop the bare shell `id` from its project bucket. */
  removeBareTerminal(id: string): void {
    const found = this.bareById(id);
    if (!found) return;
    const { projectId } = found;
    this.bareByProject = {
      ...this.bareByProject,
      [projectId]: (this.bareByProject[projectId] ?? []).filter((b) => b.id !== id)
    };
  }

  /** The bare shells belonging to `projectId` (empty when none). */
  bareForProject(projectId: string): BareTerminal[] {
    return this.bareByProject[projectId] ?? [];
  }

  /** Record the live terminal title (OSC 0/2) for `id` — the running command. */
  noteTitle(id: string, title: string): void {
    const rt = this.runtime[id];
    if (!rt) return;
    const clean = title.trim();
    if (clean === '' || clean === rt.title) return;
    this.runtime[id] = { ...rt, title: clean };
  }

  /**
   * The name to display for terminal `id`: its live OSC title (the running command)
   * when present, else the persisted name (shell basename / command / user rename).
   */
  displayName(def: TaskDef): string {
    return this.runtime[def.id]?.title || def.name;
  }

  /**
   * Intentionally a NO-OP. Cross-restart auto-restart was dropped
   * (add-project-folder-storage): nothing machine-local is persisted, so there is
   * nothing to capture at quit. Kept so the `+page.svelte` close handler still
   * type-checks; terminals always restore stopped on the next launch.
   */
  async captureRunningAndSave(): Promise<void> {
    // no-op
  }

  /**
   * Persist ONE project's tasks to its `<project>/.agent-desktop/tasks.json`
   * (sanitized via `serializeProjectTasks`). First flushes any previously-failed
   * (dirty) projects. On failure: log, mark the project dirty, and do NOT throw —
   * the next save retries it. A project with no resolvable path stays dirty.
   */
  private async saveProject(projectId: string): Promise<void> {
    // Retry any previously-failed projects first (best-effort).
    for (const id of [...this.dirty]) {
      if (id === projectId) continue;
      await this.writeProject(id);
    }
    await this.writeProject(projectId);
  }

  /** Write a single project's tasks file; record/clear its dirty flag. */
  private async writeProject(projectId: string): Promise<void> {
    const path = this.pathForProject(projectId);
    if (!path) {
      // No resolvable folder yet — keep it dirty so a later save retries.
      this.dirty.add(projectId);
      return;
    }
    try {
      await invoke('project_tasks_save', {
        projectPath: path,
        json: serializeProjectTasks(this.byProject[projectId] ?? [])
      });
      this.dirty.delete(projectId);
    } catch (err) {
      console.error('project_tasks_save failed', projectId, err);
      this.dirty.add(projectId);
    }
  }
}

/** The singleton project-terminals store, imported by the panel + page chrome. */
export const projectTasks = new ProjectTasksStore();
