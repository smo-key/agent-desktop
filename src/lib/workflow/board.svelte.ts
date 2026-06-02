// Runes store for the read-only Workflow board (workflow-board STAGE 2).
//
// It binds the board to the ACTIVE workspace's focused-pane cwd: that repo is the
// single subject of the board. On load it asks the Rust side to DETECT capability
// (`workflow_detect`, a pure fs probe — no spawn), and only if the repo is
// workflow-capable does it run the read-only scripts: `workflow_next(repo)` for the
// Markdown "next" view and `workflow_epics_list(repo)` for the epic list. All
// execution is read-only by construction (STAGE 1's allowlist); this store never
// issues a write verb and never auto-runs a slash command.
//
// State machine (per repo): one of
//   - 'idle'         no repo yet (store unseeded)
//   - 'detecting'    workflow_detect in flight
//   - 'incapable'    the repo has no /workflow tooling -> the board shows an empty
//                    state and runs NO script (spec: "shows no board")
//   - 'loading'      capable; the read scripts are in flight (initial or refresh)
//   - 'loaded'       data present (markdown + epics)
//   - 'error'        a script exited nonzero / bad output -> the structured
//                    WorkflowError is surfaced (auth/exit), NOT a blank board
//
// `refresh()` re-runs detection + the read scripts for the current repo, replacing
// the displayed data (spec: On-Demand Board Refresh). `setRepo(repo)` points the
// board at a new repo and loads it; calling it with the same repo is a refresh.
//
// A monotonic request token guards against races: if the repo changes (or a second
// refresh fires) while a load is in flight, the stale result is discarded so the
// board never shows data for the wrong repo. Tauri `invoke` is imported lazily and
// guarded so the store degrades gracefully outside a Tauri window (the pure
// view-model + grouping live in board-model.ts and are unit-tested separately).

import { parseEpics, type BoardEpic } from './board-model';

/** The coarse lifecycle state of the board for the current repo. */
export type BoardStatus =
  | 'idle'
  | 'detecting'
  | 'incapable'
  | 'loading'
  | 'loaded'
  | 'error';

/** Mirror of the Rust `Capability` (camelCase) returned by `workflow_detect`. */
export interface Capability {
  capable: boolean;
  hasCommands: boolean;
  hasSkills: boolean;
}

/**
 * Mirror of the Rust `WorkflowError` (camelCase). A rejected `invoke` of a
 * workflow command yields this object as the rejection reason; we keep it intact
 * so the UI can show the actionable `stderr` (e.g. the `ERROR: settings.local.json
 * not found …` / `ERROR: JIRA_USER_EMAIL or JIRA_API_TOKEN not found …` lines).
 */
export interface WorkflowError {
  kind: string;
  message: string;
  stderr?: string;
  exitCode?: number;
}

/** Coerce an unknown rejection reason into a `WorkflowError` for display. */
export function toWorkflowError(reason: unknown): WorkflowError {
  if (reason && typeof reason === 'object') {
    const r = reason as Record<string, unknown>;
    if (typeof r.kind === 'string' && typeof r.message === 'string') {
      return {
        kind: r.kind,
        message: r.message,
        stderr: typeof r.stderr === 'string' ? r.stderr : undefined,
        exitCode: typeof r.exitCode === 'number' ? r.exitCode : undefined
      };
    }
  }
  return {
    kind: 'spawn',
    message: reason instanceof Error ? reason.message : String(reason)
  };
}

/** Lazily-resolved Tauri `invoke`, or null when not running inside Tauri. */
async function tauriInvoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const mod = await import('@tauri-apps/api/core');
  return mod.invoke<T>(cmd, args);
}

/**
 * The reactive Workflow-board store. A single instance is exported as `board`.
 * It is driven by the route: an `$effect` keeps `setRepo` in sync with the focused
 * pane's cwd, and the title-bar Refresh button / Cmd-Shift-K call `refresh()`.
 */
export class BoardStore {
  /** The repo the board currently describes (focused-pane cwd), or null. */
  repo = $state<string | null>(null);

  /** Coarse lifecycle state (drives which surface the component renders). */
  status = $state<BoardStatus>('idle');

  /** Detection result for the current repo (null until detected). */
  capability = $state<Capability | null>(null);

  /** The verbatim Markdown stdout of `next.sh` (the "next" view), or null. */
  nextMarkdown = $state<string | null>(null);

  /** The parsed, tolerant epic list from `epics.sh list` (may be empty). */
  epics = $state<BoardEpic[]>([]);

  /** The structured error to surface when `status === 'error'`, else null. */
  error = $state<WorkflowError | null>(null);

  /**
   * Monotonic guard. Every load captures the current token; when it resolves it
   * only commits if the token is still current (the repo hasn't changed and no
   * newer refresh has superseded it). Prevents a slow stale load from clobbering
   * fresh data for a different repo.
   */
  #token = 0;

  /** Whether the board has data to show (markdown and/or epics). */
  get hasData(): boolean {
    return this.nextMarkdown !== null || this.epics.length > 0;
  }

  /** True while detection or a read-script load is in flight. */
  get isBusy(): boolean {
    return this.status === 'detecting' || this.status === 'loading';
  }

  /**
   * Point the board at `repo` and load it. If `repo` is the SAME as the current
   * one this is a refresh (re-detect + re-run the read scripts). A null/empty repo
   * resets the board to idle. Returns when the load settles (resolves even on a
   * surfaced error — errors are stored, not thrown).
   */
  async setRepo(repo: string | null): Promise<void> {
    const next = repo && repo.trim() !== '' ? repo : null;
    if (next === null) {
      this.#token += 1; // invalidate any in-flight load
      this.repo = null;
      this.status = 'idle';
      this.capability = null;
      this.nextMarkdown = null;
      this.epics = [];
      this.error = null;
      return;
    }
    this.repo = next;
    await this.#load(next);
  }

  /**
   * Re-run detection + the read-only scripts for the CURRENT repo and replace the
   * displayed data with the fresh results (spec: On-Demand Board Refresh). No-op
   * when no repo is set. Triggered by the Refresh button + Cmd-Shift-K.
   */
  async refresh(): Promise<void> {
    if (this.repo === null) return;
    await this.#load(this.repo);
  }

  /**
   * The core load: detect, then (only if capable) run the read scripts. Guarded by
   * the request token so a superseded load never commits. We do NOT clear the
   * previously-shown data up front — keeping it visible while a refresh runs avoids
   * a flash of empty board; it is replaced atomically once the new data arrives.
   */
  async #load(repo: string): Promise<void> {
    const token = ++this.#token;

    this.status = 'detecting';
    this.error = null;

    let cap: Capability;
    try {
      cap = await tauriInvoke<Capability>('workflow_detect', { repo });
    } catch (reason) {
      if (token !== this.#token) return;
      this.capability = null;
      this.error = toWorkflowError(reason);
      this.status = 'error';
      return;
    }
    if (token !== this.#token) return;
    this.capability = cap;

    // Not workflow-capable: render the empty state and run NO script
    // (spec: "does not render a Workflow board and does not attempt to run any
    // workflow script for that repo").
    if (!cap.capable) {
      this.nextMarkdown = null;
      this.epics = [];
      this.error = null;
      this.status = 'incapable';
      return;
    }

    this.status = 'loading';

    // Run the two read-only scripts. `next.sh` is the primary view; if IT fails
    // (auth/exit), surface the structured error instead of a blank board. The
    // epics list is best-effort: a capable repo may legitimately have no epics, and
    // a non-fatal epics failure should not hide an otherwise-good "next" view — so
    // a successful next + failed epics still renders (epics simply empty).
    let markdown: string;
    try {
      markdown = await tauriInvoke<string>('workflow_next', { repo, epic: null });
    } catch (reason) {
      if (token !== this.#token) return;
      this.error = toWorkflowError(reason);
      this.status = 'error';
      return;
    }
    if (token !== this.#token) return;

    let epics: BoardEpic[] = [];
    try {
      const raw = await tauriInvoke<unknown>('workflow_epics_list', { repo });
      epics = parseEpics(raw);
    } catch {
      // Best-effort: keep the (successful) next view; leave epics empty.
      epics = [];
    }
    if (token !== this.#token) return;

    // Commit atomically.
    this.nextMarkdown = markdown;
    this.epics = epics;
    this.error = null;
    this.status = 'loaded';
  }
}

/** The singleton board store, imported by the route + WorkflowBoard. */
export const board = new BoardStore();
