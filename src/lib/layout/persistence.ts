// Pure, framework-free layout persistence (design.md D8; layout-persistence spec).
//
// This module owns the SERIALIZE / RESTORE round-trip and the debounce
// scheduler. It is deliberately free of any Svelte/Tauri/DOM imports so it runs
// under the default (node) Vitest environment and can be unit-tested in full:
//   - `serializeState` snapshots all workspaces + each pane's spawn registry
//     ({program, cwd} ONLY — never live process state) into a JSON-able shape.
//   - `restoreState` parses that JSON, runs per-workspace `migrate()` +
//     `validateTree()` (re-asserting invariants + version-migrating), and
//     rebuilds the in-memory entries. ANY failure (missing file, bad JSON,
//     invariant violation, unmigratable version, empty list) falls back to a
//     single fresh `claude` workspace — it never throws.
//   - `respawnLeaves` walks the restored trees and calls an injected spawn fn
//     exactly once per leaf with that leaf's saved {program, cwd} — tmux-resurrect
//     semantics: shell + cwd only, no prior live process resurrected.
//   - `Debouncer` coalesces rapid writes into one and supports a synchronous
//     `flush()` for the on-quit path.
//
// The WIRING that connects this to the reactive store, the Tauri storage
// commands, and the window-close flush lives in `store-backend.svelte.ts`
// (which imports this module) — kept separate so this stays pure + testable.

import {
  freshWorkspace,
  leavesInOrder,
  migrate,
  type IdFactory,
  type Node,
  type Workspace
} from './tree';

/** The on-disk schema version for the WHOLE persisted state envelope. */
export const PERSIST_VERSION = 1 as const;

/** Spawn parameters recorded for a pane — the ONLY session state we persist. */
export interface PersistedSession {
  /** Program/shell to run in the re-spawned PTY (e.g. `claude` or `/bin/zsh`). */
  program: string;
  /** Working directory; `null` inherits the app cwd. */
  cwd: string | null;
  /**
   * OPTIONAL id of the project this pane was launched under. Persisted (unlike
   * `initialInput`) so an agent keeps its project identity / avatar across a
   * restart. Re-spawn ignores it (only program + cwd drive the PTY).
   */
  projectId?: string;
  /**
   * OPTIONAL app-owned Claude session id. Persisted for `claude` panes so the
   * pane can be resumed with `--resume <sessionId>` on restart, continuing from
   * its prior transcript. When absent in the serialized JSON (older saved state
   * or non-claude pane), `restoreState` assigns a NEW id and spawns fresh (no
   * resume). Present on the restored registry for every `claude` pane.
   */
  sessionId?: string;
  /**
   * Set on a RESTORED claude pane so its first spawn uses `--resume <sessionId>`
   * to continue the prior transcript, rather than starting a fresh session.
   * Absent on fresh launches, splits, and restored panes without a saved sessionId.
   * NOT serialized — it is only meaningful at runtime (cleared once the pane has
   * spawned and the transcript is already resumed).
   */
  resume?: boolean;
}

/** One serialized workspace: identity + name + its pane tree + its registry. */
export interface PersistedWorkspace {
  id: string;
  name: string;
  /** The full pane tree workspace ({version, root, focusedId}). */
  tree: Workspace;
  /** paneId -> {program, cwd} for every leaf in `tree`. */
  registry: Record<string, PersistedSession>;
}

/** The top-level persisted envelope written to the layout file. */
export interface PersistedState {
  version: typeof PERSIST_VERSION;
  workspaces: PersistedWorkspace[];
  activeWorkspaceId: string;
}

/**
 * The in-memory shape persistence works with. This mirrors the store's
 * `WorkspaceEntry` WITHOUT importing the runes module, so this file stays pure.
 * The store passes its entries in (structurally compatible) and receives these
 * back from `restoreState`.
 */
export interface RestoredWorkspace {
  id: string;
  name: string;
  ws: Workspace;
  registry: Record<string, PersistedSession>;
}

/** The result of a restore: the rebuilt entries + which one is active. */
export interface RestoredState {
  workspaces: RestoredWorkspace[];
  activeWorkspaceId: string;
}

// ---------------------------------------------------------------------------
// Serialize
// ---------------------------------------------------------------------------

/**
 * Snapshot all workspaces + the active selection into the JSON-able envelope.
 *
 * The registry is RE-PROJECTED to exactly `{program, cwd}` per pane, so any
 * extra live junk an in-memory registry might carry (pid/args/output buffers)
 * is dropped — "Live process state is not serialized". Only paneIds that a Leaf
 * in the tree actually references are kept (a stale registry entry for a
 * closed pane is not persisted).
 */
export function serializeState(
  entries: ReadonlyArray<RestoredWorkspace>,
  activeWorkspaceId: string
): PersistedState {
  return {
    version: PERSIST_VERSION,
    activeWorkspaceId,
    workspaces: entries.map((e) => ({
      id: e.id,
      name: e.name,
      tree: cloneWorkspace(e.ws),
      registry: projectRegistry(e.ws.root, e.registry)
    }))
  };
}

/** Deep-ish clone of a Workspace tree via structured JSON (it's plain data). */
function cloneWorkspace(ws: Workspace): Workspace {
  return JSON.parse(JSON.stringify(ws)) as Workspace;
}

/**
 * Build a registry containing `{program, cwd, projectId?, sessionId?}` for the
 * paneIds referenced by leaves in `root`. Missing entries default to a
 * login-shell-ish program so a re-spawn always has something to run.
 */
function projectRegistry(
  root: Node,
  registry: Record<string, PersistedSession>
): Record<string, PersistedSession> {
  const out: Record<string, PersistedSession> = {};
  for (const leafNode of leavesInOrder(root)) {
    const src = registry[leafNode.paneId];
    out[leafNode.paneId] = {
      program: src?.program ?? '/bin/zsh',
      cwd: src?.cwd ?? null,
      // Keep the project binding when present (omitted key serializes cleanly).
      ...(src?.projectId ? { projectId: src.projectId } : {}),
      // Persist the claude session id so the pane can resume the prior transcript
      // on restart (via `--resume <sessionId>`). Omit when absent so the JSON
      // stays clean for shell panes and older saved states that had no id.
      ...(src?.sessionId ? { sessionId: src.sessionId } : {})
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

/**
 * Restore the persisted state from raw JSON text (or `null`/empty for "no file").
 *
 * Per-workspace, the saved `tree` is run through `migrate()` (version-keyed
 * forward migration) and `validateTree()` (invariant re-assertion + repair).
 * ANY failure at any level — missing file, JSON parse error, wrong-shape
 * envelope, empty workspace list, an unmigratable/invalid per-workspace tree —
 * collapses to a single fresh `claude` workspace. This function NEVER throws.
 *
 * `newId` is the injected structural-id factory (tests pass a deterministic one;
 * production passes the store's process-global factory so ids never collide).
 */
export function restoreState(raw: string | null | undefined, newId: IdFactory): RestoredState {
  try {
    if (raw == null || raw.trim() === '') return fallback(newId);

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return fallback(newId);

    const list = parsed.workspaces;
    if (!Array.isArray(list)) return fallback(newId);
    // An explicitly-empty saved layout (the user closed every agent) restores to
    // NO workspaces — we honor that rather than fabricating a fresh agent.
    if (list.length === 0) return { workspaces: [], activeWorkspaceId: '' };

    const workspaces: RestoredWorkspace[] = list.map((w) => restoreWorkspace(w));

    // Resolve the active workspace: the saved id if present, else the first.
    const savedActive =
      typeof parsed.activeWorkspaceId === 'string' ? parsed.activeWorkspaceId : '';
    const activeWorkspaceId = workspaces.some((w) => w.id === savedActive)
      ? savedActive
      : workspaces[0].id;

    return { workspaces, activeWorkspaceId };
  } catch {
    // Any unmigratable/invalid/unparseable input -> fresh single-pane claude.
    return fallback(newId);
  }
}

/**
 * Restore a single workspace blob. `migrate()` throws on a corrupt/unmigratable
 * tree; we let that propagate to `restoreState`'s catch (whole-state fallback)
 * rather than silently dropping one workspace, matching the spec's
 * "Graceful Fallback On Corrupt State" (a fresh workspace, never a partial one).
 */
function restoreWorkspace(blob: unknown): RestoredWorkspace {
  if (!isRecord(blob)) throw new Error('restore: workspace is not an object');

  // `migrate` runs version-keyed forward steps then validateTree (which repairs
  // ratios, collapses <2-child splits, and repoints a dangling focusedId).
  const ws = migrate(blob.tree);

  const id = typeof blob.id === 'string' && blob.id ? blob.id : undefined;
  const name = typeof blob.name === 'string' && blob.name ? blob.name : undefined;
  if (!id) throw new Error('restore: workspace missing id');

  const registry = sanitizeRegistry(blob.registry, ws.root);

  return { id, name: name ?? 'Session', ws, registry };
}

/**
 * Re-project an untrusted registry blob into clean `{program, cwd}` entries,
 * keyed by the paneIds the validated tree actually references. A leaf with no
 * (or malformed) saved entry gets a login-shell default so it can still spawn.
 */
function sanitizeRegistry(
  blob: unknown,
  root: Node
): Record<string, PersistedSession> {
  const src = isRecord(blob) ? blob : {};
  const out: Record<string, PersistedSession> = {};
  for (const leafNode of leavesInOrder(root)) {
    const raw = src[leafNode.paneId];
    if (isRecord(raw)) {
      const program = typeof raw.program === 'string' ? raw.program : '/bin/zsh';
      // A persisted sessionId means we can resume the prior transcript on restart.
      // When present, carry it through and set resume:true so TerminalPane emits
      // `--resume <id>` instead of `--session-id <id>`.
      // When absent (older saved state / non-claude pane), generate a fresh id
      // (claude panes only) so the overview can locate the new transcript.
      const persistedSessionId =
        typeof raw.sessionId === 'string' && raw.sessionId ? raw.sessionId : undefined;
      const sessionId =
        program === 'claude' ? (persistedSessionId ?? crypto.randomUUID()) : undefined;
      const resume = program === 'claude' && !!persistedSessionId;
      out[leafNode.paneId] = {
        program,
        cwd: typeof raw.cwd === 'string' ? raw.cwd : null,
        ...(typeof raw.projectId === 'string' && raw.projectId
          ? { projectId: raw.projectId }
          : {}),
        ...(sessionId ? { sessionId } : {}),
        ...(resume ? { resume: true } : {})
      };
    } else {
      out[leafNode.paneId] = { program: '/bin/zsh', cwd: null };
    }
  }
  return out;
}

/** A fresh single-pane `claude` workspace, used for every fallback path. */
function fallback(newId: IdFactory): RestoredState {
  const paneId = `pane-${Math.random().toString(36).slice(2, 10)}`;
  const ws = freshWorkspace(paneId, newId);
  const id = `ws-${Math.random().toString(36).slice(2, 10)}`;
  return {
    workspaces: [
      {
        id,
        name: 'Session 1',
        ws,
        registry: { [paneId]: { program: 'claude', cwd: null, sessionId: crypto.randomUUID() } }
      }
    ],
    activeWorkspaceId: id
  };
}

// ---------------------------------------------------------------------------
// Re-spawn
// ---------------------------------------------------------------------------

/** Injected spawn callback: re-create one PTY for a leaf's pane. */
export type SpawnFn = (paneId: string, session: PersistedSession) => void;

/**
 * Re-spawn exactly one PTY per leaf, across all restored workspaces, using only
 * the saved `{program, cwd}` — tmux-resurrect semantics (no live state). Each
 * leaf's registry entry feeds `spawn(paneId, {program, cwd})` once; a leaf with
 * no registry entry falls back to a login shell so it still gets a PTY.
 */
export function respawnLeaves(
  workspaces: ReadonlyArray<RestoredWorkspace>,
  spawn: SpawnFn
): void {
  for (const w of workspaces) {
    for (const leafNode of leavesInOrder(w.ws.root)) {
      const s = w.registry[leafNode.paneId] ?? { program: '/bin/zsh', cwd: null };
      // Pass ONLY program + cwd (the leaf's saved session) — never any live
      // process state. The registry is already sanitized to those two keys.
      spawn(leafNode.paneId, { program: s.program, cwd: s.cwd });
    }
  }
}

// ---------------------------------------------------------------------------
// Debounce scheduler
// ---------------------------------------------------------------------------

/**
 * A trailing-edge debouncer: each `schedule()` (re)starts the timer; the action
 * runs once `delayMs` elapse with no further `schedule()`. `flush()` runs any
 * pending action IMMEDIATELY and cancels the timer (the on-quit path); `cancel()`
 * drops a pending action without running it.
 *
 * Uses `setTimeout`/`clearTimeout` so Vitest fake timers drive it
 * deterministically. The handle type is environment-agnostic (number in the
 * browser, Timeout in node) — we store it opaquely.
 */
export class Debouncer {
  private handle: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly action: () => void,
    private readonly delayMs: number = 250
  ) {}

  /** (Re)start the debounce window. Coalesces rapid calls into one action. */
  schedule(): void {
    if (this.handle !== null) clearTimeout(this.handle);
    this.handle = setTimeout(() => {
      this.handle = null;
      this.action();
    }, this.delayMs);
  }

  /** Run the pending action now (if any) and clear the timer. No-op if idle. */
  flush(): void {
    if (this.handle === null) return;
    clearTimeout(this.handle);
    this.handle = null;
    this.action();
  }

  /** Drop a pending action WITHOUT running it. */
  cancel(): void {
    if (this.handle === null) return;
    clearTimeout(this.handle);
    this.handle = null;
  }

  /** Whether an action is currently pending. */
  pending(): boolean {
    return this.handle !== null;
  }
}

// ---------------------------------------------------------------------------
// Small guards
// ---------------------------------------------------------------------------

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}
