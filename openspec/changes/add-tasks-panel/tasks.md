## 1. Backend: tasks persistence

- [ ] 1.1 Add `tasks_load` / `tasks_save` Tauri commands in `src-tauri/src/lib.rs` (atomic tmp+rename), reading/writing `tasks.json`, mirroring the existing `terminals_load`/`terminals_save`
- [ ] 1.2 Register the new commands in the Tauri command handler
- [ ] 1.3 Keep `terminals_load` available (read-only) for one-time migration; mark for removal in §8
- [ ] 1.4 Confirm app-quit reaping (`manager.kill_all()` on `CloseRequested`) still covers task PTYs (no code change expected — verify and note)

## 2. Model: evolve TerminalDef → TaskDef (TDD)

- [ ] 2.1 Write tests for `TaskDef { id, name, projectId, kind, command?, prompt? }`: terminal vs agent fields, per-project keying, default name derivation, runtime-vs-persisted separation
- [ ] 2.2 Rename `src/lib/terminals/projectTerminals.ts` → `src/lib/tasks/projectTasks.ts`; rename `TerminalDef` → `TaskDef`; add `kind: 'terminal' | 'agent'`, `command?`, `prompt?`; update the persisted envelope (`version`, `projects`)
- [ ] 2.3 Write a test for legacy import: absent `tasks.json` + present `terminals.json` → terminals imported as `kind: 'terminal'` tasks
- [ ] 2.4 Implement the legacy `terminals.json` → `tasks.json` import shim in the model/store layer

## 3. Store: lifecycle, completion, agent routing (TDD)

- [ ] 3.1 Rename `projectTerminals.svelte.ts` → `src/lib/tasks/projectTasks.svelte.ts`; load/save via `tasks_load`/`tasks_save`; empty fallback on parse error; debounced + on-quit flush
- [ ] 3.2 Write tests for runtime state (fresh `paneId` on start, running flag, exit code) and start/stop/rename/remove
- [ ] 3.3 Write tests for terminal-task completion: exit 0 → pane removed (auto-close); non-zero → kept + `failed`; dismiss → removed; long-runner (no exit) → stays
- [ ] 3.4 Implement completion semantics in the store (`noteExit` distinguishing success-close vs error-keep, `failed` state, dismiss action)
- [ ] 3.5 Write tests for the bare-terminal path: `command: null` entries persist-on-exit (stopped slot), are not auto-closed, and are not saved as `TaskDef`
- [ ] 3.6 Write a test for agent-task start invoking the workspace session-launch hook with the task's prompt (not creating a right-panel pane)
- [ ] 3.7 Implement `startTask` dispatch: terminal kind → right-panel pane; agent kind → call injected workspace session launcher seeded with `prompt`

## 4. Active-project derivation

- [ ] 4.1 Rename `src/lib/terminals/activeProject.ts` → `src/lib/tasks/activeProject.ts`; keep tests green (focus→project, no-project, no-focus)

## 5. Right-docked Tasks panel

- [ ] 5.1 Rename `TerminalsPanel.svelte` → `src/lib/tasks/RunningTasksPanel.svelte`; retitle the panel "Tasks"; remove the `+` add-terminal button
- [ ] 5.2 Render running terminal-task panes; apply completion semantics (auto-close on success; failed + dismiss on error) from the store
- [ ] 5.3 Preserve per-pane resize, surviving project switch / panel hide without killing processes
- [ ] 5.4 Add/keep a bare-terminal launch entry usable by ⌘T (right panel) without a `+` button

## 6. Left Tasks launcher panel

- [ ] 6.1 Create `src/lib/tasks/TasksLauncher.svelte`: list UI mirroring the Agents rail, scoped to the active project, with idle/running/failed status per task
- [ ] 6.2 Add a horizontal `Gutter` splitter between the Agents rail and the launcher in the left column (reuse `src/lib/layout/Gutter.svelte` / flex ratios); default ~1/3 height; persist the ratio
- [ ] 6.3 Implement footer actions `[+ Task]` (create — choose kind terminal/agent, name, command/prompt) and `[⊳ Terminal]` (launch bare shell)
- [ ] 6.4 Wire start / stop / rename / remove and dismiss-failed from the list to the store
- [ ] 6.5 Implement empty-project and no-project states

## 7. App wiring

- [ ] 7.1 Update `src/routes/+page.svelte`: mount the renamed right panel, remove `+`, update the running-count badge and ⌘J toggle to the tasks store
- [ ] 7.2 Ensure ⌘T still launches a bare interactive shell in the right panel
- [ ] 7.3 Wire agent-task launch to the existing workspace session launcher (`workspace.svelte.ts`) with the prompt as initial input
- [ ] 7.4 Mount the left `TasksLauncher` + splitter under the Agents rail (`SessionRail.svelte` / left column)

## 8. Cleanup & verify

- [ ] 8.1 Remove dead `terminals_*` Tauri commands and any leftover `terminals`-named symbols once nothing references them
- [ ] 8.2 Run the full frontend test suite and `cargo` checks; fix regressions
- [ ] 8.3 Manual smoke: create a terminal task (Git Push) → succeeds & auto-closes; make it fail → stays red & dismissable; Start Dev Server → persists; create an agent task → opens a Claude session; ⌘T + `[⊳ Terminal]` → bare shells; resize the splitter and reload → size persists
- [ ] 8.4 `openspec validate add-tasks-panel --strict`
