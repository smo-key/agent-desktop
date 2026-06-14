## Context

agent-desktop does not store subagents itself. The Rust backend (`src-tauri/src/subagents.rs`) reads Claude Code's own files under `~/.claude/projects/<project>/<session>/` — `workflows/<id>.json` for workflow agents and `subagents/**/agent-*.meta.json` (+ `.jsonl` transcripts) for standalone Task agents — and computes a session→subagents map. That map is produced in exactly one function, `subagents_for_sessions`, which feeds both:

- the `subagents_for` Tauri command (the frontend's initial **seed**), and
- the `start_subagents_watcher` filesystem watcher (live `overview://subagents` events).

On app close, the window `CloseRequested` handler flushes `layout.json` (persisting each pane's Claude session id) and then `PtyManager::kill_all()` terminates every `claude` child process. A subagent that was mid-flight is killed too, but its on-disk record is never updated — workflow records keep `state: "running"`, standalone agents keep a `tool_use` with no matching `tool_result`. On relaunch, restored panes re-spawn with `claude --resume <same session id>`, the watcher is seeded with those same session ids, re-reads the stale files, and the dead subagents reappear (running ones tick forever via `now - started_at`).

Because the app kills all of its own PTYs on close, **no app-owned subagent can outlive a restart**, and the watcher only ever watches app-owned sessions. So any subagent that started before the current app launch is provably dead.

## Goals / Non-Goals

**Goals:**
- After relaunch, do not surface subagents that started before the current app launch — neither running nor completed.
- Never hide a subagent that is genuinely live in the current run.
- Keep the fix at the single backend source so seed and live updates behave identically.

**Non-Goals:**
- No new persisted state or close-time bookkeeping (must survive a hard crash where the close handler never runs).
- No frontend changes; no change to the per-subagent schema or the `overview://subagents` event shape.
- Not rewriting stale on-disk records to `error`/`interrupted` — we filter the view, we do not mutate Claude's files.
- Not changing behavior for external (non-app-owned) sessions, which the watcher does not watch anyway.

## Decisions

**Decision: Threshold is the app launch time (Unix millis), captured once at Rust `run()` startup, held in Tauri managed state.**
The Rust backend process is started fresh on every app launch (close kills the process), so a `SystemTime::now()` captured at the top of `run()` is an accurate "this run began at" marker. It is read by both the `subagents_for` command and `start_subagents_watcher` so the seed and the watcher use one identical threshold.
- *Alternative — process start time via the OS:* equivalent in practice but more platform-specific; capturing `now()` at startup is simpler and explicit.
- *Alternative — per-pane respawn time:* more precise, but for restored panes it is ≈ launch time, and brand-new mid-run panes get new session ids with no pre-existing records. A single global launch time is sufficient and simpler.

**Decision: A subagent is "pre-launch" iff `started_at.is_some()` AND `started_at < launch_time`. Unknown `started_at` is kept.**
Zombies almost always carry a known `started_at` (workflow records include `startedAt`; standalone agents derive it from the transcript's first timestamp), so they filter reliably. A genuinely new subagent can momentarily lack a timestamp before its files are fully written; keeping unknown-timestamp records guarantees we never hide a live one. Erring toward "keep when unsure" is the safe direction — a brief stray record is far less bad than a vanished live agent.

**Decision: Filter in a pure helper `filter_pre_launch(subagents, launch_time)` applied inside `subagents_for_sessions`, after parsing/assembly.**
The existing parsers (`parse_session_subagents`, `parse_standalone_subagents`) stay untouched; the filter is a small, independently unit-testable function reusing the existing `subagents.rs` test harness. Applying it where the map is assembled means the emitted map is already clean, so frontend grouping (workflow phase headers derived from the agent list) collapses naturally when all of a group's agents are filtered — no frontend work.
- *Alternative — filter in the frontend store (`normalizeSubagents`):* splits the rule away from the producer and relies on the UI clock; rejected in favor of the single backend chokepoint.
- *Alternative — snapshot running ids on close and suppress by id:* needs new persisted state and silently fails on a hard crash; rejected.

## Risks / Trade-offs

- **A completed pre-launch subagent the user wanted to glance at is hidden** → Accepted: this is the agreed scope ("hide the whole list"); the data still exists in Claude's files if needed.
- **An unknown-`started_at` zombie could leak through** → Very unlikely (zombies carry timestamps); accepted as the cost of never hiding a live agent. If it ever surfaces, the record resolves on the next watcher pass.
- **Clock skew between record `started_at` and captured launch time** → Both are wall-clock Unix millis from the same machine/process clock; the realistic gap between "prior run" and "this launch" is large, so a strict `<` comparison is safe.
- **A subagent that legitimately started before launch and is still alive is dropped** → Cannot happen for watched sessions: the app kills all its PTYs on close, and only app-owned sessions are watched.
