## Why

Two agent-overview status bugs, both traced to the **event-sourced status diverging
from reality** (the authoritative durable sink), confirmed from live event logs:

- **Flip** ("Fix GitHub Actions…"): after a turn's real `Stop` (→ `waiting`), a
  trailing background `SubagentStop` arrives. `deriveEventActivity` classifies on
  the *last* event and `SubagentStop` falls through to `null`, so the roster drops
  the settled status and falls back to the flickery PTY/`terminalBusy` heuristic →
  it bounces In-flight↔Needs-you (worse on click, via the resize redraw). The
  durable spec already says `SubagentStop` with no subsequent activity yields
  `waiting`, so the code also *drifts from spec* here.
- **Stuck** ("Update Coordinator…"): the durable sink shows the agent actively
  `working`, yet the UI shows Needs-you. The frontend event store diverged from
  the sink (a missed live `overview://event`, or a frontend-only synthetic
  interrupt `Stop` that real activity later contradicted) and **never reconciles**:
  `events.seed()` runs only when the session set changes — there is no periodic
  safety re-seed (the transcript store has a ~5 s poll; the event store has none).
  Because event-status authoritatively overrides live PTY output, the divergence
  pins the agent in the wrong lane indefinitely.

## What Changes

- **A — A trailing `SubagentStop` preserves the settled status.** When the most
  recent event is a `SubagentStop` and no tool is in flight, the derived status is
  the most recent *turn-boundary* status (`Stop`/`Notification`/`SessionStart`/
  `SessionEnd` → `waiting`/`finished`; `UserPromptSubmit`/`PostToolUse` → `working`)
  rather than `null` (PTY fallback). This stops the bounce and removes the
  spec/code drift, without forcing `waiting` on a still-working parent.
- **B1 — The event timeline self-heals via a periodic safety re-seed.** The event
  store is re-seeded from `events_for` (the durable sink) on a slow safety interval
  (~5 s), mirroring the transcript safety poll, so a frontend that missed a live
  event reconciles within the interval instead of staying wrong forever.
- **B2 — A synthetic interrupt `Stop` is honored only while it is the newest
  activity.** `seed()` preserves a frontend-only synthetic `Stop` only when its
  timestamp is newer than the durable snapshot's last event. A synthetic `Stop`
  that real durable activity has superseded is dropped on re-seed (the interrupt
  clearly didn't stick), while a genuine interrupt (newest, no activity after) is
  still honored — so B1 actually heals the spurious-synthetic-`Stop` case.
- Out of scope: changing the event-vs-PTY precedence for genuinely-stale stable
  `waiting` (the idle-TUI bounce risk); the coordinator path; the `terminalBusy`
  and resize fixes already shipped.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `activity-timeline`: clarify `SubagentStop` status derivation (A); make the
  seed-merge preserve a synthetic interrupt `Stop` only while it is the newest
  activity (B2); add periodic reconciliation of the event timeline (B1).

## Impact

- Frontend:
  - `src/lib/overview/events.ts` — `deriveEventActivity`: a trailing `SubagentStop`
    (no in-flight tool) classifies from the last non-`SubagentStop` turn-boundary
    event instead of returning `null`.
  - `src/lib/overview/events.svelte.ts` — `seed()`: preserve a synthetic `Stop`
    only when `ts > snapshotLastTs` (treat it like a live event for preservation).
  - `src/routes/+page.svelte` — add a slow (~5 s) periodic `events.seed(...)`
    reconciliation effect (alongside the existing session-set-change re-seed).
- Tests: `deriveEventActivity` SubagentStop-preserves-status cases; `seed()`
  drops a superseded synthetic `Stop` but keeps a still-newest one; (the periodic
  re-seed wiring is a thin effect — covered by the seed unit tests + manual).
