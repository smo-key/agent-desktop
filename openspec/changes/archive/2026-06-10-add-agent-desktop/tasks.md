## 1. Foundation, tooling, and the test gate

- [x] 1.1 Commit the OpenSpec artifacts (proposal, design, the 7 spec deltas, tasks) created during change setup.
- [x] 1.2 Scaffold the app: Tauri v2 (`src-tauri/`, Rust) + SvelteKit (`src/`). Configure SvelteKit as an SPA — `@sveltejs/adapter-static({ fallback: 'index.html' })`, `src/routes/+layout.ts` with `ssr=false` and `prerender=false`; `tauri.conf.json` `build.frontendDist="../build"`, `devUrl` on fixed port 1420. (D1)
- [x] 1.3 Declare deps. Rust: `tauri` v2, `portable-pty`, `notify`, `serde`/`serde_json`. Frontend: `@xterm/xterm@6`, `@xterm/addon-fit`, `@xterm/addon-webgl` (optional: `addon-search`, `addon-web-links`, `addon-unicode11`, `addon-serialize`); import `@xterm/xterm/css/xterm.css` once. Pin versions; let `cargo` confirm `portable-pty` API spelling. (D1, D5)
- [x] 1.4 Add `package.json` scripts: `dev`, `build`, `lint` (eslint/prettier or biome + `cargo fmt --check` + `cargo clippy`), `types` (`svelte-check`), `test` (Vitest + `cargo test`), `coverage` (scenario gate, 1.5), `check` (`lint && types && coverage && test`).
- [x] 1.5 Create `tools/check-scenario-coverage.mjs`: parse every `#### Scenario:` in `openspec/changes/*/specs/**/*.md` (and `openspec/specs/**` once archived), normalize names to snake_case, scan Rust test fn names (`fn <snake>`) and Vitest test titles (`it('<scenario>'…)`), and exit non-zero listing any scenario with no matching test.
- [x] 1.6 Extend `.gitignore` for `target/`, `node_modules/`, `build/`, `.svelte-kit/`, `dist/`, `*.log` (keep the existing `.superpowers/` ignore).
- [x] 1.7 Add a pre-commit hook running `npm run check` and `openspec validate add-agent-desktop --strict`; a failing gate blocks the commit.

## 2. Capability: `terminal-core` (Milestone 1 — walking skeleton)

Cover every scenario in `specs/terminal-core/spec.md`. Write the failing test first, then implement. Manual TUI check where headless can't reach.

- [x] 2.1 Rust `PtyManager` state: `Mutex<HashMap<PaneId, Pane>>` + `AtomicU64`. Covers *PTY-Backed Process Spawning* (spawn with seeded env in target cwd; slave dropped for EOF).
- [x] 2.2 `pty_spawn` command: `openpty` → `CommandBuilder` (cwd, `TERM=xterm-256color`, `COLORTERM`, seeded `PATH`/`HOME`/`LANG`) → `spawn_command` → `drop(slave)` → dedicated `std::thread` read loop → per-pane `Channel`. Covers *Lossless Ordered Output Streaming* (raw bytes in order; split multibyte reassembled) and *Blocking Read Loop With Coalescing* (native thread; bulk batching ~8–16ms/16–64KiB). (D2)
- [x] 2.3 `pty_write` / `pty_resize`. Covers *Input Forwarding To PTY* (keystroke reaches writer; write to dead pane rejected) and *PTY Resize Round-Trip* (SIGWINCH reflow; fit guarded on 0×0).
- [x] 2.4 Exit + lifecycle: EOF → `child.wait()` reap → `PtyEvent::Exit`; `pty_kill` via `clone_killer`; kill-all on `CloseRequested`. Covers *Child Exit Detection And Reaping* and *Process Lifecycle And No Orphans*.
- [x] 2.5 `TerminalPane.svelte`: dynamic-import xterm in `onMount`, `fit()`, Channel→`term.write(Uint8Array)`, `onData`→`pty_write`, `ResizeObserver`→`onResize`→`pty_resize`; teardown order `ro.disconnect()`→`webgl.dispose()`→`term.dispose()`→close channel→`pty_kill`. WebGL on visible + `onContextLoss`→DOM (no `addon-canvas`). Covers *WebGL Renderer With DOM Fallback* and *Stable Terminal Identity Across Tree Mutations*. (D5)
- [x] 2.6 Milestone-1 demo: one pane runs `claude`, full TUI works, resize round-trips. `npm run check` green for `terminal-core`. — confirmed by user high-level testing (close-out).

## 3. Capability: `tiling-layout` (Milestone 2)

Cover every scenario in `specs/tiling-layout/spec.md`.

- [x] 3.1 Pure pane-tree module + tests (highest bug density): `Workspace`, `Split`, `Leaf`; `findParent`, `normalize`, `validateTree`. (D4)
- [x] 3.2 `splitLeaf` with same-direction flatten. Covers *Split A Pane Horizontally Or Vertically* and *Same-Direction Split Flatten*.
- [x] 3.3 `closeLeaf` (remove → collapse single-child parent → normalize) and `resize` (adjacent ratios only, sum conserved). Covers *Close A Pane With Collapse And Rebalance* and *Drag-Resize A Gutter Adjusts Only Adjacent Siblings*.
- [x] 3.4 Recursive `PaneNode.svelte` (flexbox `flex-basis: ratio%`), `Gutter.svelte` (Pointer Events + `setPointerCapture` + `touch-action:none`, rAF-throttle, defer `fit()` to drag-end). Terminal keyed `{#key paneId}`. Covers *Terminal Identity Preserved On Restructure*.
- [x] 3.5 Focus navigation (click + cyclic + directional). Covers *Focus Navigation By Click And Keyboard*.
- [x] 3.6 Workspace session rail (left vertical tabs) + switching. Covers *Workspace Session Rail And Switching*.
- [x] 3.7 `npm run check` green for `tiling-layout`.
- [x] 3.8 Pane right-click context menu: split right/down/left/up, close pane, new session, copy/paste; pure menu model (`paneMenu.ts`) unit-tested, reactive menu store + renderer, wired on each leaf. Covers *Pane Context Menu*.

## 4. Capability: `layout-persistence` (Milestone 2)

Cover every scenario in `specs/layout-persistence/spec.md`.

- [x] 4.1 Serialize workspaces + pane trees + session registry (`paneId → {cwd, shell}`) to app-support JSON; debounced + on-quit flush. Covers *Serialize Workspace Layout And Session Registry* and *Debounced And On-Quit Persistence Writes*. (D8)
- [x] 4.2 Restore: parse → `validateTree()` (invariants) → version migration. Covers *Restore With Invariant Validation* and *Version-Keyed Migration*.
- [x] 4.3 Re-spawn a PTY per leaf with saved shell+cwd (no live state); optional `addon-serialize` scrollback repaint. Covers *PTY Re-Spawn With Shell And Cwd Only* and *Optional Scrollback Repaint*.
- [x] 4.4 Corrupt/unmigratable layout → fresh single-pane workspace, no crash. Covers *Graceful Fallback On Corrupt State*.
- [x] 4.5 `npm run check` green for `layout-persistence`.

## 5. Capability: `usage-dashboard` (Milestone 3)

Cover every scenario in `specs/usage-dashboard/spec.md`. **Confirm the wrapper in a live in-app pane here** (the one non-headless gate). (D3)

- [x] 5.1 Install `statusline-wrapper.js` to app-support `bin/`: delegates to `~/.claude/hooks/statusline.js` (stdin teed) for the unchanged in-pane bar; atomically (tmp+rename) writes `snapshots/<AGENT_DESKTOP_PANE>.json` = `{pane_id, session_id, model, task, context_pct, rate_limits, cost, git, ts}`. Integration test pipes a synthetic payload → asserts snapshot. Covers *Statusline Wrapper Dual Behavior* and *Atomic Per-Pane Snapshot Write*.
- [x] 5.2 Launch sessions with `AGENT_DESKTOP_PANE=<uuid> claude --settings '{"statusLine":{...wrapper...}}'`; assert global `~/.claude/settings.json` is byte-identical after. Covers *Per-Session Statusline Override Without Touching Global Config*.
- [x] 5.3 Rust `SnapshotWatcher` (`notify`) → emit changes to frontend; skip malformed snapshots. Covers *Snapshot Directory Watching and Push*.
- [x] 5.4 Two-row dashboard UI: per-session cards (model · context bar · task · live/idle) + account row (5h/7d limits · summed cost · focused-pane git). Context from `used_percentage`/`remaining_percentage`/`context_window_size`. Covers *Two-Row Dashboard Content* and *Account-Wide Rollup Math*.
- [x] 5.5 Absent `rate_limits`/context render as `null`, never crash/NaN. Covers *Graceful Handling of Missing Rate Limits and Context*.
- [x] 5.6 Live in-app pane confirms wrapper renders + writes a snapshot; `npm run check` green for `usage-dashboard`. — confirmed by user high-level testing (close-out).

## 6. Capability: `task-detection` (Milestone 4)

Cover every scenario in `specs/task-detection/spec.md`. (D7)

- [x] 6.1 Derive current task = newest `in_progress` → `activeForm` from `~/.claude/tasks/<session>/<N>.json`; tolerate schema drift (fall back `subject`/`content`). Covers *Derive Current Task From Live Tasks Directory* and *Tolerate Task Schema Variations And Fallback Fields*.
- [x] 6.2 App-launched sessions read task from the snapshot (already watched). Covers *Snapshot Is The Primary Task Source For App-Launched Sessions*.
- [x] 6.3 Fallback watcher of `~/.claude/tasks/` + `$TMPDIR/claude-ctx-*.json` for foreign sessions. Covers *Direct-Watch Fallback For Foreign Sessions*.
- [x] 6.4 Live/idle from snapshot `ts` heartbeat; surface per-pane badge + card. Covers *Derive Live Versus Idle From Snapshot Heartbeat* and *Surface Task Per Pane*.
- [x] 6.5 `npm run check` green for `task-detection`.

## 7. Capability: `session-launcher` (Milestone 5)

Cover every scenario in `specs/session-launcher/spec.md`.

- [x] 7.1 New-session flow: folder picker + recent-folders list (persisted) + optional initial prompt. Covers *Launch New Session With Folder Picker And Recents*, *Optional Initial Prompt*, *Recent-Folders Persistence Across Restarts*.
- [x] 7.2 Spawn `claude` in chosen cwd with the wrapper `--settings` override + `AGENT_DESKTOP_PANE` (joins the dashboard). Covers *Spawn Claude With Wrapper Override And Pane Env*.
- [x] 7.3 Placement: new workspace/tab or split the focused pane. Covers *Placement As New Tab Or Split Of Focused Pane*.
- [x] 7.4 Guarantee no auto-run of `/workflow:*` or any slash command. Covers *No Auto-Run Of Slash Commands*.
- [x] 7.5 `npm run check` green for `session-launcher`.
- [x] 7.6 Gate initial-prompt delivery on TUI readiness: start the settle/quiet window only AFTER the first PTY output byte (never at spawn), with a hard-cap backstop, so a slow-starting session (e.g. a coordinated agent loading the toolkit) can't have its prompt written into a not-yet-rendered terminal and show up blank / needs-input. Covers *Initial prompt is delivered only after the TUI is ready*.

## 9. Integration, validation, and archive

- [x] 9.1 End-to-end smoke: launch app → restore layout → spawn 3 sessions across split panes + tabs → dashboard shows live per-session cards + account rollup → overview rosters each agent with live working/needs-input status. — confirmed by user high-level testing (close-out).
- [x] 9.2 `tools/check-scenario-coverage.mjs` reports 100% scenario coverage across all 7 capabilities. (All 7 enforced: terminal-core, tiling-layout, layout-persistence, usage-dashboard, task-detection, session-launcher, agent-overview — 0 missing each; gate exits 0.)
- [x] 9.3 `openspec validate add-agent-desktop --strict` passes; full `npm run check` green.
- [x] 9.4 Verify spawned `claude` children resolve PATH and are killed/reaped on quit — confirmed: `PtyManager::kill_all` reaps every pane child on quit and GUI PATH/env seeding is in place (adversarial review + user testing). NOTE: Developer-ID code-signing + packaging is split out as a separate, non-blocking **release** step (not a feature-completeness gate for this change).
- [x] 9.5 `openspec archive add-agent-desktop`; mark `docs/superpowers/specs/2026-05-30-agent-desktop-design.md` superseded. — done at close-out: delta specs promoted into `openspec/specs/`, design doc marked Superseded.

## 10. Capability: `agent-overview` (Milestone 7 — mission control)

Cover every scenario in `specs/agent-overview/spec.md`. Composes M3 (snapshots), M4 (task/foreign), and M5 (launcher). Pure cores (roster/status/usage/subagent-parse/message-dispatch) unit-tested; live/visual scenarios go to the gate MANUAL allowlist.

- [x] 10.1 Pure roster view-model from the snapshots map (+ workspace): per-agent {name/cwd, model, task, context%, cost}; status (working/needs-input/finished/errored) derived from the live PTY-activity + process-exit registry rather than the sparse statusline heartbeat. Unit-tested. Covers *Agent Roster Overview*.
- [x] 10.2 Subagent parsing (Rust): read `~/.claude/projects/<proj>/<session>/workflows/<id>.json` + `subagents/**/agent-*.meta.json` → {label, status, usage}; tolerate partial/malformed. Watcher + command + tests. Covers *Surface Subagents*.
- [x] 10.3 Usage rollup: per-agent (snapshot cost/context) + aggregate across agents + subagents. Unit-tested. Covers *Agent Usage Tracking*.
- [x] 10.4 Message an agent: write user text + CR to a pane's PTY from the overview (via the terminal handle registry); never synthesize input. Unit-tested dispatch. Covers *Message An Agent*.
- [x] 10.5 Overview UI: a primary top-level view (toggle with the grid) rendering the roster + subagents + usage rollup; per-agent message box; "new agent" → launcher; click-to-navigate (activate workspace + focus pane). Covers *Navigate To An Agent*, *Kick Off A New Agent From The Overview*, *Overview As A Primary View*.
- [x] 10.6 `npm run check` green for `agent-overview`; enforce in the coverage gate.
- [x] 10.7 Resume archived sessions on select (provisional preview): selecting an archived `claude` session respawns `claude --resume` and shows its transcript; the row stays in Archived (out of attention) via a transient `preview` flag until a message is sent (unarchives, reusing `shouldAutoResume`); leaving the window 60s without sending re-archives (kills the resumed PTY); preview persists as archived; the static "Session archived" panel is removed. Pure roster/persistence logic unit-tested. Covers *Resume An Archived Session By Selecting It*. (D10)

## 11. Close-out review fixes (pre-archive adversarial code review)

- [x] 11.1 Launcher initial-prompt race (refines 7.6 / *Initial prompt is delivered only after the TUI is ready*): the per-pane output channel is wired before `pty_spawn` resolves, so a first byte then a quiet settle could fire `deliverInitial` while `ptyId` was still undefined — dropping the prompt and latching. `LaunchPromptReadiness` now defers `fire()` until `wired()` and replays it. Regression test added (`initialInput.test.ts`).
- [x] 11.2 Terminal WebGL context leak (`terminal-core`): `loadWebgl()` now re-checks `active` after the addon's dynamic import, so a pane that went inactive during the import no longer pins a scarce WebGL context (`TerminalPane.svelte`).
