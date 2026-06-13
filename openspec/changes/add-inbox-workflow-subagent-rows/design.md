## Context

The subagent data pipeline already exists end to end except for rendering:

- **Rust** `src-tauri/src/subagents.rs` — `subagents_for(sessions)` resolves each
  session's Claude project dir and `parse_session_subagents()` reads
  `workflows/<id>.json`, walking each run's `workflowProgress` array and keeping
  the `type == "workflow_agent"` rows. An `overview://subagents` file watcher
  re-emits the `sessionId → Subagent[]` map on change.
- **Frontend** `src/lib/overview/subagents.svelte.ts` — a runes store holding
  `bySession` (keyed by Claude `sessionId`), with `forSession(id)` and
  `usageList`. Seeded and kept current from `src/routes/+page.svelte`.
- The store is currently consumed only by `src/lib/overview/usage.ts` for cost
  aggregation. The current session list UI, `src/lib/overview/Inbox.svelte`
  (which replaced the old card `Overview.svelte`), renders no subagents.

The `workflowProgress` agent rows carry everything the UI needs and that the
current `Subagent` wire struct drops on the floor: `startedAt` (epoch ms),
`durationMs`, `lastProgressAt`, `state` (already mapped to `status`),
`phaseTitle`, and `phaseIndex`.

The roster (`AgentRow` in `roster.ts`) is a flat, `paneId`-keyed list; subagents
are a separate `sessionId`-keyed lookup. Each pane snapshot already exposes its
Claude `sessionId`, which is the bridge between the two.

## Goals / Non-Goals

**Goals:**
- Show workflow subagents as indented rows under their parent agent in the Inbox,
  on the In-flight and Needs-you lanes only.
- Group rows by workflow run, then by phase in phase order; always expanded.
- Each row: status indicator, label, and duration alive (live-ticking when running).
- Keep the data layer additive and tolerant; reuse the existing command + watcher.

**Non-Goals:**
- Standalone `Task`/`Agent` subagents (bare `subagents/agent-*.jsonl` with no
  phase/status/duration) — deferred; they need a separate parser.
- Collapse/expand controls; per-subagent dollar cost on the row.
- Any change to `AgentRow`, lane ordering, selection, or the roster data model.

## Decisions

**1. Extend the existing `Subagent` record rather than add a parallel feed.**
Add four optional fields — `phaseTitle`, `phaseIndex`, `startedAt`, `durationMs`
— to the Rust struct (serialized camelCase) and mirror them on the TS interface.
The parser already has these values in hand from each `workflowProgress` row;
this is a field-mapping change, not new I/O. *Alternative — a second command for
timing/phase:* rejected; it would double the watcher surface and re-resolve the
same files for no benefit.

**2. Grouping lives in a pure helper, not in Svelte.**
`groupSubagentsByPhase(subagents): WorkflowGroup[]` buckets a session's
`Subagent[]` by `workflowId`, then by `phaseTitle`, ordering phases by
`phaseIndex` and leaving subagents in their parser order within a phase. Pure and
unit-tested in isolation; `Inbox.svelte` stays thin glue. Records missing a
`workflowId` or `phaseTitle` fall into a stable "ungrouped" bucket rather than
being dropped, satisfying the partial-metadata scenario. *Alternative — group
inline in the Svelte template:* rejected; untestable and tangles ordering logic
into markup.

**3. Duration alive is computed at render time off the Inbox's existing clock.**
Finished subagents (`durationMs` present) show that value formatted. Running ones
(`startedAt` present, no final `durationMs`) show `now − startedAt`, where `now`
comes from the same reactive clock the Inbox already uses for relative
timestamps — so running durations tick without a new timer. A pure
`formatDurationAlive(sub, now)` keeps this testable. *Alternative — compute
duration in Rust:* rejected; Rust can't tick live, and `Date.now()` is the
frontend's job. (Scripts/back end stamping time would be stale between watcher
emits.)

**4. Lane restriction is applied at the call site in `Inbox.svelte`.**
Only rows the Inbox places on the In-flight and Needs-you lanes look up and render
subagents. The lane is already known where rows are rendered, so this is a guard,
not a roster-model change. Keeps Paused/Archived lanes compact per the spec.

## Risks / Trade-offs

- **Live duration causes frequent re-render** → reuse the Inbox's existing
  relative-time clock (already ticking for `lastTs`); add no new timer, so the
  cost is bounded to what the Inbox already pays.
- **`state` → status mapping may not cover every workflow lifecycle value** →
  the status indicator falls back to a neutral "running" style for unknown
  states; unknown/absent never throws, matching the tolerant-parsing scenario.
- **Spec previously claimed standalone Task-tool agents were surfaced** → this
  change narrows the requirement to match the actual parser; standalone agents
  are explicitly recorded as deferred so the gap is tracked, not silently dropped.
- **A workflow row missing `phaseTitle`/`workflowId`** → routed to an "ungrouped"
  bucket so it still appears, rather than being lost.

## Open Questions

None — scope, fields, grouping, lane restriction, and duration semantics are
settled with the user.
