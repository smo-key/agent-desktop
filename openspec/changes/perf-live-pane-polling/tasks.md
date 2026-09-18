## 1. Rust

- [x] 1.1 Subagents watcher recomputes only the sessions a fs change touched, patching a shared cache; subagent transcript spans read a bounded head+tail with a size+mtime cache
- [x] 1.2 `events_for` sink/backfill reads and `activity_for` summaries cached by size+mtime
- [x] 1.3 `activity_for` / `events_for` / `subagents_for` / `usage_snapshots` marked `#[tauri::command(async)]`

## 2. Frontend

- [x] 2.1 `paneRefs.ts`: live vs all agent pane refs; route pollers + subagents watched-set use live only, mount-time seeding uses all
- [x] 2.2 `ActivityStore.refresh` merges per pane and preserves unchanged objects
- [x] 2.3 `EventStore` memoizes `activityFor` per timeline identity; `seed` skips an unchanged snapshot (`sameTimeline`)
- [x] 2.4 `rosterStore.svelte.ts`: one ref-counted clock + one derived roster shared by the alerts driver, keep-awake driver, and Inbox; status hysteresis memo moved there

## 3. Specs

- [x] 3.1 Deltas for `agent-overview` and `activity-timeline`; scenario titles match the new Rust/Vitest test names (coverage gate)
