## Why

When the app is closed while subagents are running, it kills all PTYs (the `claude` processes) but their on-disk records under `~/.claude/projects/.../subagents/` are never flipped from `running` to `done`/`error`. On relaunch the app resumes the same sessions (`claude --resume`) and the subagents watcher re-reads those files, so dead subagents reappear in the overview and tick forever as if still active — misleading clutter that never resolves on its own.

## What Changes

- The subagents watcher and seed both exclude **pre-launch** subagents: any subagent whose `started_at` is known and earlier than the current app launch time is dropped from the session→subagents map.
- Subagents with an **unknown** `started_at` are kept, so a brand-new subagent that briefly lacks a timestamp is never hidden.
- Scope is the **whole** pre-launch list (running *and* completed): after relaunch the subagents panel is empty for resumed sessions and repopulates only with subagents spawned in the current run.
- No new persisted state, no close-time bookkeeping, and no frontend changes are required — filtering happens at the single backend source that feeds both the seed command and the live watcher.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `agent-overview`: the "Surface Subagents" requirement gains a rule that subagents predating the current app launch are excluded on relaunch (and that unknown-timestamp subagents are retained).

## Impact

- `src-tauri/src/subagents.rs`: new pure `filter_pre_launch` helper; `subagents_for_sessions` applies it using a launch-time threshold.
- `src-tauri/src/lib.rs`: capture app launch time once at startup into Tauri managed state; thread it into the `subagents_for` command and `start_subagents_watcher`.
- No schema, persistence, API surface, or frontend changes. Only app-owned watched sessions are affected (all killed on close), so nothing genuinely live is ever filtered.
