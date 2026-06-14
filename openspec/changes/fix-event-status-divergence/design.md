## Context

Event-sourced status is computed by `deriveEventActivity` (`src/lib/overview/events.ts`)
from a pane's ordered event timeline, held in the reactive `EventStore`
(`events.svelte.ts`, `byPane` keyed by paneId), fed live by the `overview://event`
listener and seeded from `events_for` (the durable per-session sink). The roster
prefers this event status over the PTY heuristic. Two divergence paths:

1. `deriveEventActivity` classifies status from the LAST event; `SubagentStop`
   falls to `default → null`, so a trailing background `SubagentStop` after a turn's
   `Stop` drops the settled `waiting` and exposes the row to PTY/`terminalBusy`/
   resize flicker.
2. The frontend timeline can diverge from the durable sink (a missed live event, or
   a frontend-only synthetic interrupt `Stop` that real activity later contradicts)
   and never reconciles — `events.seed()` runs only on session-set changes.

## Goals / Non-Goals

**Goals:** stop the flip; let a diverged event-status self-heal; honor genuine
interrupts but not stale ones. Keep the stable-event-status design (no PTY-overrides-
events change that reintroduces the idle-TUI bounce).

**Non-Goals:** coordinator path; the event-vs-PTY precedence for a genuinely-stable
`waiting`; re-touching the shipped `terminalBusy`/resize fixes.

## Decisions

### D1 (A) — `SubagentStop` preserves the last turn-boundary status

In `deriveEventActivity`, when `inFlight` is null and the most recent event is a
`SubagentStop`, scan backward for the last event that is NOT a `SubagentStop` and
classify from it (the existing turn-boundary rules). If none exists, fall back to
`null` (unchanged). Rationale: a background subagent finishing does not change the
PARENT's state — it should keep whatever the parent's last real turn boundary
established (`Stop` → `waiting`, `PostToolUse`/`UserPromptSubmit` → `working`). This
also resolves the spec/code drift (the spec already says `SubagentStop` → `waiting`)
while honoring the code's concern about not forcing `waiting` on a still-working
parent (if the prior boundary was `working`, it stays `working`).

- Alternative — make `SubagentStop` literally `waiting` (as the spec's words say):
  rejected; that would force `waiting` on a parent whose last boundary was
  `working` (e.g. mid-turn `PostToolUse` then a SubagentStop), the exact case the
  current `null` was protecting. Preserving the prior boundary is strictly better.

### D2 (B1) — Periodic safety re-seed of the event store

Add a slow interval (~5 s, a `EVENT_RESEED_MS` const) effect in `+page.svelte` that
calls `events.seed(currentPaneRefs())`, mirroring the transcript safety poll. `seed`
already MERGES (authoritative durable events + preserved newer/synthetic), so a
re-seed is safe and idempotent; it reconciles a frontend that missed a live push.

### D3 (B2) — Synthetic `Stop` preserved only while newest

`seed()` currently preserves `existing.filter(e => e.synthetic === true || e.ts >
snapshotLastTs)`. Change the synthetic clause to also require `e.ts > snapshotLastTs`
(i.e. preserve a synthetic `Stop` only when it is newer than the durable snapshot's
last real event). A synthetic `Stop` that real durable activity has SUPERSEDED
(snapshot has newer real events) is dropped → the row reflects the real working
tail. A genuine interrupt (synthetic `Stop` is the newest thing, no real activity
after) is still preserved → stays `waiting`. This is what makes the periodic
re-seed (D2) actually heal the spurious-synthetic-`Stop` divergence.

- Note: the live-ingest path already self-corrects when a real event arrives AFTER
  a synthetic `Stop` (it becomes the last event). D3 fixes the case where those
  real events only reached the durable sink (missed live), which D2 then re-seeds.

## Risks / Trade-offs

- [Periodic re-seed cost] → `events_for` is a cheap per-session sink read; ~5 s
  cadence matches the existing transcript poll. Negligible.
- [Dropping a synthetic `Stop` that was actually valid] → Only dropped when the
  durable snapshot contains a real event NEWER than the synthetic `Stop` — which
  means the agent genuinely produced turn activity after the interrupt, so it is
  correctly `working`, not interrupted. Safe.
- [A genuine interrupt with later idle-redraw output] → Idle redraws are PTY
  output, not hook events; they do not enter the event timeline, so they cannot
  supersede the synthetic `Stop` in the durable sink. The synthetic `Stop` stays
  newest → `waiting` preserved. Safe.

## Migration Plan

Pure frontend logic + one polling effect; no persisted data or schema change.
Rollback = revert the diff.

## Open Questions

None.
