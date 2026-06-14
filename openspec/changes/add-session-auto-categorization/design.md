## Context

The sessions panel (`src/lib/overview/Inbox.svelte`) groups agents into four fixed
lanes — `attn` (Needs you), `flight` (In flight), `paused`, `done` (Archived) —
computed by `roster.ts` (`laneForRow` / `groupByLane`) from a deterministic
`AgentStatus` (`working | waiting | finished | error | idle`) derived in
`events.ts` (hook events) with a PTY/terminal-activity fallback. Lane order, colors,
and labels are hard-coded (`LANE_ORDER`, the `LANES` map, CSS classes).

The app already runs an on-device model — Qwen via a `llama-server` sidecar
(`src-tauri/src/polish.rs`), exposed as an OpenAI-compatible endpoint — for two
existing features: transcript polish (`voice_polish`) and session titles
(`session_focus`). Title generation already reads the per-session transcript
(transcript-by-cwd) and runs Qwen with thinking enabled; categorization reuses the
same plumbing. Settings are modular slices persisted through
`saveSettingsSlice(key, value)` (`src/lib/settings/persist.ts`), each backed by a
`$state` store (e.g. `voice.svelte.ts`, `titles.svelte.ts`, `uiPrefs.svelte.ts`).
Drag-to-reorder already exists for the `attn` and `paused` lanes (persisted via
`uiPrefs.laneOrder`), and Tauri's native drag-drop is already disabled
(`dragDropEnabled: false`) so in-page HTML5 DnD works.

This change adds a user-configurable, on-device-model-driven categorization layer on
top of that, replacing the panel grouping when (and only when) the user opts in.

## Goals / Non-Goals

**Goals:**
- Let users define, color, label, reorder, and delete categories, each with a `rule`
  prompt and machine `tag`, plus one designated fallback — all in Settings.
- When enabled, group idle/done-responding agents by category, bracketed by system
  groups Working (top) and Paused/Archived (bottom).
- Classify a finished response into exactly one category using the on-device model,
  grounded with deterministic signals (pending question, subagent-in-flight).
- Let users drag sessions between lanes at any time (assign category / pause /
  archive / restore), with a manual drop being a one-time override.
- Zero behavior change, and zero inference, when the feature is off (the default).

**Non-Goals:**
- Re-running inference across all sessions when rules change (sessions re-categorize
  on their next finished response).
- Arbitrary hex colors (a fixed on-theme palette only) or a manual "re-categorize
  all" button.
- Changing the deterministic `AgentStatus` derivation, the PTY fallback, or any
  Working/Paused/Archived semantics.
- Cloud fallback for categorization (unlike titles); on failure we use the fallback
  category.

## Decisions

### D1 — Categories replace grouping; system groups bracket them
When enabled, grouping is **Working → ⟨categories in user order⟩ → Paused →
Archived**. Working/Paused/Archived stay system-owned because they are not about
response content: Working = an agent deterministically `working` (streaming) right
now; Paused/Archived = explicit user actions. Only idle/done-responding agents are
bucketed by category. *Alternative considered:* categories as a badge overlay on the
existing lanes — rejected; the user wants categories to BE the grouping. *Alternative:*
let a category rule match live/streaming agents — rejected; there is no finished
response to read mid-stream, so it would be fragile.

### D2 — Live-`working` precedence over stored category
A session that is deterministically `working` renders in Working regardless of its
stored category; when it next `Stop`s it is (re)categorized and moves into a
category. This keeps "what's running right now" honest and avoids showing a stale
bucket for an actively streaming agent.

### D3 — Classify on `Stop`, from last response + deterministic signals
The reactive assignment store subscribes to the same `overview://event` stream the
event store uses; a `Stop` for a pane (with the feature on) enqueues a categorize
job. The model input is the last assistant message (from the transcript source
`titles` already uses) plus structured signals: pending-question text (if any) and a
subagent/workflow-in-flight boolean. These signals are facts the 1.7B model cannot
reliably infer from prose and directly serve the default Waiting bucket. *Alternative:*
response text only — rejected as less reliable; *transcript tail* — rejected for
cost/latency and over-weighting older turns.

### D4 — One classification call, constrained decoding, no privileged category
A single Rust command `session_categorize` (in `polish.rs`, sharing the sidecar)
builds one chat-completion: system prompt "pick exactly one tag", user content =
signals + response + the `{tag, rule}` list. Output is constrained (GBNF grammar /
JSON-schema enum over the valid tags) so the result is always a parseable, valid
tag; thinking is enabled (titles found this materially improves the 1.7B model). No
category is hard-coded — even a literal pending question is passed as a *signal* and
the user's rules decide, so renaming/deleting categories never breaks a privileged
path. *Alternative:* a per-category "needs-input" pin that bypasses the model for the
unambiguous case — rejected for uniformity and full user control.

### D5 — Single-flight queue, fallback on failure
Categorize calls are serialized (the sidecar is shared with polish + titles) and
coalesced per pane (latest-wins) to bound on-device load. Unknown tag / error /
model-unavailable → the designated **fallback** category; the session re-categorizes
on its next finished response. *Alternative:* keep previous category on failure —
rejected because a never-categorized session with a dead model would sit
uncategorized; *revert whole panel to deterministic lanes when the model is down* —
considered as an optional enhancement, not required.

### D6 — Settings data model + validation
New `categorization` slice:
`{ enabled: boolean; categories: CategoryDef[]; fallbackId: string }` where
`CategoryDef = { id; tag; label; color; rule }` and order is array position.
Validation (pure, unit-tested): ≥1 category; non-empty, unique `tag`s; `color` from
the fixed palette; `fallbackId` references an existing category, else self-heal to
the first/last category. Seeded defaults on first enable: Needs You (orange) /
Waiting (gray) / Done (green, fallback). Capped at 8 categories to keep the prompt
small. Persisted via `saveSettingsSlice('categorization', …)`; a `CategorizationStore`
mirrors `voice`/`titles`.

### D7 — Assignment storage
`CategorizationStore` holds `byPane: Map<paneId, { categoryId; manual: boolean }>`
(runtime) and persists the last assignment by `sessionId` (like `titles.bySession`)
so it shows instantly on reload and survives polling.

### D8 — Drag between lanes; one-time manual override
Dragging a row onto a category sets `byPane[pane] = { categoryId, manual: true }`;
the override holds until that pane's next `Stop`, which runs the model and overwrites
it (manual flag cleared). Dropping on Paused/Archived invokes the existing
pause/archive actions; dragging a paused/archived row onto a category restores
(resume/unarchive) it and applies the one-time assignment. **Working is not a drop
target** (system-derived) — a row may be dragged *out* of Working to Paused/Archived,
but cannot be dropped *into* Working. Intra-category reordering follows the existing
most-recently-added-first + persisted-drag conventions for hand-reorderable lanes.

## Risks / Trade-offs

- **On-device load from frequent `Stop`s across many agents** → single-flight queue +
  per-pane coalescing; categorization is background and lower priority than
  interactive polish.
- **1.7B model misclassifies nuanced rules** → constrained decoding guarantees a
  valid tag (never a crash); deterministic signals ground the common cases; users can
  drag to correct (one-time) and refine rule prompts; fallback catches the rest.
- **Latency from thinking-enabled inference** → acceptable because it is background;
  the row simply shows its previous/fallback category until the result lands.
- **Divergence from the in-flight deterministic-status work** → categorization is a
  pure additive layer over `AgentStatus`; it does not alter derivation, so it composes
  with `agent-status-derivation` rather than competing with it.
- **Stored category id no longer exists (user deleted it)** → treated as fallback at
  read time; no migration needed.

## Migration Plan

Additive and opt-in. The slice is absent on existing installs → `enabled: false` →
the deterministic lanes render exactly as today. No data migration. Rollback = ship
with the feature flag defaulting off (or remove the Settings section); stored
`categorization` slices are ignored when the code is absent.

## Open Questions

- None blocking. Optional future enhancement: revert the whole panel to deterministic
  lanes while the model is entirely unavailable (D5 alternative), and a manual
  "re-categorize all" action — both deferred as out of scope.
