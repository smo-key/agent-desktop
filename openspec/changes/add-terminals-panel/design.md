## Context

The app today renders agent/shell PTYs inside a tiling workspace tree (`src/lib/layout/`), persisted in `layout.json`. Each pane is a `TerminalPane.svelte` that spawns a real PTY via the `pty_spawn` Tauri command and supports an arbitrary `program` + `cwd` (the `terminal-core` capability already handles arbitrary programs, clean kill via `pty_kill`, and app-quit reaping). Projects are modeled in `projects.ts` / `projects.svelte.ts`, persisted in `projects.json` (atomic tmp+rename), and bound to panes via an explicit `paneId.projectId` recorded at launch. There is no "current project" in the grid view — project context is contextual; the overview derives it from a filter.

This change adds a **separate right-docked region** for user-owned, project-scoped terminals (dev servers, watchers). It deliberately lives **outside** the workspace tiling tree so it never perturbs agent layout, focus navigation, or workspace tabs. It reuses `TerminalPane.svelte` for the actual terminal UI and PTY, and follows the `projects.json` persistence pattern for its own store.

User-confirmed product decisions feeding this design:
- Panel is toggleable; processes survive the panel being hidden.
- Visible terminal set follows the **focused agent's project**.
- Terminals are a **vertical resizable stack**, all visible at once.
- On restart, **only terminals that were running at quit auto-restart**; stopped ones stay stopped.

## Goals / Non-Goals

**Goals:**
- A right-docked, toggleable Terminals panel that takes zero space when off.
- Create / rename / start / stop / restart user terminals running arbitrary commands or a shell, each with its own cwd (default = project path).
- Per-project terminal collections; the panel shows the collection for the focused agent's project and swaps when focus moves to another project.
- Persistence of terminal definitions + last-running state, with selective auto-restart on launch.
- Reuse existing PTY infrastructure (`pty_spawn` / `pty_kill`, `TerminalPane.svelte`) — no new PTY backend behavior.
- Processes are decoupled from panel visibility and project switching (a hidden dev server keeps serving).

**Non-Goals:**
- Terminals are **not** part of the workspace tiling tree and do not appear in the agent grid, the SessionRail, or workspace tabs.
- No tabbed or split arrangement inside the panel (vertical stack only this iteration).
- No cross-project "global" terminals; every terminal belongs to exactly one project.
- No left-docking, detaching/floating, or multi-monitor pop-out.
- No new process-supervision features (health checks, restart-on-crash, log files) beyond start/stop/restart.
- No requirement changes to `terminal-core` or `projects`.

## Decisions

### Decision: Separate region outside the tiling tree, not a special pane in the workspace
The panel is rendered as a sibling of `Surface` in `+page.svelte`, with its own store and persistence. **Alternative considered:** model terminals as ordinary panes pinned into a dedicated split of the workspace tree. Rejected because it would entangle user terminals with agent focus navigation (`focusDirectional`, `focusNext`), workspace-tab semantics, and `layout.json` migration; it would also make "follow the focused agent's project" circular (the terminals would themselves be focusable panes). A separate region keeps both systems simple and independently persisted.

### Decision: Reuse `TerminalPane.svelte` for each terminal
Each stack entry mounts a `TerminalPane` with `program` = the terminal's command (or the default shell) and `cwd` = the terminal's cwd. This inherits PTY spawn, resize via `ResizeObserver`/`fit`, lossless output, and kill/reap for free. **Alternative considered:** a slimmer bespoke terminal component. Rejected — duplicating xterm wiring risks divergence (resize, IME, link handling) for no benefit. Terminals here are *not* `claude` panes, so the statusline/snapshot wrapper is bypassed (plain `program` spawn, as shell panes already do).

### Decision: Active project = selected project, else focused pane's `projectId`
A reactive derivation resolves the panel's active project in priority order: (1) a concrete project explicitly selected in the overview's shared project filter (`projectFilter.selected`, when it is neither `ALL` nor `UNASSIGNED`); otherwise (2) the active workspace's `registry[focusedId].projectId`. When neither yields a project, the panel shows an empty/"no project" state. The pure resolver (`activeProject.ts`) takes the focus context plus an optional `selectedProjectId` so this precedence is unit-tested. **Why the filter wins:** the project filter is an *explicit* user choice (and is persisted/shared across overviews), so it should pin the panel even with no agent focused; absent a concrete selection, following focus is the natural default. **Alternative considered:** a panel-private project picker. Rejected — reusing the existing overview filter keeps a single source of truth for "which project am I looking at."

### Decision: Terminal identity, model, and per-project keying
A terminal is a persisted definition plus runtime state:

```ts
interface TerminalDef {
  id: string;            // stable, e.g. term-${ts}-${n}
  name: string;          // user-editable label (default derived from command)
  command: string | null;// arbitrary command line; null ⇒ default shell
  cwd: string | null;    // null ⇒ project.path
  // persisted lifecycle hint, NOT live state:
  wasRunning: boolean;   // captured at quit to drive selective auto-restart
}
```
Persisted as `terminals.json`: `{ version: 1, projects: { [projectId]: TerminalDef[] } }`. Runtime state (the live PTY `paneId`, running/stopped, exit code) lives only in the store, never serialized — matching how `preview`/`previewHash` are runtime-only in the layout model. Keyed by `projectId` so lookups and swaps on focus change are O(1).

### Decision: Lifecycle = start / stop / restart mapped onto PTY spawn/kill
- **Start**: allocate a runtime `paneId`, mount `TerminalPane` → `pty_spawn` runs. Sets running.
- **Stop**: `pty_kill` the PTY (clean kill/reap from `terminal-core`); the entry stays in the stack as stopped, showing the last exit, ready to restart.
- **Restart**: stop (if running) then start with the same command/cwd.
- **Process exit** (child dies on its own): the existing `PtyEvent::Exit` surfaces; the entry flips to stopped with the exit code, not removed.
This treats a terminal entry as a durable slot whose process may be up or down, which is what dev-server workflows want.

### Decision: Selective auto-restart on launch — SUPERSEDED
NOTE: This decision was superseded by `add-project-folder-storage`. The committed
per-project tasks file is sanitized (no persisted `wasRunning`/`lastCommand`
restore hints), so cross-restart auto-restart is dropped — terminals always
restore stopped. The original decision is retained below for historical context.

On graceful quit, persist `wasRunning = (entry currently running)` for each terminal. On load, for each project's terminals, **do not** spawn anything eagerly; spawn (start) only those with `wasRunning === true`, and only lazily when that project first becomes visible OR eagerly at boot — to avoid surprising the user, spawn is **eager at boot only for terminals marked running**, all others restored stopped. **Alternative considered:** always auto-restart, or never auto-restart. Both rejected by the product decision; the `wasRunning` flag is the single source of truth and arbitrary commands are never re-run unless they were already running.

### Decision: Panel visibility independent of process lifecycle
Toggling the panel off unmounts the *panel chrome* but the processes are owned by the store/PTY backend, not the panel component — hiding must not kill. Because each terminal is a real PTY in the Rust registry keyed by its `paneId`, the process keeps running regardless of whether the Svelte component is mounted. When re-shown (or the project re-focused), the panel re-attaches to the live PTYs. (Implementation note: this requires the `TerminalPane` instances be kept mounted/teleported or the PTY explicitly outlive the component — to be resolved in tasks, mirroring the overview's teleport pattern if needed.)

### Decision: Persistence pattern mirrors `projects.json`
New `terminals_load` / `terminals_save` Tauri commands with atomic tmp+rename, `{ version: 1, ... }` envelope, graceful fallback to empty on parse error, debounced/flushed saves, and a synchronous flush on `CloseRequested` so `wasRunning` is captured before exit. No localStorage.

## Risks / Trade-offs

- **Auto-restarting arbitrary commands** → Mitigation: gate strictly on the persisted `wasRunning` flag; never run a command the user hadn't already started. Restored-stopped is the default for everything else.
- **Hidden processes leak / surprise resource use** (a forgotten dev server keeps running when the panel is closed) → Mitigation: this is intentional (servers must keep serving); surface a running-count indicator on the toggle button so users see "N terminals running" even when the panel is hidden. App-quit reaping (existing) prevents true orphans.
- **Keeping PTYs alive while the component is unmounted** → Mitigation: PTYs live in the Rust registry independent of the frontend; on hide, either keep `TerminalPane` mounted off-screen (cheap) or detach and re-attach to the existing PTY id on show. Decide in implementation; both preserve the process.
- **Focus-follows-project churn** (terminal set swapping as the user clicks around agents) → Mitigation: swapping only changes which collection is *displayed*; no process is started or stopped by a focus change. A future "pin to project" option (a panel-capability addition) can stop the following without model changes.
- **cwd default drift** (project path changes) → Mitigation: store `cwd: null` meaning "the project path at start time"; explicit cwds are honored verbatim.
- **Reusing `TerminalPane` couples panel to agent-pane assumptions** (e.g. snapshot env) → Mitigation: spawn plain `program` like existing shell panes; skip the claude wrapper path.

## Migration Plan

- Additive only. New `terminals.json` is created on first save; absence loads as empty (`{ version: 1, projects: {} }`). No migration of `layout.json` or `projects.json`.
- Rollback: removing the panel + commands leaves `terminals.json` as an inert orphan file; no other state is affected.

## Open Questions

- Mounted-off-screen vs detach/reattach for hidden-panel processes — resolve during implementation; the spec only requires that hiding/switching does not kill processes.
- Whether the toggle's running-count indicator counts only the focused project's terminals or all projects' — leaning toward all (so a hidden project's running server is still visible); confirm during build.
