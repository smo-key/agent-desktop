## Why

There is no purpose-built way to run and supervise many concurrent Claude Code
sessions. Today the user juggles separate terminal tabs, has no aggregated view of
account-wide usage (rate limits, cost, context) across instances, and cannot see at a
glance what each agent is doing. This
change introduces **agent-desktop**: a Tauri v2 + SvelteKit desktop terminal built
for Claude Code — a real daily-driver terminal (true PTY, recursive tiling, vertical
session tabs) with two Claude-aware layers on top: an aggregated usage dashboard and
per-session task detection. It is distilled from, and
supersedes, the brainstorming design doc at
`docs/superpowers/specs/2026-05-30-agent-desktop-design.md` (which carries the full
empirical research appendix this proposal relies on).

## What Changes

- Scaffold a **Tauri v2 (Rust) + SvelteKit (Svelte 5, SPA)** desktop app:
  `adapter-static`, `ssr=false`, `prerender=false`, single signed binary, no extra
  runtime.
- **Terminal core:** real PTYs via the `portable-pty` crate, one per pane on a dedicated
  OS read thread, streamed as raw ordered bytes to the webview over a per-pane Tauri
  `Channel`, rendered with `@xterm/xterm@6` (WebGL on visible panes, DOM fallback).
- **Recursive tiling + session rail:** a custom n-ary pane tree (splits at any depth,
  drag-resize, close/collapse, focus nav) inside switchable workspaces shown in a left
  vertical tab rail. Terminals are keyed on a stable `paneId` so restructuring never
  remounts xterm.
- **Usage dashboard:** the app installs a `statusline-wrapper.js` and launches every
  session with `claude --settings '{"statusLine":{...}}'` + `AGENT_DESKTOP_PANE` — a
  per-session override that **never touches** the global `~/.claude/settings.json`
  (verified: `--settings` merges per-key). The wrapper delegates to the user's real
  statusline for the in-pane bar and atomically writes a per-pane snapshot JSON the app
  watches; the UI renders a two-row dashboard (per-session cards + account-wide rate
  limits/cost/git).
- **Task detection:** each session's current activity (newest `in_progress` →
  `activeForm`) surfaced per pane, sourced from the snapshot (and a direct watch of
  `~/.claude/tasks/` for foreign sessions).
- **Session launcher:** start Claude in a chosen project folder (picker + recents),
  optional initial prompt, as a new tab or a split of the focused pane. Never auto-runs
  slash commands.
- **Layout persistence:** serialize workspaces/pane trees + a session registry and
  restore on launch (re-spawn shell+cwd; tmux-resurrect semantics).
- **Agent overview (mission control):** a primary top-level view that rosters every
  agent (pane) with live status/task/context/cost, lets you message or answer any agent
  straight from the overview (writes to its PTY), click to jump to its pane, kick off a
  new agent via the launcher, and surfaces the subagents an agent spawns (Task-tool /
  workflow agents read from `~/.claude/projects/<project>/<session>/`), with a usage
  rollup across agents and subagents.

Net-new project — no existing functionality to migrate or break.

## Capabilities

### New Capabilities
- `terminal-core`: PTY-backed terminals that run Claude Code / a shell per pane —
  spawn, lossless byte streaming + xterm render, input forwarding, resize, exit
  detection, and process lifecycle/cleanup.
- `tiling-layout`: vertical session rail (workspaces/tabs) plus recursive tiling of
  panes within a workspace — split, drag-resize, close/collapse/rebalance, focus
  navigation, and terminal-identity preservation across restructure.
- `usage-dashboard`: per-session statusline override (without touching global config),
  the wrapper + atomic snapshot sink, snapshot watching, and the two-row usage bar
  aggregating context/task/model per session and rate-limits/cost/git account-wide.
- `task-detection`: derive each session's current activity from the live tasks dir /
  snapshot, with schema tolerance, a foreign-session fallback watcher, and live/idle
  heartbeat.
- `session-launcher`: start a Claude session in a chosen project folder (picker +
  recents, optional prompt) with the correct override/env, placed as a new tab or a
  split — with no auto-run of slash commands.
- `layout-persistence`: serialize and restore workspaces, pane trees, and the session
  registry — invariant-validated, version-migrated, re-spawning shell+cwd with graceful
  fallback on corrupt state.
- `agent-overview`: a primary "mission control" view listing every agent (pane) with
  status/task/context/cost, message-or-answer any agent without navigating, click-to-
  navigate to its pane, kick off a new agent via the launcher, and surfacing of the
  subagents an agent spawns (with a usage rollup across agents + subagents).

### Modified Capabilities
(none — net-new project)

## Impact

- **Repository:** introduces a Tauri app skeleton — `src-tauri/` (Rust crate:
  `portable-pty`, `notify`, `serde`, `tauri`), `src/` (SvelteKit), `package.json`,
  `svelte.config.js`, `tauri.conf.json`. `openspec/` already present; the brainstorming
  design doc under `docs/superpowers/specs/` becomes the superseded source-of-truth once
  this change is archived.
- **External dependencies:** Rust crates (`portable-pty`, `notify`, `tauri` v2); npm
  (`@xterm/xterm@6`, `@xterm/addon-fit`, `@xterm/addon-webgl`, optional
  search/web-links/unicode11/serialize; `@sveltejs/adapter-static`); the OpenSpec CLI
  (already installed).
- **Filesystem touchpoints (read/observe only):** the user's
  `~/.claude/hooks/statusline.js` (delegated to, never modified),
  `~/.claude/tasks/<session>/*.json`, `$TMPDIR/claude-ctx-*.json`, and the per-session
  `~/.claude/projects/<project>/<session>/` run records (for subagent surfacing). The
  global `~/.claude/settings.json` is **never** written.
- **New app-managed files:** a `statusline-wrapper.js` and a `snapshots/` dir under the
  app-support directory; a persisted layout + session-registry JSON.
- **Safety:** sessions are launched with a per-session `--settings` override only; the
  app never mutates global config and never auto-runs `/workflow:*` or any slash command
  on the user's behalf.
