## 1. Settings data model (pure + store)

- [ ] 1.1 Add pure category types + palette + defaults in `src/lib/settings/categories.ts`: `CategoryDef` (`id`, `tag`, `label`, `color`, `rule`), `CategorizationPrefs` (`enabled`, `categories`, `fallbackId`), the fixed color palette (keys → existing CSS tokens), the `MAX_CATEGORIES = 8` cap, and `DEFAULT_CATEGORIZATION_PREFS` (disabled) + `seedDefaultCategories()` (Needs You/orange, Waiting/gray, Done/green=fallback, with starter rule prompts).
- [ ] 1.2 Write pure validation/normalization in the same module: `validateCategories()` / `normalizePrefs()` enforcing ≥1 category, non-empty unique tags, palette-only colors, the cap, and `fallbackId` self-heal when it points at a missing category. (TDD: tests first.)
- [ ] 1.3 Add `CategorizationStore` in `src/lib/settings/categorization.svelte.ts` mirroring `voice.svelte.ts`/`titles.svelte.ts`: `$state` prefs, `load()`, setters (toggle enable, add/edit/delete/reorder category, set fallback) that normalize + `saveSettingsSlice('categorization', …)`.

## 2. Categorization engine — Rust command

- [ ] 2.1 Add `session_categorize` in `src-tauri/src/polish.rs`: build a chat-completion body from `{response, pendingQuestion, subagentInFlight, categories:[{tag,rule}]}`, with a system prompt that returns exactly one tag and constrained decoding (GBNF grammar / JSON-schema enum over the valid tags), thinking enabled; reuse `chat_complete` and the shared sidecar. Return the chosen tag.
- [ ] 2.2 Register the command in `src-tauri/src/lib.rs` and add a typed TS wrapper `invoke('session_categorize', …)` (e.g. `src/lib/overview/categorize.ts`).
- [ ] 2.3 Unit-test the body/grammar builder (Rust): the grammar/enum contains exactly the configured tags; the prompt includes response + signals; result parsing maps to a tag.

## 3. Categorization engine — input assembly + mapping (pure)

- [ ] 3.1 In `src/lib/overview/categorize.ts`, add pure `buildCategorizeInput(pane, transcript, signals)` assembling last assistant message + pending-question text + subagent/workflow-in-flight boolean (reuse the transcript source `titles` uses and the existing in-flight/pending detection).
- [ ] 3.2 Add pure `mapTagToCategory(tag, prefs)` → category id, returning the `fallbackId` for unknown/empty tags. (TDD.)

## 4. Assignment store + Stop-triggered classification

- [ ] 4.1 Add a reactive assignment layer to `CategorizationStore`: `byPane: Map<paneId,{categoryId,manual}>` (runtime) + persist last assignment by `sessionId` (like `titles.bySession`); `assignmentFor(pane)` resolves stale ids to fallback.
- [ ] 4.2 Subscribe to the `overview://event` stream (as `events.svelte.ts` does): on a `Stop` for a pane while enabled, enqueue a categorize job; implement a single-flight queue with per-pane coalescing (latest-wins); on result map tag→category and store (clearing the `manual` flag); on error/unavailable store the fallback.
- [ ] 4.3 Tests: assignment persistence by sessionId + runtime byPane; unknown tag→fallback; error→fallback; manual flag cleared on next classification; queue serializes + coalesces.

## 5. Panel grouping integration

- [ ] 5.1 Add a pure category-grouping function in `src/lib/overview/roster.ts` (e.g. `groupByCategory(rows, prefs, assignments)`) producing ordered groups Working → categories(in order) → Paused → Archived, with live-`working` precedence, paused/closed override, and unassigned→fallback. Leave `groupByLane` untouched. (TDD.)
- [ ] 5.2 In `src/lib/overview/Inbox.svelte`, render the category grouping when enabled: parameterize the hard-coded `LANES` map / CSS so group headers use each category's `label` and row dots use its `color`; fall back to the existing lane rendering when disabled.

## 6. Drag between lanes

- [ ] 6.1 Extend the existing roster drag-and-drop so a drop onto a category sets a one-time manual override (`byPane[pane]={categoryId,manual:true}`); a drop onto Paused/Archived invokes the existing pause/archive actions; a drop from Paused/Archived onto a category resumes/un-archives then assigns; reject drops INTO Working.
- [ ] 6.2 Pure tests for the drop→action resolution (category assign / pause / archive / restore / reject-Working) and that the manual override is cleared by the next `Stop` classification.

## 7. Settings UI

- [ ] 7.1 Add a "Session categories" section to `src/lib/ui/SettingsModal.svelte`: master enable toggle (off → rest dimmed); a reorderable category list (reuse the lane drag-reorder pattern) with per-row color-swatch picker, label input, tag input, rule-prompt textarea, fallback radio, and delete; plus Add-category (to the cap) and Reset-to-defaults; inline validation feedback.

## 8. Verify

- [ ] 8.1 Run the full unit suite (Vitest + Rust) green; confirm the disabled path renders the deterministic lanes with no inference (feature off = zero behavior change).
- [ ] 8.2 Manual smoke: enable the feature, watch agents auto-sort on completion (incl. a subagent-in-flight → Waiting case), drag a session to correct it (and confirm it re-categorizes on the next response), pause/archive via drag, and confirm fallback on a forced model failure.
- [ ] 8.3 `openspec validate add-session-auto-categorization --strict`.
