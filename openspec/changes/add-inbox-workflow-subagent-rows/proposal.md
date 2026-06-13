## Why

The app already detects and parses workflow-spawned subagents — the Rust
`subagents_for` watcher reads each session's `workflows/<id>.json` run records
into a `sessionId → Subagent[]` map, and the `agent-overview` capability already
declares a `Surface Subagents` requirement. But that data is currently wired only
into usage/cost aggregation; the current Inbox (which replaced the old card
overview) renders no subagents at all. So when an agent kicks off a workflow, the
operator has no way to see — from the session list — that subagents are running,
what they are, or how long they have been alive. The detection is built; only the
surfacing is missing.

## What Changes

- Nest workflow-spawned subagents as indented rows under their parent agent in
  the Inbox session list, on the **In-flight** and **Needs-you** lanes only
  (paused/archived lanes stay compact).
- Group the nested rows by workflow, then by workflow phase, preserving phase
  order. The grouping is always expanded (no collapse control).
- Each subagent mini-row shows a status indicator (running / done / error), the
  subagent label, and its **duration alive** — `durationMs` when the subagent has
  finished, otherwise `now − startedAt` ticking off the Inbox's existing clock.
- Extend the `Subagent` wire shape (Rust `subagents.rs` + TS `subagents.svelte.ts`)
  with `phaseTitle`, `phaseIndex`, `startedAt`, and `durationMs`, all pulled from
  the `workflowProgress` agent rows the parser already reads. Purely additive,
  all optional, tolerant of absent fields.
- Add a pure, unit-tested `groupSubagentsByPhase()` helper that buckets a
  session's subagents into ordered workflow → phase groups.
- Narrow the existing `Surface Subagents` requirement to match reality: it
  currently claims standalone "Task-tool agents" are surfaced, but the parser
  only reads workflow-run agents and nothing renders them. Standalone
  `Task`/`Agent` subagents (bare `subagents/agent-*.jsonl` with no phase, status,
  or duration data) are explicitly **out of scope** here and deferred.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `agent-overview`: the `Surface Subagents` requirement is modified to specify
  Inbox rendering — nested under the parent agent on the In-flight and Needs-you
  lanes, grouped by workflow then phase, always expanded, each row showing status,
  label, and duration alive — and is narrowed to workflow-spawned subagents
  (standalone Task-tool agents deferred).

## Impact

- **Rust**: `src-tauri/src/subagents.rs` — add `phase_title`, `phase_index`,
  `started_at`, `duration_ms` to the `Subagent` struct and its
  `workflowProgress` parser; extend existing parser tests.
- **Frontend**: `src/lib/overview/subagents.svelte.ts` — mirror the four new
  fields on the `Subagent` interface. New pure helper (`groupSubagentsByPhase`)
  with unit tests. `src/lib/overview/Inbox.svelte` — render the grouped rows for
  In-flight and Needs-you lane rows, keyed by each pane's `sessionId`.
- No change to the `AgentRow` roster model, lane ordering, or selection logic —
  subagents remain a separate `sessionId`-keyed lookup.
- No new file scanning or watchers; reuses the existing `overview://subagents`
  event and `subagents_for` command.
