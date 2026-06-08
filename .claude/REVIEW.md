# REVIEW.md — adversarial code review guide for agent-desktop

Read this before reviewing a diff in this repo. It is **not** a generic checklist —
it names the few places where bugs in *this* project actually live, the idioms you
must know to recognize them, and the verification commands that prove a finding.

Your charge is unchanged: prove the **code** is broken (real correctness bugs, edge
cases, races, regressions, leaks). Skip style, naming, and spec-coverage — those are
handled by `openspec-verify-change`. This file just tells you where to dig.

## What this app is

A **Tauri 2** desktop app: SvelteKit 2 + **Svelte 5 runes** frontend (`src/`) over a
**Rust** backend (`src-tauri/`). The frontend is a static SPA; the backend owns PTYs,
sidecar processes, Unix sockets, and the filesystem. The security/serialization
boundary between them is the single highest-risk surface — weight your review there.

Verify findings with:

```
npm run check      # svelte-kit sync + strict svelte-check (TS)
npm run test       # vitest run
npm run coverage   # scenario-coverage gate (tools/check-scenario-coverage.mjs)
```

A change touching behavior with no matching `*.test.ts` / `*.svelte.test.ts` is a
finding in itself — note the missing coverage with the scenario it leaves unguarded.

## The high-risk surfaces, in priority order

### 1. The Rust ⇄ frontend IPC boundary (`src-tauri/src/lib.rs`)

~50 `#[tauri::command]` functions, JSON-serialized. For any command in the diff:

- **Untrusted args reach the filesystem.** Path arguments must be canonicalized and
  contained — look for `resolve_path` and the filename whitelisting used for things
  like `.claude/agents/<name>.md`. A new command that joins a caller-supplied string
  into a path **without** that guard is a path-traversal / symlink-escape finding.
  Give the concrete `../../` or symlink input that escapes.
- **Atomic writes.** Persisted files (layout/settings, per-project
  `.agent-desktop/{tasks,config}.json` in `project_store.rs`) are written temp-then-
  rename. A plain write, or a temp filename that can collide on the same millisecond
  for concurrent saves, is a corruption finding.
- **Error redaction.** Errors crossing the boundary become strings to the renderer —
  flag anything that leaks absolute paths, env, or secrets into a returned `Err`.
- **Deserialization deferred to the frontend** is the convention; a command that
  trusts JSON shape it didn't validate, then acts on it, is fair game.

### 2. PTY lifecycle & per-pane threads (`src-tauri/src/pty.rs`, `pty_spawn` in lib.rs)

Each pane spawns a **blocking OS thread** running a read loop; output is coalesced
(~12 ms / 64 KiB batches) and pushed over a per-pane `Channel<PtyEvent>` (tagged
`Data | Exit`). Hunt for:

- **Teardown races / double-kill**: pane closed while its thread is mid-read; kill
  issued twice; `Exit` delivered after the channel/pane is gone.
- **Resource leaks**: a thread or child that outlives its pane because spawn
  half-failed, or a timer thread (e.g. usage-bootstrap reaper) that never joins.
- **Save/spawn ordering**: layout save and `pty_spawn` are not ordered with respect
  to each other — describe a sequence where a pane is persisted without a live PTY,
  or vice-versa.

### 3. Sidecar managers — Whisper / Llama servers (streaming, partials)

This branch is `add-whisper-server-partials`; streaming/partial output is exactly the
fragile part. Sidecars use lazy `OnceCell<CommandChild>` + `tokio::Mutex` for
serialized start, plus health-check polling with backoff. Look for:

- **Double-spawn race**: two callers pass the `OnceCell` check before either stores;
  two concurrent health-checks both decide to (re)start.
- **Partial-frame handling**: a streamed/partial transcript chunk split across reads,
  an empty/zero-length partial, or a final vs. partial ordering inversion. Give the
  byte-split or event sequence that breaks it.
- **Health-check timeout reaping** a process that was actually still starting.

### 4. Unix sockets & watchers

`events.sock` (event timeline from spawned sessions) and `control.sock`
(orchestration roundtrip; see `orchestration_reply` in lib.rs) plus the
SnapshotWatcher / EventState ring buffer + durable jsonl sink. Check: partial-file
reads from a watcher firing mid-write, a reply routed to a stale/closed target, and
per-target (not global) queueing assumptions that break under interleaving.

### 5. Svelte 5 runes state (`src/lib/**/*.svelte.ts`)

Convention here: **singleton classes exporting `$state` fields**, mutated directly,
with explicit `invoke()` calls to Rust (e.g. `src/lib/ui/toastStore.svelte.ts`,
`src/lib/layout/workspace.svelte.ts`). Notably this codebase uses **almost no
`$effect`/`$derived`** — so:

- Treat a **new `$effect`** with suspicion: self-triggering write-back loops, reads
  that won't be tracked, missing cleanup. Reproduce the loop or the stale read.
- Immutable tree ops (`layout/tree.ts`) are computed then committed to `$state` — a
  mutation that bypasses the commit, or commits a shared/aliased node, loses
  reactivity or corrupts the tree.
- State is mutated across un-awaited `invoke()` calls — describe the interleaving
  where PTY output and a layout mutation race on the same store.
- Timer/listener cleanup must happen in `onDestroy` — a leak here is a real finding.

## Reporting

Same format as the `adversarial-code-review` skill: `file:line` + what's wrong + a
**concrete failing scenario** (the input, byte-split, or event ordering that triggers
it). Rank **CRITICAL** (will misbehave) vs **WARNING** (worth a human look). If a path
above isn't touched by the diff, don't manufacture findings for it — say you found
nothing there.
