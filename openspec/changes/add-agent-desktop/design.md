## Context

Net-new desktop app. The full design and an empirically-verified technical appendix
live in `docs/superpowers/specs/2026-05-30-agent-desktop-design.md` (the source this
change is distilled from). Key environment facts confirmed on this machine (Claude Code
2.1.158, node v24.12.0, macOS 26.2): `claude --settings` merges per-key and overrides
`statusLine.command` in a live TUI without touching global config; live per-agent task
data is at `~/.claude/tasks/<session>/<N>.json` (not `~/.claude/todos/`, which is
absent); the statusline stdin has no `context_window.total_tokens` (use
`used_percentage`/`remaining_percentage`/`context_window_size`); `@xterm/xterm@6`
removed the canvas renderer (fallback is DOM).

## Goals / Non-Goals

**Goals:**
- A real daily-driver terminal for Claude Code: true PTY semantics, recursive tiling,
  vertical session tabs.
- A persistent usage bar aggregating context/task/model per session and rate-limits /
  cost / git account-wide — across all running instances.
- Per-session task detection; a folder launcher.

**Non-Goals:**
- Never modify the user's global `~/.claude/settings.json` or relocate the config dir.
- Never auto-run `/workflow:*` or any slash command on the user's behalf.
- No restore of live process state on relaunch (shell + cwd only).
- Not targeting the Mac App Store sandbox (Developer-ID signing assumed).

## Decisions

**D1 — Stack: Tauri v2 (Rust) + `portable-pty` + `@xterm/xterm@6` + SvelteKit SPA.**
Single signed binary, no second runtime, true TTY so Claude's full-screen TUI works.
Rejected a `node-pty` sidecar (extra runtime/codesign + a cross-process hop per
keystroke) and the Tauri `shell` plugin (no PTY — breaks TUIs). SvelteKit runs as an SPA
(`adapter-static`, `ssr=false`, `prerender=false`, `fallback: index.html`) because Tauri
serves a local bundle.

**D2 — IPC: per-pane `Channel` for output, `invoke` for input; raw bytes both ways.**
Tauri's documented high-throughput path for child-process output is a `Channel` (ordered,
fast) — not the event bus. Never decode UTF-8 in Rust; ship raw bytes and let xterm
reassemble split codepoints / escape sequences. Coalesce reads (~8–16ms / 16–64KiB)
under bulk output (no true PTY backpressure).

**D3 — Usage aggregation via an app-managed statusline wrapper + `--settings` override.**
The app launches every session with `AGENT_DESKTOP_PANE=<uuid> claude --settings
'{"statusLine":{"type":"command","command":"<abs>/statusline-wrapper.js"}}'`. Verified:
merge semantics, fires in the live TUI, global `settings.json` byte-identical after, env
passes through. The wrapper (a) delegates to the user's real
`~/.claude/hooks/statusline.js` for the unchanged in-pane bar and (b) atomically
(tmp+rename) writes `<app-support>/snapshots/<pane>.json`. Rejected `CLAUDE_CONFIG_DIR`
(forks the whole config root — loses auth/todos/plugins) and augmenting the global
statusline (clobber risk on hook upgrades).

**D4 — Custom n-ary pane tree, not a split library; terminals keyed on `paneId`.**
Every Svelte split lib persists *sizes keyed to static markup*, not a runtime-mutated,
serializable topology. We own `Workspace{version, root, focusedId}` with
`Node = Split{direction, children[], ratios[]} | Leaf{paneId}`. Invariants: ratios
sum≈1, Split has ≥2 children (else collapse), no same-direction nesting (flatten). The
xterm instance is keyed on the stable `paneId` (`{#key paneId}`) so split/close/reparent
never remounts it (preserves scrollback + the PTY).

**D5 — WebGL renderer on visible panes only, DOM fallback.** Browsers cap WebGL contexts
(~16/page); with many panes we load WebGL on visible/focused panes, dispose on
background, and register `onContextLoss` → DOM. `@xterm/addon-canvas` is not used (gone
in xterm 6).

**D7 — Task source is `~/.claude/tasks/`, snapshot-primary for app sessions.** The
wrapper computes `task` (newest `in_progress` → `activeForm`) and embeds it in the
snapshot, so app-launched sessions need no extra watch. A fallback directly watches
`~/.claude/tasks/` + `$TMPDIR/claude-ctx-*.json` for foreign sessions. Read `activeForm`,
fall back to `subject`/`content` (schema drift across CC versions). Live/idle from the
snapshot `ts` heartbeat.

**D8 — Persistence: layout tree + session registry; re-spawn shell+cwd.** Serialize
workspaces + `paneId → {cwd, shell}` to app-support (debounced + on-quit). Restore via
`validateTree()` (re-assert invariants, version-migrate) then re-spawn a PTY per leaf;
live process state is not restored (tmux-resurrect semantics). Corrupt/unmigratable
layout falls back to a fresh single-pane workspace rather than crashing.

**D10 — Resume archived sessions on select (provisional preview).** Selecting an
archived session respawns `claude --resume <sessionId>` so its transcript is shown and
interactive immediately — no intermediate "Restore" panel. The row stays in the Archived
lane until the user *commits* by sending a message, mirroring the existing paused→auto-
resume machinery: a transient `preview` flag (+ `previewHash`, the user-message hash at
preview start) pins the row to the `done` lane and out of attention (alongside the
`closed`/`paused` overrides in `laneForRow`/`needsAttention`), while `closed:false`+
`resume:true` let the TerminalPane spawn the live resumed PTY. The same `shouldAutoResume`
hash-diff that un-pauses a paused agent unarchives a previewing one (drops `preview`, keeps
it live). To avoid leaking idle resumed processes, a per-pane timer started when a
previewing session stops being the shown agent re-archives it (terminate PTY) after a grace
period (60s), cancelled if the user returns or sends a message. `preview` is runtime-only:
persistence serializes a previewing pane as archived (`closed:true`, `resume:false`), so a
restart never restores it live. Rejected: full restore-on-click (loses the "completed until
I reply" framing the user wants) and reusing the `paused` lane (a resumed completed session
belongs under Archived, not Paused).

**D9 — Phasing (walking skeleton first).** M1 terminal-core → M2 tiling-layout (+
persistence) → M3 usage-dashboard → M4 task-detection → M5 session-launcher → M6
agent-overview. Each milestone is independently demoable.

## Risks / Trade-offs

- **Live in-app wrapper cadence/env.** Verified by direct-pipe simulation, but the exact
  env Claude injects, the ~300ms refresh cadence, and shell-vs-argv invocation of
  `statusLine.command` are confirmed only once inside a live in-app pane (M3 gate). Use
  an absolute wrapper path with no spaces.
- **Channel binary payload shape.** `Vec<u8>` → JS number array → `Uint8Array` is the
  verified-safe default; raw-`ArrayBuffer` is an optimization to pursue only if measured
  as a bottleneck.
- **WebGL context cap is GPU/WebView-dependent** (~16 is a planning ceiling, not a
  guarantee) — mitigated by visible-only WebGL + DOM fallback.
- **`portable-pty` API spelling/version** (`exit_code()` vs `success()`, `clone_killer`
  location) — pin in `Cargo.toml` and let the compiler confirm.
- **Sparse macOS GUI env** — `claude` and its child tools may not resolve without seeded
  `PATH`/`HOME`/`TERM`/`LANG` on the `CommandBuilder`.
- **Snapshot/statusline writes are best-effort** — never break the in-pane bar; malformed
  snapshots are skipped; missing `rate_limits`/context render as `null`.
