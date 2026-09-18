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

## 4. Adversarial review fixes

- [x] 4.1 Prime the all-panes activity read AFTER layout restore (archived rows had no summary on a cold start)
- [x] 4.2 Record the status hysteresis memo for combined-terminal rows in the Inbox (`noteStatus`), not only agent rows
- [x] 4.3 Subagent span falls back to a whole-file scan when a window holds no stamped line (oversized first/last line)
- [x] 4.4 Backfill cache keyed by `(transcript, pane_id)` so two panes on one transcript never share stamped events
- [x] 4.5 `ActivityStore.retain` drops panes removed from every workspace (map no longer grows unbounded)
- [x] 4.6 Accepted (WARNING): a `subagents_for` seed that races a watcher patch can return one stale session until its next fs event or seed — same window as before, now healed only by a matching-path event
