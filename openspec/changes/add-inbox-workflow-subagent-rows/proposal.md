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
  the Inbox session list, under **every** session row (all lanes), not just the
  focused/active one.
- Show only **live** subagents: a subagent drops off the list as soon as it exits
  (any terminal status — `done`/`completed`/`success` or `error`/`failed`), so the
  list reflects in-flight work and does not accumulate finished rows.
- Group the nested rows by workflow, then by workflow phase, preserving phase
  order. The grouping is always expanded (no collapse control).
- Each subagent mini-row shows a **blue** (in-flight) status dot, the subagent
  label, and its **duration alive** — `durationMs` when present, otherwise
  `now − startedAt` ticking off the Inbox's existing clock.
- Add a **Sessions-panel setting to show/hide subagents**, persisted as the
  `subagentsVisible` slice of `settings.json` and **defaulting to shown**; when off,
  no subagent rows render under any agent.
- Extend the `Subagent` wire shape (Rust `subagents.rs` + TS `subagents.svelte.ts`)
  with `phaseTitle`, `phaseIndex`, `startedAt`, and `durationMs`, all pulled from
  the `workflowProgress` agent rows the parser already reads. Purely additive,
  all optional, tolerant of absent fields.
- Add a pure, unit-tested `groupSubagentsByPhase()` helper that buckets a
  session's subagents into ordered workflow → phase groups.
- Surface standalone `Task`/`Agent` subagents too (bare
  `subagents/agent-<id>.meta.json` + `.jsonl`, not under `subagents/workflows/`).
  These have no workflow or phase, so they render as a flat, ungrouped list under
  the parent (the same renderer path used for workflow subagents with no phase).
  Each carries: `label` from the meta's `description`, `startedAt`/`durationMs`
  from the sidecar `.jsonl` timestamps, and a `status` of running/done derived
  from the parent transcript's `tool_result` for the subagent's `toolUseId`.
  (This is the primary real-world case — sessions spawn `Agent()`/`Task`
  subagents far more often than `Workflow()` runs.)

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `agent-overview`: the `Surface Subagents` requirement is modified to specify
  Inbox rendering — nested under the parent agent on the In-flight and Needs-you
  lanes, grouped by workflow then phase (workflow subagents) or as a flat list
  (standalone Task subagents), always expanded, each row showing status, label,
  and duration alive. It covers BOTH workflow-spawned subagents and standalone
  `Task`/`Agent` subagents.

## Impact

- **Rust**: `src-tauri/src/subagents.rs` — add `phase_title`, `phase_index`,
  `started_at`, `duration_ms` to the `Subagent` struct and its
  `workflowProgress` parser; add a parser for bare standalone `Task` subagents
  (read `subagents/agent-*.meta.json` + `.jsonl` timestamps, derive done/running
  from the parent transcript's `tool_result`s); extend parser tests.
  `src-tauri/src/activity.rs` — widen `parse_iso_millis` to `pub(crate)` for reuse.
- **Frontend**: `src/lib/overview/subagents.svelte.ts` — mirror the four new
  fields on the `Subagent` interface. New pure helper (`groupSubagentsByPhase`)
  with unit tests. `src/lib/overview/Inbox.svelte` — render the grouped rows for
  In-flight and Needs-you lane rows, keyed by each pane's `sessionId`.
- No change to the `AgentRow` roster model, lane ordering, or selection logic —
  subagents remain a separate `sessionId`-keyed lookup.
- No new file scanning or watchers; reuses the existing `overview://subagents`
  event and `subagents_for` command.
