## 1. Persistence backend

- [x] 1.1 Add `terminals_load` Tauri command in `src-tauri/src/lib.rs` returning the `terminals.json` contents (or null), mirroring `projects_load`
- [x] 1.2 Add `terminals_save` Tauri command writing `terminals.json` with atomic tmp+rename, mirroring `projects_save`
- [x] 1.3 Register both commands in the Tauri command handler
- [x] 1.4 Confirm app-quit reaping (`terminal-core`) already kills/reaps PTYs spawned by the panel; add a test/manual note if any gap — `manager.kill_all()` on `CloseRequested` reaps every PTY in the shared `PtyManager`, including panel terminals (lib.rs:743). No gap.

## 2. Terminal model & store

- [x] 2.1 Define `TerminalDef` (id, name, command, cwd) and the persisted envelope `{ version: 1, projects: { [projectId]: TerminalDef[] } }` in `src/lib/terminals/projectTerminals.ts`
- [x] 2.2 Add tests for the model: per-project keying, default name derivation from command, runtime-vs-persisted field separation
- [x] 2.3 Implement `projectTerminals.svelte.ts` reactive store: load/save via the Tauri commands, graceful empty fallback on parse error, debounced + on-quit flushed save
- [x] 2.4 Implement create / rename / remove and per-project collection accessors in the store
- [x] 2.5 Track runtime state per terminal (live `paneId`, running/stopped, exit code) in the store, not serialized
- [x] 2.6 ~~Capture each terminal's running state into `wasRunning` at quit; on load, mark the auto-restart set from `wasRunning`.~~ SUPERSEDED by `add-project-folder-storage`: the committed per-project store strips the machine-local restore hints (`wasRunning`/`lastCommand`), so no auto-restart set is ever built — terminals always restore stopped.
- [x] 2.7 ~~Add tests for selective auto-restart: only `wasRunning` terminals start; stopped ones stay stopped (`autoRestartIds` / `markRunningState`).~~ SUPERSEDED: the `autoRestartIds`/`markRunningState` helpers were removed with the auto-restart decision; the load path now auto-starts nothing (see `projectTasks.svelte.ts` `load()` — "terminals always restore stopped").

## 3. Current-project derivation

- [x] 3.1 Add a reactive derivation of the active project from the focused pane's `registry[focusedId].projectId` (empty when none) — pure `activeProject.ts` resolver, consumed via `$derived` in `TerminalsPanel.svelte`
- [x] 3.2 Add tests covering focus→project resolution, including the no-project / no-focus cases — `activeProject.test.ts`

## 4. Terminals panel UI

- [x] 4.1 Create `src/lib/terminals/TerminalsPanel.svelte`: vertical resizable stack rendering one `TerminalPane` per terminal in the active project's collection
- [x] 4.2 Spawn each terminal as a plain `program` (shell or command) with cwd = terminal cwd or project path — bypass the claude statusline wrapper (as shell panes do); via the pure `terminalSpawnSpec` (`shell -lc <command>`)
- [x] 4.3 Wire start / stop / restart controls to `pty_spawn` / `pty_kill` (via mount/unmount + a fresh `paneId` on restart); reflect process-exit as stopped + exit code without removing the entry (new `TerminalPane` `onExit` prop → `store.noteExit`)
- [x] 4.4 Wire create / rename / remove UI to the store (inline new-terminal form, dbl-click rename, trash to remove)
- [x] 4.5 Implement resizable dividers between stacked terminals with per-terminal reflow (pointer-drag gutter adjusts neighbor flex weights)
- [x] 4.6 Implement the empty state when the active project has no terminals, and the no-project state when nothing is focused
- [x] 4.7 Ensure hiding the panel or switching projects does not kill processes — every project's stack stays mounted (inactive hidden via CSS); the parent dock stays mounted and hides via CSS, so PTYs survive

## 5. Window chrome & toggle

- [x] 5.1 Dock the panel as a right-edge region beside `Surface` in `src/routes/+page.svelte`; reflow the surface to remaining width when shown, full width when hidden (`.terminals-dock`, flex 0 0 380px / display:none)
- [x] 5.2 Add a title-bar toggle control and a keyboard shortcut to show/hide the panel (`panel-right` button + ⌘J)
- [x] 5.3 Add a `terminals` icon to `src/lib/icons/` (`panel-right` toggle glyph + `square` stop glyph)
- [x] 5.4 Add a running-count indicator on the toggle control (shows N running, clears at zero) — `.tb-badge` bound to `projectTerminals.runningCount`

## 6. Persistence integration

- [x] 6.1 Load terminal collections on app start; restore ALL terminals stopped — auto-restart SUPERSEDED by `add-project-folder-storage`. `projectTasks.load()` (in `+page` onMount) runs the one-time user-level → per-project migration, then reads each project's committed defs; no terminal is auto-started.
- [x] 6.2 Persist definitions on create/rename/remove and persist `wasRunning` on graceful quit (`getCurrentWindow().onCloseRequested` → `captureRunningAndSave`, awaited before native close)
- [x] 6.3 Verify `terminals.json` is independent of `layout.json`/`projects.json` and that the panel never mutates the workspace tree — separate file + commands; the panel only reads `workspace.focusedId`/`session()`, never mutates the tree

## 7. Verification

- [x] 7.1 Run the full test suite and type check; fix failures — 364 frontend tests pass, `svelte-check` 0 errors, `cargo check` clean, scenario-coverage gate PASS (both new caps enforced, 0 missing). Note: 2 pre-existing `events.rs` socket tests fail on this machine due to the macOS temp-dir path exceeding the Unix-socket `SUN_LEN` limit — unrelated to this change (events.rs untouched).
- [x] 7.2 Manually verify (LIVE in-app — the headless-exempt MANUAL scenarios): create terminals in two projects, run a dev server, toggle panel off/on (server keeps running), switch focus between projects (collections swap, processes survive), restart the app (all terminals restore STOPPED — auto-restart superseded by `add-project-folder-storage`), quit (no orphan processes). — confirmed by user high-level testing (close-out).
- [x] 7.3 Validate the change with `openspec validate add-terminals-panel --strict` — valid

## 8. Close-out review fixes

- [x] 8.1 Fix (adversarial review CRITICAL): the ⌘Tab focus-cycle ring omitted running **bare** shells (the ⌘T transient terminals), so they could not be focused via the keyboard — violating the existing scenario "Focus cycle shortcut moves between agent and terminals" ("the active agent followed by its project's running terminals"). `+page.svelte` `focusCycleList()` now appends `projectTasks.bareForProject(pid)` entries where `running`, after the defined-terminal panes. Covered by the existing `terminals-panel` spec scenario (no new scenario needed — this aligns the implementation with the already-specified ring).
