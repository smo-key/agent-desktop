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
import {
  addTask,
  removeTask,
  renameTask,
  defaultTaskName,
  parseTasks,
  serializeTasks,
  tasksForProject,
  captureRunningState,
  autoRestartIds,
  type TaskDef,
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

/** The reactive project-terminals store. A single instance is exported below. */
export class ProjectTasksStore {
  /** Per-project terminal definitions. Deep-reactive via the runes proxy. */
  byProject = $state<TasksByProject>({});

  /** Runtime state keyed by terminal id (live pane id + running/exit). Not persisted. */
  runtime = $state<Record<string, TaskRuntime>>({});

  /** True once `load()` has resolved. */
  loaded = $state(false);

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

  /** Count of running terminals across ALL projects (drives the toggle indicator). */
  get runningCount(): number {
    let n = 0;
    for (const rt of Object.values(this.runtime)) if (rt.running) n += 1;
    return n;
  }

  /**
   * Load persisted definitions and seed the store. On ANY failure the collections
   * stay empty — never throws. Then auto-start exactly the terminals that were
   * running at the previous graceful quit (their `wasRunning` flag); all others are
   * restored as stopped. Call once on mount.
   */
  async load(): Promise<void> {
    let raw: string | null = null;
    try {
      raw = await invoke<string | null>('tasks_load');
    } catch (err) {
      console.error('tasks_load failed', err);
      raw = null;
    }
    this.byProject = parseTasks(raw);
    // Selective auto-restart: only previously-running terminals come up — and they
    // re-run the command they were running at quit (def.lastCommand), so a restored
    // shell comes back to what it was doing.
    for (const id of autoRestartIds(this.byProject)) {
      this.start(id, this.defForId(id)?.lastCommand);
    }
    this.loaded = true;
  }

  /**
   * Create a new terminal in `projectId` and start it (creation implies the user
   * wants it running now). Returns the new terminal id.
   */
  async create(
    projectId: string,
    opts: { command?: string | null; cwd?: string | null; name?: string } = {}
  ): Promise<string> {
    const command = opts.command && opts.command.trim() !== '' ? opts.command.trim() : null;
    const def: TaskDef = {
      id: nextTaskId(),
      // A shell's default name is the shell basename (e.g. `zsh`); a command's is
      // the command. The live OSC title (the running command) overrides it at runtime.
      name: opts.name?.trim() || (command ? defaultTaskName(command) : shellName(this.shell)),
      kind: 'terminal',
      command,
      cwd: opts.cwd ?? null
    };
    this.byProject = addTask(this.byProject, projectId, def);
    await this.save();
    this.start(def.id);
    return def.id;
  }

  /** Rename a terminal (blank ignored) and persist. */
  async rename(id: string, name: string): Promise<void> {
    this.byProject = renameTask(this.byProject, id, name);
    await this.save();
  }

  /** Remove a terminal entirely: stop its process, drop the def, persist. */
  async remove(id: string): Promise<void> {
    this.stop(id);
    delete this.runtime[id];
    this.byProject = removeTask(this.byProject, id);
    await this.save();
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
   * Record that the terminal `id`'s process exited on its own (EOF from the PTY).
   * Flips it to stopped and remembers the exit code; the slot is NOT removed.
   */
  noteExit(id: string, code: number): void {
    const rt = this.runtime[id];
    if (!rt) return;
    this.runtime[id] = { ...rt, running: false, exitCode: code };
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
   * Capture each terminal's current running state into its persisted `wasRunning`
   * flag and persist — called at graceful quit so the next launch can selectively
   * auto-restart. Synchronous flush so it completes before the window closes.
   */
  async captureRunningAndSave(): Promise<void> {
    const info: Record<string, { running: boolean; title?: string }> = {};
    for (const [id, rt] of Object.entries(this.runtime)) {
      info[id] = { running: rt.running, title: rt.title };
    }
    this.byProject = captureRunningState(this.byProject, info);
    await this.save();
  }

  /** Persist the current definitions via the Rust `tasks_save` command. */
  private async save(): Promise<void> {
    try {
      await invoke('tasks_save', { json: serializeTasks(this.byProject) });
    } catch (err) {
      console.error('tasks_save failed', err);
    }
  }
}

/** The singleton project-terminals store, imported by the panel + page chrome. */
export const projectTasks = new ProjectTasksStore();
