## Why

Agents rarely run alone — a developer watching Claude work on a web app also needs a dev server, a CSS watcher, a test runner, or an ad-hoc shell running alongside. Today the only terminals in the app are agent/shell panes inside the tiling grid, which compete with the agents for that space and aren't organized around "the supporting processes for this project." Users need a dedicated place to run and watch their own long-lived processes *next to* their agents, scoped to the project they belong to.

## What Changes

- Add a **Terminals panel** docked on the right edge of the main window, toggleable on/off (button in the title bar + keyboard shortcut). When off it takes no space; the agent grid fills the window as today.
- Inside the panel the user can **create additional terminals** intended for arbitrary processes (web servers, watchers, REPLs, ad-hoc shells). Each terminal is a real PTY running a shell or a chosen command, fully interactive.
- Terminals are arranged as a **vertical, resizable stack** so multiple are visible at once — the user watches their dev server and their agent side-by-side.
- Terminals are **scoped to a project**. The panel shows the terminals for the **active project**, resolved as: a concrete project **explicitly selected in the overview's project filter** if one is chosen, otherwise the project of the **currently focused agent**. So selecting a project (even with no agent focused) pins the panel to it; with no selection it follows agent focus. Each project keeps its own independent collection of terminals.
- Each terminal has a **lifecycle**: start, stop (kill the process), and restart, plus a rename and a per-terminal working directory (defaulting to the project path).
- Terminals **persist per project** across app restarts as definitions (name, command, cwd) plus their last running state. On launch, terminals that were **running at quit are auto-restarted**; terminals that were stopped are restored as stopped (the user starts them manually). Arbitrary commands are never silently re-run unless they were already running.
- Terminal processes are **independent of panel visibility**: toggling the panel closed (or switching projects) keeps the processes alive in the background so a server keeps serving.

## Capabilities

### New Capabilities
- `terminals-panel`: a toggleable right-docked panel hosting a vertical resizable stack of user-created terminals, with project-scoped visibility that follows the focused agent, and panel-level show/hide behavior that never kills running processes.
- `project-terminals`: the per-project model and lifecycle of user terminals — create / rename / start / stop / restart, per-terminal command + cwd, persistence of definitions and last-running state, and selective auto-restart (only previously-running terminals) on app launch.

### Modified Capabilities
<!-- None: there are no published specs in openspec/specs/ yet; the base app and its terminal-core / projects capabilities are still unarchived changes (add-agent-desktop). This change adds new capabilities that build on, but do not alter the requirements of, terminal-core and projects. -->

## Impact

- **Frontend — window chrome**: `src/routes/+page.svelte` gains a right-docked panel region beside the existing `Surface`, a title-bar toggle button, and a keyboard shortcut; a `terminals` icon is added to `src/lib/icons/`.
- **Frontend — new panel module** (`src/lib/terminals/`): a `TerminalsPanel.svelte` (vertical resizable stack + add/rename/start/stop/restart controls), a `projectTerminals.svelte.ts` store (per-project terminal collections, reactive), and the "current project" derivation from the focused pane's `projectId`.
- **Frontend — terminal reuse**: each terminal renders the existing `src/lib/TerminalPane.svelte` (PTY spawn via `pty_spawn`, lifecycle via `pty_kill`) with a shell/custom `program` and the project `cwd`; no new PTY backend work is expected — `terminal-core` already supports arbitrary programs and clean kill/reap.
- **Frontend — persistence**: a new `terminals.json` envelope (`{ version, projects: { [projectId]: TerminalDef[] } }`) loaded/saved via new Tauri `terminals_load` / `terminals_save` commands mirroring `projects_load` / `projects_save`; last-running state captured at quit to drive selective auto-restart.
- **Backend** (`src-tauri/src/lib.rs`): add `terminals_load` / `terminals_save` commands (atomic tmp+rename, same pattern as `projects_*`) and register them. PTY spawn/kill commands already exist.
- **Persistence/scope boundary**: panel terminals live outside the workspace tiling tree (`layout.json`) — they are a separate region with their own persistence, so they never interfere with agent layout, focus navigation, or workspace tabs.
- **Process safety**: closing the app kills and reaps every terminal process (already handled by `terminal-core`'s app-quit reaping); auto-restart on next launch is gated strictly on the persisted last-running flag.
