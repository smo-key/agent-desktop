# agent-desktop — Design Spec

- **Date:** 2026-05-30
- **Status:** Approved (ready for implementation planning)
- **Author:** Arthur Pachachura (with Claude)

A Tauri v2 + SvelteKit desktop terminal built for running and watching Claude Code
sessions. A daily-driver terminal first, with three Claude-aware layers on top: an
aggregated usage bar, per-session task detection, and a read-only workflow board.
Single signed binary, no extra runtime.

---

## 1. Goals & non-goals

**Goals (v1)**
- A real, daily-driver terminal emulator: true PTY semantics so Claude's full-screen
  TUI, `vim`, `htop`, etc. work.
- Recursive tiling (tmux/iTerm-style nested splits at any depth) plus a vertical
  session rail (tabs).
- A persistent bottom **usage bar** aggregating usage **across all running Claude
  instances**: per-session context %, detected task, model, live/idle; account-wide
  5h/7d rate limits and summed cost; git status for the focused pane.
- **Task detection** — surface what each agent is currently doing.
- **Session launcher** — start Claude in a chosen project folder.
- **Read-only workflow board** — generically detect a repo's `/workflow` tooling and
  display its state; the user runs the slash commands themselves.

**Non-goals (v1)**
- The app never mutates Jira / workflow state and never auto-runs `/workflow:*`
  commands (respects the skill's "only the user closes tickets" rule).
- No modification of the user's global `~/.claude/settings.json` or config dir.
- No restoring of live process state on session restore (shell + cwd only).
- Not targeting the Mac App Store sandbox (Developer-ID signing assumed).

## 2. Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Pane model | Recursive tiling, nested at any depth | User choice; max flexibility |
| Status bar | Two-row dashboard (per-session cards + account summary) | Best "monitor many agents" view |
| Usage aggregation | App-managed statusline → rich JSON snapshot the app watches | Accurate, leaves global config untouched |
| Workflow actions | Read-only board; user drives the slash commands | Keeps skill guardrails + closure-ownership intact |
| Workflow scope | Generic auto-detect (`.claude/{commands,skills}/workflow/`) | Works for skipa and any future repo |
| v1 target | Daily-driver terminal, phased build | User choice |
| Stack | Tauri v2 (Rust) + `portable-pty` + `@xterm/xterm@6`; SvelteKit SPA | Lightest, proven, true TTY |

## 3. Architecture (one process)

- **Rust core** owns PTYs (`portable-pty`), filesystem watchers (`notify`), workflow
  script execution, and persistence. State in Tauri-managed
  `Mutex<HashMap<PaneId, Pane>>` + `AtomicU64` id counter.
- **SvelteKit webview** — SPA: `adapter-static`, `ssr=false`, `prerender=false`,
  `fallback: index.html`. Renders pane tree, terminals, status bar, board, launcher.
- **IPC:** a Tauri **`Channel<T>` per pane** for PTY output bytes (ordered,
  high-throughput — Tauri's documented path for child-process output); `invoke` for
  keystrokes / resize / spawn / kill / workflow reads. **Raw bytes both directions —
  never decode UTF-8 in Rust** (xterm reassembles split codepoints & escape
  sequences across chunk boundaries).

```
SvelteKit webview (SPA)
  PaneTree (recursive) → TerminalPane×N (xterm) · StatusBar · WorkflowBoard · SessionLauncher
        ▲ invoke (keys/resize/spawn/kill)        ▼ Channel (PTY bytes) + events (snapshots)
Rust core
  PtyManager · SnapshotWatcher · WorkflowRunner · Persistence
        │ spawns claude with --settings <wrapper> + AGENT_DESKTOP_PANE=<uuid>
External
  claude(PTY)×N → statusline-wrapper.js → (a) delegate to ~/.claude/hooks/statusline.js
                                          (b) write …/agent-desktop/snapshots/<pane>.json
  ~/.claude/tasks/<session>/*.json   (task source)
  <repo>/.claude/skills/workflow/*.sh (read-only board)
```

## 4. Subsystems

### 4.1 Terminal core
`portable-pty` in-process (no node-pty sidecar — avoids a second runtime/codesign and
a cross-process hop per keystroke). Per pane:
1. `native_pty_system().openpty(PtySize{rows,cols,..})`.
2. `CommandBuilder` for `claude` (or shell); set `cwd`, and seed env
   `TERM=xterm-256color`, `COLORTERM=truecolor`, plus `PATH/HOME/LANG` (macOS GUI apps
   inherit a sparse env).
3. `spawn_command`, then **`drop(pair.slave)`** — the kernel only delivers EOF to the
   master reader once the child exits *and* no slave fd remains. (Top bug source.)
4. Dedicated **`std::thread`** blocking read loop (never a tokio task — a blocked
   `read` would starve the runtime) → `channel.send(PtyEvent::Data{bytes})`.
5. On EOF: `child.wait()` to reap (macOS GUI parents don't auto-reap) → emit
   `PtyEvent::Exit{code}`.

Commands: `pty_write(id, Vec<u8>)`, `pty_resize(id, cols, rows)` (triggers SIGWINCH),
`pty_kill(id)` via `child.clone_killer()` (Send+Sync, kills from another thread). Kill
all panes on `CloseRequested`. Coalesce reads (~8–16ms / 16–64KiB buffers) under bulk
output — there is no true backpressure to the PTY, so batch on the Rust side.

**Frontend:** `@xterm/xterm@6` + `@xterm/addon-fit@0.11` + `@xterm/addon-webgl@0.19`
(optional: search/web-links/unicode11/serialize). Import `xterm.css` once; construct
in `onMount` via dynamic `import()` (keeps SSR/build clean); `term.open()` →
load WebGL → `fit()`. `term.onData` → `pty_write`; Channel `onmessage` →
`term.write(new Uint8Array(bytes))`; `ResizeObserver` → `fit()` → `term.onResize` →
`pty_resize`. Teardown in `onDestroy`: `ro.disconnect()` → `webgl.dispose()` →
`term.dispose()` → close channel → `pty_kill`.

> **xterm 6 note:** the canvas renderer addon was **removed**; the fallback is now the
> DOM renderer. Plan **WebGL → DOM**, do **not** install `@xterm/addon-canvas`.

### 4.2 Recursive tiling (pane tree)
**Custom n-ary tree — not a split library.** Every Svelte split lib persists *sizes
keyed to static markup*, not a runtime-mutated topology; that's a structural mismatch
with "arbitrary nested splits, serialized and restored."

```ts
type Direction = 'row' | 'col';
type Leaf  = { type:'leaf';  id:string; paneId:string };
type Split = { type:'split'; id:string; direction:Direction; children:Node[]; ratios:number[] };
type Node  = Leaf | Split;
type Workspace = { version:1; root:Node; focusedId:string };
```
Invariants: `ratios.length === children.length` and `sum≈1`; a Split always has ≥2
children (1 ⇒ collapse); no Split directly contains a same-direction Split (flatten).

Recursive self-referencing `PaneNode.svelte`; flexbox `flex:0 0 ratio%`. **Terminal
keyed on stable `paneId` (`{#key paneId}`)** — split/close/reparent must never remount
xterm (would lose scrollback + detach the PTY). Pure ops `(root,…)→newRoot`:
- **splitLeaf** — replace leaf with `Split[oldLeaf,newLeaf]@[0.5,0.5]`; **same-direction
  flatten** so repeated "split right" yields N even columns, not nested depth.
- **closeLeaf** — remove from parent, `normalize` remaining ratios; if parent left with
  one child, collapse it up.
- **resize** — gutter between children i,i+1 adjusts only those two ratios (sum
  conserved); rest of tree frozen. Clamp to a px-derived min.
- **focus** — cyclic (in-order DFS ±1) and directional (spatial rect comparison).

Drag: Pointer Events + `setPointerCapture` + `touch-action:none`; report px delta +
container px up; rAF-throttle; defer `fit()` to drag-end; body `user-select:none`
during drag.

### 4.3 Usage aggregation (the "all instances" seam)
Launch every session as:
```
AGENT_DESKTOP_PANE=<uuid> \
AGENT_DESKTOP_SNAPSHOT_DIR=<app-support>/snapshots \
claude --settings '{"statusLine":{"type":"command","command":"<abs>/statusline-wrapper.js"}}'
```
- `--settings` **merges per-key**, overrides only `statusLine.command`, fires in the
  live TUI, and leaves global `settings.json` byte-identical (empirically verified).
- **`statusline-wrapper.js`** (installed to app-support `bin/`), per render: (a)
  `spawnSync` the user's real `~/.claude/hooks/statusline.js` with the same stdin and
  pass its stdout through verbatim (in-pane bar unchanged); (b) parse stdin and
  **atomically** (tmp + `rename`) write `snapshots/<AGENT_DESKTOP_PANE>.json`:
  ```json
  { "pane_id":"…", "session_id":"…|null", "model":"…",
    "task":"<in_progress activeForm>|null",
    "context_pct":<0-100|null>, "rate_limits":{…}|null,
    "cost":<usd|null>, "git":{…}, "ts":<unix> }
  ```
- **Rust `SnapshotWatcher`** (`notify`) watches the snapshot dir → emits each change to
  the frontend. Per-pane snapshot drives that pane's card; account rollup = newest
  `rate_limits` (account-global) + summed `cost` across panes.

Correctness rules: context from `used_percentage`/`remaining_percentage`/
`context_window_size` (**there is no `total_tokens`** field — the user's own
statusline reads a dead key); `rate_limits` is frequently absent (Pro/Max only, after
first API response, each window independent) → emit `null`; key the file on **pane
id**, not `session_id` (unstable across resume/fork); atomic write so the watcher never
reads a partial file; statusLine does **not** fire in `-p` mode (irrelevant — the app
runs interactive panes) and must not be combined with `--bare`.

### 4.4 Task detection
Comes mostly **free** from 4.3: the wrapper derives `task` from
`~/.claude/tasks/<session_id>/<N>.json` (the real location — `~/.claude/todos/` that
the statusline targets is **absent** on CC 2.1.158) → newest `in_progress` entry's
`activeForm`. Schema: `{id, subject, description, activeForm, status:
pending|in_progress|completed, blocks, blockedBy}` (read `activeForm`, fall back to
`subject`/`content` for forward/back compat). The app reads task per pane straight
from the snapshot it already watches. **Fallback** for sessions not launched by the
app: Rust also watches `~/.claude/tasks/` and `$TMPDIR/claude-ctx-<session>.json`
(`{session_id, remaining_percentage, used_pct, timestamp}`) directly. Each session card
shows model · context bar · `activeForm` · live/idle dot (snapshot `ts` heartbeat).

### 4.5 Session launcher
"New session" → pick a project folder (with a recent-folders list) → optional initial
prompt → Rust spawns `claude` in that cwd with the wrapper `--settings` +
`AGENT_DESKTOP_PANE`. Opens as a new leaf or splits the focused pane. Does **not**
auto-run slash commands (per "you drive").

### 4.6 Workflow board (generic, read-only)
Detect per repo: presence of `<repo>/.claude/commands/workflow/` and/or
`<repo>/.claude/skills/workflow/` → show a Workflow panel. Render by running **that
repo's own scripts with cwd = repo** (scripts resolve auth via
`git rev-parse --show-toplevel`):
- `next.sh [epic]` → Markdown to stdout → render directly.
- `epics.sh list` · `epics.sh get <key>` · `issues.sh <feature|task|bug|request>
  list|get <key>` → these print **a single line: the path to a temp JSON file**
  (the `jira_output` pattern). Rust captures the path, reads + parses the file, deletes
  it.

JSON shapes: list → `[{key, summary, status, type?, epic?}]`; `epics.sh get` →
`{key, summary, status, children:{total, by_status:[{status,count}], issues:[…]}}`;
`issues get` → adds `{assignee:{account_id,display_name}|null, subtasks[], blocked_by[],
blocks[]}`. **Read verbs only** (`list`/`get`/`next.sh`) — never
`create/update/transition/rank/delete`. Auth from the repo's own
`.claude/settings.local.json` (`.env.JIRA_USER_EMAIL`, `.env.JIRA_API_TOKEN`). Check
exit codes; surface auth errors instead of a blank board; the scripts' constants are
skipa-specific, so always run the *target repo's own copy*.

### 4.7 Persistence
Pane-tree + session registry (`{paneId, cwd, shell}`) → JSON in app-support, debounced
writes + write-on-quit. Restore: `JSON.parse` → `validateTree()` (re-assert
invariants, run `version` migrations) → re-spawn a PTY per leaf (shell + cwd, not live
process state — tmux-resurrect semantics). Optional `addon-serialize` to repaint
scrollback before reattach.

## 5. Data flow (steady state)
1. Keystroke in a focused pane → `term.onData` → `invoke('pty_write')` → PTY writer.
2. `claude` emits bytes → Rust read thread → `Channel.send` → `term.write(Uint8Array)`.
3. Every Claude render → wrapper writes `snapshots/<pane>.json` (atomic).
4. `SnapshotWatcher` → emit → StatusBar card + per-pane task badge + account rollup.
5. User opens a repo with `/workflow` → `WorkflowRunner` runs `next.sh`/`epics.sh` →
   board renders (read-only).

## 6. Error handling & edge cases
- **Statusline/snapshot:** best-effort; never break the in-pane bar; skip malformed
  snapshots; missing rate_limits/context → `null`; atomic tmp+rename.
- **PTY:** drop-slave for EOF; reap child on exit; kill-all on quit; channel-gone →
  stop read thread; sparse-env seeding for `claude` discovery.
- **xterm:** guard `fit()` on 0×0 container; WebGL context-loss → dispose → DOM;
  WebGL only on visible panes (≈16-context/page cap).
- **Workflow:** nonzero exit / missing `settings.local.json` / empty token → surface
  per-repo error; clean up `jira_*` / `workflow_next_*` temp files.
- **Pane tree:** re-`normalize()` ratios each commit; enforce ≥2-children invariant
  after every close; resolve focus before mutating on close; never regenerate `paneId`.

## 7. Testing strategy
- **Rust unit:** PtyManager lifecycle (spawn→read→resize→kill→reap), snapshot parsing,
  workflow temp-file-path parsing.
- **Rust integration:** pipe a synthetic statusline payload through
  `statusline-wrapper.js`, assert the snapshot JSON contents + atomicity.
- **Frontend unit (Vitest):** the pure pane-tree ops — split/close/resize/flatten/focus
  — highest bug density; property-style tests for invariants.
- **Component smoke:** TerminalPane mount/dispose leaves no leaked DOM/listeners/WebGL
  context.
- **Manual:** live in-app pane confirms the wrapper renders + writes a snapshot
  (statusLine doesn't fire in `-p`, so this is the one non-headless check).

## 8. Phasing / milestones
1. **Terminal core** — Tauri+SvelteKit SPA skeleton, one PTY pane running `claude`,
   xterm wired (fit + webgl), resize round-trip. *(walking skeleton)*
2. **Recursive tiling** — pane tree + splits + drag-resize + focus + session rail
   (tabs) + tree persistence.
3. **Usage aggregation** — install wrapper, launch via `--settings`, SnapshotWatcher,
   two-row status bar. *(confirm wrapper in a live in-app pane here.)*
4. **Task detection** — per-session cards/badges from snapshots + direct-watch fallback.
5. **Session launcher** — folder picker, recent folders, spawn-into-pane.
6. **Workflow board** — generic detection + read-only board via repo scripts.

## 9. Risks to verify during build
- Wrapper rendering inside a *live in-app* pane: exact env Claude injects, ~300ms
  cadence, shell-vs-argv invocation of `statusLine.command` (prefer abs path, no
  spaces). Verified by simulation; confirm in-app at milestone 3.
- Channel binary payload shape (JSON number-array vs raw ArrayBuffer): `Vec<u8>` →
  `Uint8Array` is the verified-safe default; optimize to raw only if measured.
- WebGL context cap is GPU/WebView-dependent (~16 is a planning ceiling, not a
  guarantee).
- `portable-pty` exact version/API spelling (`exit_code()` vs `success()`,
  `clone_killer` location) — pin in `Cargo.toml` and let the compiler confirm.

## Appendix A — verified technical reference

Empirically verified on this machine: `claude` 2.1.158, node v24.12.0, macOS 26.2.
Confidence per item from the research swarm (HIGH unless noted).

**A.1 `--settings` override (CONFIRMED, live-TUI verified)**
- `claude --settings <file-or-json>` accepts a file path **or inline JSON**; merges
  per-key over `settings.json` files for that session; omitted keys keep file values.
- Verified: with an inline `statusLine` override, the marker wrapper ran in the
  interactive TUI; with only a `permissions.deny` override, a user-global `allow`
  survived (proves merge, not replace); global `settings.json` byte-identical
  afterward; `transcript_path` stayed under the user's normal config dir (no
  `CLAUDE_CONFIG_DIR`).
- `statusLine` does **not** render in `-p`/print mode; `--bare` skips hooks/statusline.
- Env vars set on the spawned process reach the `statusLine.command`.

**A.2 statusline stdin schema (corrected)**
`model.display_name`, `model.id`; `workspace.current_dir`;
`context_window.{total_input_tokens, total_output_tokens, context_window_size,
current_usage, used_percentage, remaining_percentage}` — **no `total_tokens`**;
`rate_limits.{five_hour,seven_day}.{used_percentage, resets_at(unix s)}` (often
absent); `cost.total_cost_usd`; `session_id`; `exceeds_200k_tokens`.

**A.3 Task & context files (corrected)**
- Live tasks: `~/.claude/tasks/<session_id>/<N>.json` = `{id, subject, description,
  activeForm, status, blocks, blockedBy}`. `~/.claude/todos/<session>-agent-*.json`
  (the path statusline.js reads) is **absent** on 2.1.158 → its task display is a
  no-op. Watch both for compat.
- Context bridge: `$TMPDIR/claude-ctx-<session>.json` = `{session_id,
  remaining_percentage, used_pct, timestamp}` (`$TMPDIR` = `/tmp/claude-501` here, not
  `/tmp`); ephemeral; rejects session ids with `/ \ ..`.

**A.4 portable-pty backend** — see 4.1. API surface: `native_pty_system()`,
`openpty`, `MasterPty::{try_clone_reader, take_writer, resize}`,
`SlavePty::spawn_command`, `CommandBuilder::{new,args,cwd,env}`,
`Child::{wait,clone_killer}`, `ChildKiller::kill`. Use a Tauri `Channel<T>` (not
events) for output. Pitfalls: drop the slave for EOF; never `from_utf8` in Rust;
coalesce under flood; reap children; seed env.

**A.5 xterm.js 6** — scoped `@xterm/*` only. `@xterm/xterm@6.0.0` (canvas renderer
removed → DOM fallback); `addon-fit@0.11`, `addon-webgl@0.19`; optional `search@0.15`,
`web-links@0.11`, `unicode11@0.8`, `serialize@0.13` (verify patch with `npm view`).
WebGL context cap ~16/page → WebGL on visible panes only + `onContextLoss`→DOM. Theme
key is `selectionBackground` (not `selection`). `allowProposedApi: true` for
unicode11/serialize.

**A.6 SvelteKit + Tauri** — `adapter-static({fallback:'index.html'})`; `+layout.ts`:
`ssr=false`, `prerender=false`; `tauri.conf.json` `frontendDist:"../build"`,
`devUrl` on a fixed port (1420). Construct xterm in `onMount` (dynamic import),
dispose in `onDestroy`; don't construct inside a state-reading `$effect`.

**A.7 Workflow scripts** — detection: `<repo>/.claude/{commands,skills}/workflow/`.
`next.sh` → markdown stdout. `jira_output` helper makes `epics.sh`/`issues.sh` print a
temp-file path (read it, parse, delete). Read verbs only. Auth in repo
`.claude/settings.local.json` (`.env.JIRA_USER_EMAIL`/`.env.JIRA_API_TOKEN`); run with
cwd = repo; constants are skipa-specific.
