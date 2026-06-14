## Why

The sessions panel groups agents into fixed, deterministic lanes (Needs you / In
flight / Paused / Archived) derived from hook events and terminal activity. Those
lanes are not user-configurable, and the binary "needs you vs in flight" split
cannot express distinctions users actually care about — most notably "done" versus
"waiting on a subagent/workflow/other process to finish", a judgment the
deterministic heuristics struggle to make. We already run an on-device model
(Qwen, via the llama-server sidecar) for transcript polish and session titles;
the same model can classify a finished response into user-defined buckets, giving
users a personal, meaningful way to triage their agents.

## What Changes

- **New, opt-in auto-categorization (default OFF).** A Settings section lets users
  define an ordered list of **categories**, each with a `tag` (the token the model
  emits), a display `label`, a `color` (from a fixed on-theme palette), and a
  `rule` prompt describing what belongs there. One category is the designated
  **fallback**. Categories can be added, edited, reordered, and deleted.
- **Categories replace the panel grouping when enabled.** Idle / done-responding
  agents are grouped under the user's categories (in the user's order), bracketed
  by system groups: **Working** at the top (anything streaming right now) and
  **Paused** / **Archived** at the bottom. When the feature is OFF, the existing
  deterministic lanes render unchanged (zero behavior change).
- **On-device classification on turn completion.** When an agent finishes
  responding (`Stop`), the on-device model classifies it into exactly one category
  from its last assistant message **plus deterministic signals** (pending-question
  text, subagent/workflow-in-flight). Constrained decoding guarantees a valid tag.
  Unknown tag / model error / model unavailable → the **fallback** category;
  retried on the next finished response.
- **Seeded defaults (first enable):** **Needs You** (orange) · **Waiting** (gray) ·
  **Done** (green, = fallback), each with a starter rule prompt.
- **Drag between lanes, any time.** Users can drag a session into any user category,
  or onto **Paused** / **Archived** (which perform the existing pause / archive
  actions; dragging a paused/archived session onto a category restores it). A drop
  onto a category is a **one-time manual override** that holds until that agent's
  next finished response, when the model re-categorizes. **Working is system-derived
  and is NOT a drop target** — users cannot drag a session into Working.
- Out of scope: mass re-running inference when rules are edited (sessions
  re-categorize on their next finished response); arbitrary hex colors; a manual
  "re-categorize all" action; any change to the deterministic status derivation
  itself or to behavior when the feature is off.

## Capabilities

### New Capabilities

- `session-categorization`: the categories settings model (enable flag, ordered
  categories with tag/label/color/rule, designated fallback, validation +
  self-healing), the on-device classification engine (trigger on `Stop`, input
  assembly, constrained-decoding command, single-flight queue, tag→category
  mapping, fallback on failure), per-session assignment storage, and the one-time
  manual-override semantics.

### Modified Capabilities

- `agent-roster-display`: when categorization is enabled, the panel's top-level
  grouping is Working → user categories (in order) → Paused → Archived instead of
  the deterministic lanes; category group headers and row dots use each category's
  label and color; and sessions can be dragged between lanes (assign a category /
  pause / archive / restore), with Working excluded as a drop target.

## Impact

- New frontend module(s) under `src/lib/settings/` (categorization prefs store,
  pure validation/defaults) and `src/lib/overview/` (pure categorize input
  assembly + tag→category mapping + category grouping; reactive assignment store
  subscribing to `Stop` events, mirroring `titles.svelte.ts` / `events.svelte.ts`).
- `src/lib/overview/roster.ts` — a category-grouping path used only when enabled;
  the existing `groupByLane` path is untouched when disabled.
- `src/lib/overview/Inbox.svelte` — category-driven group headers/dots
  (parameterizing the hard-coded `LANES` map) and drag-to-lane handling reusing the
  existing lane drag-and-drop and pause/archive actions.
- `src/lib/ui/SettingsModal.svelte` — new "Session categories" section.
- `src-tauri/src/polish.rs` — a new `session_categorize` command (constrained
  decoding) alongside `voice_polish` / `session_focus`, sharing the llama-server
  sidecar; `src-tauri/src/lib.rs` command registration.
- Persistence: a new `categorization` slice via the existing
  `saveSettingsSlice`; per-session assignments cached by sessionId (like titles).
