// Runes-based workspace store: the single source of truth for ALL open
// workspaces (the "session rail" tabs). Each workspace is an independent
// {id, name, ws(tree), registry} entry; one is "active" at a time. Every
// structural mutation delegates to the PURE ops in `tree.ts` (which never mutate
// inputs and always return a new tree), then commits the result back into the
// active entry's reactive `$state`. The registry tells `PaneNode` which
// program/cwd to spawn for each leaf's `TerminalPane`.
//
// Multiple workspaces, one rail: the rail lists every entry; switching just
// flips `activeWorkspaceId`. The view keeps EVERY workspace's PaneNode mounted
// (inactive ones hidden with display:none) so their xterm instances + PTYs
// survive a switch untouched — only the active workspace's focused leaf gets a
// WebGL context (respecting the browser's ~16-context ceiling).
//
// Why a registry separate from the tree: the tree is the serializable topology
// (paneId is its only link to a terminal); the registry carries the spawn
// parameters that are NOT part of the topology (program + cwd). Persistence
// (task 4.x) serializes exactly `{ workspaces: [...], activeWorkspaceId }`.

import {
  freshWorkspace,
  splitLeaf,
  closeLeaf,
  focusCyclic,
  focusDirectional,
  resizeAdjacent,
  findLeaf,
  leavesInOrder,
  type Workspace,
  type Node,
  type Direction,
  type SplitWhere,
  type CyclicDir,
  type SpatialDir,
  type Rect
} from './tree';

/** Spawn parameters for a single pane, keyed by `paneId` in the registry. */
export interface PaneSession {
  /** Program to run in the PTY (e.g. `claude`, or the login shell). */
  program: string;
  /** Working directory for the child; `null` inherits the app cwd. */
  cwd: string | null;
  /**
   * OPTIONAL one-shot initial prompt delivered to this pane's PTY VERBATIM, once,
   * right after spawn (session-launcher). It is a LAUNCH-TIME value only: it is
   * NOT persisted (the serializer re-projects the registry to {program, cwd}) and
   * never re-sent — `TerminalPane`'s `InitialInputSender` latches on first mount.
   * Absent for every pane except one freshly created by the launcher.
   */
  initialInput?: string;
  /**
   * OPTIONAL id of the PROJECT this pane was launched under (its identity becomes
   * the agent's avatar / project-panel grouping). Recorded EXPLICITLY at launch
   * and PERSISTED (unlike `initialInput`); never inferred. Absent for panes not
   * launched under a project (e.g. split shells, restored pre-projects sessions).
   */
  projectId?: string;
  /**
   * The APP-OWNED Claude session id for a `claude` pane (a uuid generated when the
   * pane is created, or carried over from a persisted save). Passed to claude as
   * `--session-id` (fresh) or `--resume` (restored with resume:true) and used by
   * the overview to locate THIS agent's EXACT transcript
   * (`~/.claude/projects/<cwd>/<id>.jsonl`) — matching by cwd alone is ambiguous
   * when several sessions share a folder. Absent for non-claude (shell) panes.
   */
  sessionId?: string;
  /**
   * Set on a RESTORED claude pane so its first spawn uses `--resume <sessionId>`
   * to continue the prior transcript, rather than starting a fresh session.
   * Absent (falsey) for fresh launches, splits, and restored panes without a
   * saved sessionId (older saved state falls back to a fresh session).
   */
  resume?: boolean;
}

/** A fresh Claude session id for a `claude` pane (so the app owns it and can find
 *  the agent's exact transcript), else `undefined` for non-claude panes. */
function claudeSessionId(program: string): string | undefined {
  return program === 'claude' ? crypto.randomUUID() : undefined;
}

/**
 * One workspace ("session" tab in the rail): a stable id, a display name, its
 * own pane tree + focus (`ws`), and its own paneId -> spawn-params registry.
 * Workspaces are fully independent; nothing is shared between them.
 */
export interface WorkspaceEntry {
  /** Stable identity for the workspace (rail key, never reused). */
  id: string;
  /** User-facing label shown in the rail; renameable. */
  name: string;
  /** This workspace's live pane tree + focus. Deep-reactive via the proxy. */
  ws: Workspace;
  /** paneId -> spawn parameters for the panes in THIS workspace. */
  registry: Record<string, PaneSession>;
}

/** The login shell for new (split) panes: honor $SHELL, else /bin/zsh. */
function loginShell(): string {
  // import.meta.env is statically replaced; process may be undefined in the
  // webview, so read defensively. SHELL is the user's interactive shell.
  const fromEnv =
    typeof process !== 'undefined' && process.env && process.env.SHELL;
  return fromEnv || '/bin/zsh';
}

/** A monotonic, process-local id factory for fresh paneIds. */
let paneCounter = 0;
function nextPaneId(): string {
  paneCounter += 1;
  return `pane-${Date.now().toString(36)}-${paneCounter.toString(36)}`;
}

/**
 * A monotonic id factory for fresh structural node ids (Leaf/Split `id`s).
 * Process-GLOBAL so node ids are unique ACROSS workspaces — critical because
 * every workspace stays mounted at once and the rect map (directional focus) is
 * keyed by leaf id, which must not collide between two live workspaces.
 */
let nodeCounter = 0;
function nextNodeId(): string {
  nodeCounter += 1;
  return `node-${Date.now().toString(36)}-${nodeCounter.toString(36)}`;
}

/** A monotonic id factory for fresh workspace ids. */
let wsCounter = 0;
function nextWorkspaceId(): string {
  wsCounter += 1;
  return `ws-${Date.now().toString(36)}-${wsCounter.toString(36)}`;
}

/**
 * Build a brand-new workspace entry containing a single leaf running `program`
 * in `cwd`. Uses the global node-id factory so leaf/split ids never collide with
 * other live workspaces.
 */
function makeEntry(
  name: string,
  program: string,
  cwd: string | null,
  paneId: string = nextPaneId(),
  initialInput?: string,
  projectId?: string
): WorkspaceEntry {
  return {
    id: nextWorkspaceId(),
    name,
    ws: freshWorkspace(paneId, nextNodeId),
    registry: {
      [paneId]: { program, cwd, initialInput, projectId, sessionId: claudeSessionId(program) }
    }
  };
}

/**
 * The reactive workspace store. A single instance is exported as `workspace`
 * below. It holds the full list of workspaces plus the active selection; the
 * per-pane actions (`split`, `closeFocused`, `focus*`, `resize`, ...) all act on
 * the ACTIVE workspace, so existing consumers (PaneNode/Gutter/route) keep
 * working unchanged against `workspace.root` / `workspace.focusedId`.
 */
export class WorkspaceStore {
  /** All open workspaces, in rail order. Deep-reactive via the runes proxy. */
  workspaces = $state<WorkspaceEntry[]>([]);

  /** The id of the active (rendered/interactive) workspace. */
  activeWorkspaceId = $state<string>('');

  /** True while a gutter drag is in progress; panes defer xterm `fit()`. */
  dragging = $state(false);

  // ---- Active-workspace convenience accessors ------------------------------

  /** The active workspace entry, or `undefined` before `init`. */
  get active(): WorkspaceEntry | undefined {
    return this.workspaces.find((w) => w.id === this.activeWorkspaceId);
  }

  /** The active workspace's live root node. */
  get root(): Node {
    return this.requireActive().ws.root;
  }

  /** The active workspace's focused leaf id. */
  get focusedId(): string {
    return this.requireActive().ws.focusedId;
  }

  /** Internal: the active entry, asserting it exists (post-init). */
  private requireActive(): WorkspaceEntry {
    const a = this.active;
    if (!a) throw new Error('WorkspaceStore: no active workspace (call init first)');
    return a;
  }

  /** Commit a new `Workspace` tree back into the active entry. */
  private commitActive(ws: Workspace) {
    const entry = this.active;
    if (entry) entry.ws = ws;
  }

  /**
   * The spawn params for a pane in the ACTIVE workspace, or a sane default
   * (login shell). PaneNode reads this per leaf to spawn its TerminalPane.
   */
  session(paneId: string): PaneSession {
    return this.active?.registry[paneId] ?? { program: loginShell(), cwd: null };
  }

  /** Whether a workspace has any panes whose PTY is presumed live. */
  hasPanes(id: string): boolean {
    const entry = this.workspaces.find((w) => w.id === id);
    return entry ? leavesInOrder(entry.ws.root).length > 0 : false;
  }

  // ---- Per-workspace accessors (for the mounted-but-inactive trees) ---------
  // Every workspace stays mounted at once, so PaneNode is rendered per-workspace
  // and must resolve session/focus against ITS OWN workspace, not the active
  // one. These take an explicit workspace id.

  /** The session for `paneId` within workspace `wsId` (default login shell). */
  sessionIn(wsId: string, paneId: string): PaneSession {
    const entry = this.workspaces.find((w) => w.id === wsId);
    return entry?.registry[paneId] ?? { program: loginShell(), cwd: null };
  }

  /** The focused leaf id within workspace `wsId` ('' if unknown). */
  focusedIdIn(wsId: string): string {
    const entry = this.workspaces.find((w) => w.id === wsId);
    return entry ? entry.ws.focusedId : '';
  }

  /**
   * Set focus to leaf `id` within workspace `wsId`. If that workspace is not the
   * active one, activate it first (clicking a pane in a hidden workspace would
   * never happen — they're display:none — but this keeps the semantics sound).
   */
  setFocusIn(wsId: string, id: string) {
    if (wsId !== this.activeWorkspaceId) this.setActiveWorkspace(wsId);
    const entry = this.workspaces.find((w) => w.id === wsId);
    if (!entry) return;
    if (id === entry.ws.focusedId) return;
    if (!findLeaf(entry.ws.root, id)) return;
    entry.ws = { ...entry.ws, focusedId: id };
  }

  // ---- Workspace (rail) actions --------------------------------------------

  /**
   * Create a new workspace with a single leaf and switch to it. Defaults to a
   * `claude` session inheriting the active pane's cwd (so a new session lands in
   * the same project by default); pass `program`/`cwd` to override. Returns the
   * new workspace id.
   */
  newWorkspace(
    program: string = 'claude',
    cwd: string | null = this.activeCwd(),
    initialInput?: string,
    projectId?: string
  ): string {
    const name = this.nextSessionName();
    const entry = makeEntry(name, program, cwd, nextPaneId(), initialInput, projectId);
    this.workspaces = [...this.workspaces, entry];
    this.activeWorkspaceId = entry.id;
    return entry.id;
  }

  /**
   * Close a workspace by id. Closing the LAST workspace is allowed — the app's
   * primary surface is the overview, and an empty workspace list is a valid state
   * (its empty state, no fabricated agent). When the closed workspace was active,
   * activation moves to a neighbor (next, else prev, else none). Callers that want
   * a "this has live panes — confirm?" gate should consult `hasPanes(id)` first;
   * this method itself just removes the entry (its TerminalPanes unmount, killing
   * their PTYs in order).
   */
  closeWorkspace(id: string) {
    const idx = this.workspaces.findIndex((w) => w.id === id);
    if (idx < 0) return;

    const wasActive = this.activeWorkspaceId === id;
    const next = this.workspaces.filter((w) => w.id !== id);
    this.workspaces = next;

    if (wasActive) {
      // Activate the entry that now occupies the closed slot, else the new last,
      // else none (the list is now empty — the overview's empty state shows).
      const fallback = next[Math.min(idx, next.length - 1)];
      this.activeWorkspaceId = fallback ? fallback.id : '';
    }
  }

  /** Switch the active workspace. No-op if `id` is unknown or already active. */
  setActiveWorkspace(id: string) {
    if (id === this.activeWorkspaceId) return;
    if (!this.workspaces.some((w) => w.id === id)) return;
    this.activeWorkspaceId = id;
  }

  /** Rename a workspace. Empty/whitespace names are ignored (keep the old one). */
  renameWorkspace(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const entry = this.workspaces.find((w) => w.id === id);
    if (entry) entry.name = trimmed;
  }

  // ---- Pane actions (operate on the ACTIVE workspace) ----------------------

  /**
   * Register a fresh pane id + its spawn params in the ACTIVE workspace,
   * returning the id. New split panes default to the login shell, inheriting the
   * focused pane's cwd so a split lands "next to" you in the same directory.
   */
  spawnPaneId(
    program: string = loginShell(),
    cwd: string | null = null,
    initialInput?: string,
    projectId?: string
  ): string {
    const entry = this.requireActive();
    const id = nextPaneId();
    entry.registry = {
      ...entry.registry,
      [id]: { program, cwd, initialInput, projectId, sessionId: claudeSessionId(program) }
    };
    return id;
  }

  /**
   * Split the focused leaf in `direction`, placing the new pane `where`
   * (default 'after' = right/below). The new pane runs the login shell in the
   * focused pane's cwd; focus moves to the new pane.
   */
  split(direction: Direction, where: SplitWhere = 'after') {
    const entry = this.active;
    if (!entry) return;
    const focusedLeaf = findLeaf(entry.ws.root, entry.ws.focusedId);
    if (!focusedLeaf) return;
    const inheritCwd = entry.registry[focusedLeaf.paneId]?.cwd ?? null;
    const newPaneId = this.spawnPaneId(loginShell(), inheritCwd);

    const root = splitLeaf(
      entry.ws.root,
      entry.ws.focusedId,
      direction,
      newPaneId,
      where,
      nextNodeId
    );

    // Focus the newly created leaf (the only leaf whose paneId is newPaneId).
    const newLeaf = leafByPaneId(root, newPaneId);
    this.commitActive({
      version: 1,
      root,
      focusedId: newLeaf ? newLeaf.id : entry.ws.focusedId
    });
  }

  /**
   * Split the focused leaf in `direction` (placing the new pane `where`), where
   * the NEW pane runs `program` in `cwd` with an OPTIONAL one-shot `initialInput`
   * — instead of the login-shell default `split` uses. The existing focused
   * pane's terminal is NOT remounted (only a new leaf is grafted in beside it);
   * focus moves to the new pane. Returns the new pane's `paneId`, or `null` when
   * there is no focused leaf to split. Used by the launcher's split placements.
   */
  splitWith(
    direction: Direction,
    program: string,
    cwd: string | null,
    initialInput?: string,
    where: SplitWhere = 'after',
    projectId?: string
  ): string | null {
    const entry = this.active;
    if (!entry) return null;
    if (!findLeaf(entry.ws.root, entry.ws.focusedId)) return null;
    const newPaneId = this.spawnPaneId(program, cwd, initialInput, projectId);

    const root = splitLeaf(
      entry.ws.root,
      entry.ws.focusedId,
      direction,
      newPaneId,
      where,
      nextNodeId
    );

    const newLeaf = leafByPaneId(root, newPaneId);
    this.commitActive({
      version: 1,
      root,
      focusedId: newLeaf ? newLeaf.id : entry.ws.focusedId
    });
    return newPaneId;
  }

  /**
   * Execute a launcher launch plan: spawn a `claude` session in `plan.cwd` with
   * the optional verbatim `plan.initialInput`, placed per `plan.placement`:
   *
   *  - `'tab'`         -> a brand-new workspace whose single leaf runs the session.
   *  - `'split-right'` -> split the focused pane along a row (new pane to the right).
   *  - `'split-down'`  -> split the focused pane along a column (new pane below).
   *
   * A split with no focused pane (empty/uninitialized) falls back to a new tab so
   * the launch always succeeds. The existing spawn path (TerminalPane) applies the
   * `--settings` wrapper override + AGENT_DESKTOP_PANE/SNAPSHOT_DIR env for any
   * `claude` pane — this method does NOT duplicate that logic; it only records the
   * pane's {program:'claude', cwd, initialInput} in the registry and lets the
   * pane's mount spawn it. Returns the new pane's `paneId`.
   */
  launch(plan: {
    program: 'claude';
    cwd: string;
    placement: 'tab' | 'split-right' | 'split-down';
    initialInput?: string;
    projectId?: string;
  }): string {
    const { program, cwd, initialInput, projectId } = plan;
    // A split needs a focused leaf in the active workspace; otherwise open a tab.
    const canSplit = this.focusedPaneId !== null;
    const placement =
      plan.placement !== 'tab' && !canSplit ? 'tab' : plan.placement;

    if (placement === 'tab') {
      this.newWorkspace(program, cwd, initialInput, projectId);
      return this.focusedPaneId ?? '';
    }

    const direction: Direction = placement === 'split-right' ? 'row' : 'col';
    const newPaneId = this.splitWith(
      direction,
      program,
      cwd,
      initialInput,
      'after',
      projectId
    );
    return newPaneId ?? '';
  }

  /**
   * Close the focused leaf of the ACTIVE workspace. Closing the only pane is a
   * no-op (the pure op guards this). Focus is resolved to an in-order neighbor
   * by the pure op. The closed pane's registry entry is pruned once no leaf
   * references it.
   */
  closeFocused() {
    const entry = this.active;
    if (!entry) return;
    const closing = findLeaf(entry.ws.root, entry.ws.focusedId);
    const nextWs = closeLeaf(entry.ws, entry.ws.focusedId);
    entry.ws = nextWs;
    // Prune the registry entry for the removed pane, unless something still
    // references its paneId (the only-leaf close is a no-op, so the pane
    // survives and we correctly skip pruning). paneIds are unique per leaf.
    if (closing && !leafByPaneId(nextWs.root, closing.paneId)) {
      const { [closing.paneId]: _removed, ...rest } = entry.registry;
      entry.registry = rest;
    }
  }

  /** Cyclic focus +1 (wraps). */
  focusNext() {
    const entry = this.active;
    if (!entry) return;
    this.setFocus(focusCyclic(entry.ws.root, entry.ws.focusedId, 'next'));
  }

  /** Cyclic focus -1 (wraps). */
  focusPrev() {
    const entry = this.active;
    if (!entry) return;
    this.setFocus(focusCyclic(entry.ws.root, entry.ws.focusedId, 'prev'));
  }

  /** Cyclic focus in an explicit direction. */
  focusCyclic(dir: CyclicDir) {
    const entry = this.active;
    if (!entry) return;
    this.setFocus(focusCyclic(entry.ws.root, entry.ws.focusedId, dir));
  }

  /**
   * Directional (spatial) focus using a caller-provided rect map (leafId ->
   * pixel Rect). No-op when there's no neighbor in that direction.
   */
  focusDirectional(dir: SpatialDir, rects: Map<string, Rect>) {
    const entry = this.active;
    if (!entry) return;
    this.setFocus(focusDirectional(entry.ws.root, entry.ws.focusedId, dir, rects));
  }

  /** Set focus to a specific leaf id in the active workspace (e.g. a click). */
  setFocus(id: string) {
    const entry = this.active;
    if (!entry) return;
    if (id === entry.ws.focusedId) return;
    if (!findLeaf(entry.ws.root, id)) return;
    entry.ws = { ...entry.ws, focusedId: id };
  }

  /**
   * Adjust a gutter in the ACTIVE workspace: move the boundary between children
   * `gutterIndex` and `gutterIndex+1` of `splitId` by `deltaRatio`. Delegates to
   * the pure op (sum-conserving, clamped); commits the new root.
   */
  resize(splitId: string, gutterIndex: number, deltaRatio: number) {
    const entry = this.active;
    if (!entry) return;
    const root = resizeAdjacent(entry.ws.root, splitId, gutterIndex, deltaRatio);
    entry.ws = { ...entry.ws, root };
  }

  /**
   * Adjust a gutter in an EXPLICIT workspace. Gutters live inside a workspace's
   * tree, so they target their own workspace by id rather than "the active one".
   */
  resizeIn(wsId: string, splitId: string, gutterIndex: number, deltaRatio: number) {
    const entry = this.workspaces.find((w) => w.id === wsId);
    if (!entry) return;
    const root = resizeAdjacent(entry.ws.root, splitId, gutterIndex, deltaRatio);
    entry.ws = { ...entry.ws, root };
  }

  /** Set the global drag flag (panes defer `fit()` while true). */
  setDragging(active: boolean) {
    this.dragging = active;
  }

  // ---- Pane-id lookup (usage dashboard) ------------------------------------
  // Snapshots key on the frontend `paneId` (== `AGENT_DESKTOP_PANE`), so the
  // usage bar resolves a snapshot back to its leaf to read focus / activate it.

  /**
   * The `paneId` of the active workspace's focused leaf, or null before init /
   * when the focus can't be resolved. The usage bar reads this to pick which
   * pane's git fills the bottom row.
   */
  get focusedPaneId(): string | null {
    const entry = this.active;
    if (!entry) return null;
    const leaf = findLeaf(entry.ws.root, entry.ws.focusedId);
    return leaf ? leaf.paneId : null;
  }

  /**
   * The union of every pane id across ALL open workspaces (each workspace's
   * registry keys). This is the set of panes the app still owns; the usage store
   * prunes any snapshot whose pane_id is NOT in this set (a closed pane's ghost).
   * Reading `workspaces` (and each `registry`) makes a caller's `$effect` re-run
   * whenever a pane is added/removed or a workspace changes.
   */
  allPaneIds(): Set<string> {
    const ids = new Set<string>();
    for (const entry of this.workspaces) {
      for (const paneId of Object.keys(entry.registry)) ids.add(paneId);
    }
    return ids;
  }

  /**
   * Best-effort focus/activate the pane carrying `paneId` (clicking a session
   * card). Searches every workspace for a leaf with that paneId; if found,
   * activates that workspace (if needed) and focuses the leaf. No-op when the
   * pane no longer exists (its session may have ended) — never throws.
   */
  focusPane(paneId: string): void {
    for (const entry of this.workspaces) {
      const leaf = leafByPaneId(entry.ws.root, paneId);
      if (leaf) {
        this.setFocusIn(entry.id, leaf.id);
        return;
      }
    }
  }

  /**
   * Close the agent in pane `paneId` wherever it lives (used by the overview's
   * agent context menu). If its workspace has OTHER panes, close just that leaf
   * (its TerminalPane unmounts, killing the PTY); if it is the ONLY pane, close
   * the whole workspace (subject to the last-workspace guard in `closeWorkspace`).
   * No-op when the pane no longer exists. Never throws.
   */
  closeAgent(paneId: string): void {
    for (const entry of this.workspaces) {
      const leaf = leafByPaneId(entry.ws.root, paneId);
      if (!leaf) continue;
      if (leavesInOrder(entry.ws.root).length > 1) {
        // More than one pane here: remove just this leaf + prune its registry entry.
        entry.ws = closeLeaf(entry.ws, leaf.id);
        if (!leafByPaneId(entry.ws.root, paneId)) {
          const { [paneId]: _removed, ...rest } = entry.registry;
          entry.registry = rest;
        }
      } else {
        // The only pane in its workspace: close the whole workspace.
        this.closeWorkspace(entry.id);
      }
      return;
    }
  }

  // ---- Internal helpers ----------------------------------------------------

  /** The cwd of the active workspace's focused pane (for new-session inherit). */
  private activeCwd(): string | null {
    const entry = this.active;
    if (!entry) return null;
    const leaf = findLeaf(entry.ws.root, entry.ws.focusedId);
    if (!leaf) return null;
    return entry.registry[leaf.paneId]?.cwd ?? null;
  }

  /** A unique-ish default name like "Session N" for the next new workspace. */
  private nextSessionName(): string {
    let n = this.workspaces.length + 1;
    const taken = new Set(this.workspaces.map((w) => w.name));
    while (taken.has(`Session ${n}`)) n += 1;
    return `Session ${n}`;
  }

  // ---- Persistence bridge (task 4.x) ---------------------------------------
  // These connect the store to the PURE persistence module without importing it
  // here (the module imports nothing from this file, keeping it framework-free
  // and unit-testable). The wiring in `store-backend.svelte.ts` reads
  // `serializableEntries`/`activeWorkspaceId` to serialize and calls
  // `restoreFrom` to rebuild on launch. The process-global node-id factory is
  // exposed so a restore reuses the SAME id source as live splits (no collisions
  // across the restored + future workspaces).

  /**
   * A plain snapshot of every workspace as `{id, name, ws, registry}` for the
   * serializer. Returns the live entries (the serializer re-projects + clones,
   * so handing references is safe + cheap).
   */
  get serializableEntries(): WorkspaceEntry[] {
    return this.workspaces;
  }

  /** The process-global structural-id factory (for deterministic restore wiring). */
  get nodeIdFactory(): () => string {
    return nextNodeId;
  }

  /**
   * Replace ALL workspaces with a restored set and select the restored active
   * one. Used once on launch after `layout_load` + `restoreState`. The restored
   * entries are structurally identical to `WorkspaceEntry` (`{id, name, ws,
   * registry}`); rendering them re-spawns one PTY per leaf via each
   * `TerminalPane`'s mount (shell + cwd only — no live state).
   */
  restoreFrom(entries: WorkspaceEntry[], activeWorkspaceId: string) {
    if (entries.length === 0) return;
    this.workspaces = entries;
    this.activeWorkspaceId = entries.some((w) => w.id === activeWorkspaceId)
      ? activeWorkspaceId
      : entries[0].id;
  }
}

/** Find a leaf by its `paneId` (the tree helpers key on `id`, not `paneId`). */
function leafByPaneId(
  node: Node,
  paneId: string
): { id: string; paneId: string } | null {
  if (node.type === 'leaf') return node.paneId === paneId ? node : null;
  for (const child of node.children) {
    const found = leafByPaneId(child, paneId);
    if (found) return found;
  }
  return null;
}

/** The singleton workspace store, imported by the route + PaneNode + Gutter. */
export const workspace = new WorkspaceStore();
