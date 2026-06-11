## 1. Coordinated badge → compass icon (agent-roster-display)

- [x] 1.1 In `Inbox.svelte` `sessionRow`, change the coordinated branch to an icon-only badge using `<Icon name="compass" size={9}/>` with no "coordinated" text; keep the `use:tooltip={'Spawned by the project coordinator'}`.
- [x] 1.2 Verify the badge styling still fits without the text label (adjust `coord-badge` padding/max-width if needed for an icon-only chip).
- [x] 1.3 Add/adjust a unit or component test asserting the coordinated badge renders the compass icon, no "coordinated" text, and keeps the tooltip.

## 2. Status line shows last message/question, incl. archived (agent-roster-display)

- [x] 2.1 Generalize `rowSub(r)` in `Inbox.svelte`: priority = pending question (`questions[0].question` ?? `question`) → last assistant message (`summary`) → short generic fallback; apply for ALL lanes including `closed`/`preview` (replace the `'Archived · restore or delete'` and bare `'Needs input'` returns with this). Fallback is STATE-APPROPRIATE (Archived/Paused/Errored/Needs input/cost/Working…), not a flat string.
- [x] 2.2 Ensure an archived row still has a last message: add a per-`sessionId` last-summary cache (mirroring the title cache in `titles.svelte.ts`) and fall back to it when live activity for a closed pane is unavailable.
- [x] 2.3 Keep Restore/Delete reachable for archived rows via the existing context menu (no regression).
- [x] 2.4 Add tests for `rowSub` covering: pending question, last-message, archived-with-last-message, and the generic fallback when neither exists.

## 3. In-flight vs Needs-input status (agent-status-derivation)

- [x] 3.1 In `TerminalPane.svelte`, detect Claude Code active-work indicators in recent terminal output — a small, robust substring set covering (a) the foreground-run affordance ("esc to interrupt" / "ctrl+b to run in background" / "Running…") and (b) the in-session background-work affordance ("Waiting for N dynamic workflow(s) to finish"). Expose a per-pane reactive `terminalBusy` flag (pure detection helper unit-tested with sample terminal text).
- [x] 3.2 Surface `terminalBusy` into the runtime/roster input the same way other per-pane runtime signals reach `rowFor`.
- [x] 3.3 In `roster.ts` `rowFor`, for a LIVE, non-coordinator pane with NO pending question (`question == null && questions == null`), override the derived status to `working` when `terminalBusy` is true; leave coordinator and pending-question paths unchanged; no indicator → unchanged behavior.
- [x] 3.4 Add tests: foreground-run busy → working; background-workflow busy → working; pending question → still waiting despite busy; no indicator → unchanged; coordinator unaffected.

## 4. Coordinator archive/delete + archived label (coordinator-lifecycle, agent-roster-display)

- [x] 4.1 In `Inbox.svelte` `openAgentMenu`, remove the coordinator delete-only special case; give a live coordinator the same Open/Pause/Archive items as ordinary sessions, routed through `archiveAgent` (so `archiveDecision` deletes an empty coordinator and archives a non-empty one). Archived coordinator still offers Delete.
- [x] 4.2 In `sessionRow`, when `r.role === 'coordinator' && r.closed`, render a `<Icon name="bot" size={9}/> Coordinator` badge on the row.
- [x] 4.3 Confirm restoring an archived coordinator resumes it as the project's live coordinator (existing `restoreAgent` + `findCoordinatorPane`); add a regression test for archive→restore.
- [x] 4.4 Add tests: archive non-empty coordinator → closed/retained; archive empty coordinator → deleted; archived coordinator shows the bot "Coordinator" label.
- [x] 4.5 Enforce one-coordinator-per-project: extend `startCoordinator` so that when an ARCHIVED coordinator exists for the project, "Start coordinator" RESTORES it (`workspace.restoreAgent`, focus, update `coordinatorPaneId`) instead of spawning a second coordinator. Add an `archivedCoordinatorPane`/`archivedCoordinator` finder mirroring `findCoordinatorPane` but `closed === true`.
- [x] 4.6 Tests: `startCoordinator` restores an archived coordinator (no duplicate, exactly one live coordinator after); and the real UI restore path (`previewArchived` → `commitPreview`) re-makes the coordinator live (`findCoordinatorPane`/`isLiveCoordinator` find it). Replace the tautological `archiveDecision` coordinator tests with assertions that actually exercise the coordinator archive/restore wiring.

## 5. Auto-advance setting (inbox-auto-advance)

- [x] 5.1 Create `src/lib/settings/autoAdvance.svelte.ts` (mirror `voice.svelte.ts`): `AutoAdvancePrefs { enabled: boolean }`, default `{ enabled: false }`, `parseAutoAdvancePrefs`, `AutoAdvanceStore` with `load`/`setEnabled`/`save` via `saveSettingsSlice('autoAdvance', …)`, singleton export.
- [x] 5.2 Add a "Focus behavior" row to `SettingsModal.svelte` with a checkbox bound to `autoAdvance.prefs.enabled` / `autoAdvance.setEnabled`.
- [x] 5.3 Call `autoAdvance.load()` in `+page.svelte` `onMount`.
- [x] 5.4 Gate the advance effect in `Inbox.svelte`: only arm the grace timer when `autoAdvance.prefs.enabled` (manual ⌘↑/⌘↓ and the next/prev buttons stay unconditional).
- [x] 5.5 Add tests: default off; parse coercion; effect does not advance when off and does when on.

## 6. Footer PR button (footer-actions)

- [x] 6.1 Add a Tauri command (e.g. `pr_status_for(cwd, base)`) that runs `gh pr list --head <branch> --base <base> --state open --json url,number` and returns the PR url/number or none; tolerate `gh` missing/unauth (return "unknown") without erroring.
- [x] 6.2 Add a frontend wrapper + small per-branch cache for PR status (best-effort, refreshed with git status).
- [x] 6.3 Add the PR button in `GitInfo.svelte` immediately to the right of the modified (edited-files) pill. Disabled when the branch is the base (`main`) or there is no branch/project.
- [x] 6.4 Wire behavior: PR exists → open it; no PR (or status unknown) → `confirmModal.show({…, confirmLabel: 'Create PR', onConfirm})`; on confirm spawn an agent task (prompt: create a PR into `main`) and add its pane to `taskAgentPanes` for auto-archive.
- [x] 6.5 Provide the create-PR agent prompt + ensure the spawn path reuses the existing `taskAgentPanes` mechanism in `+page.svelte`.
- [x] 6.6 Add tests for the pure parts: disabled-on-base logic, open-vs-create decision (exists/none/unknown), and the confirm→spawn wiring.
- [x] 6.7 Add a Tauri command (e.g. `open_prs_for(cwd, base)`) that runs `gh pr list --base <base> --state open --json number,reviewDecision` and returns the COUNT of open PRs targeting `base` that are awaiting review (reviewDecision not `APPROVED` — i.e. `REVIEW_REQUIRED`/empty) plus the repo's pull-requests URL; tolerate `gh` missing/unauth by returning a neutral unknown/0 without erroring.
- [x] 6.8 Add a frontend wrapper + small cache for the open-PRs count (refreshed alongside git status) and add the "open PRs awaiting review" button to the footer: a WARNING icon + the count when > 0, a CHECKMARK + `0` when none (or unknown). Clicking opens the repository's pull-requests page on GitHub via the existing external-open mechanism.
- [x] 6.9 Add tests for the pure parts: the warning-vs-checkmark + count selection (N>0 → warning+N; 0/unknown → checkmark+0) and the parsing of `gh` output into an awaiting-review count.

## 7. Footer commit button (footer-actions)

- [x] 7.1 In `GitInfo.svelte`, make the modified (uncommitted-files) pill a button when `modified > 0`; inert when 0.
- [x] 7.2 On click with changes, `confirmModal.show({…, confirmLabel: 'Commit', onConfirm})`; on confirm spawn an agent task (prompt: commit the pending changes on the current branch) added to `taskAgentPanes` for auto-archive.
- [x] 7.3 Add tests: click with files → confirm shown; confirm → spawn; cancel → no spawn; no files → no dialog.
- [x] 7.4 Surface the changed file PATHS for the uncommitted-files indicator (extend the git-status command/wrapper to return the file list, or add a command) and show a hover tooltip on the indicator listing the FIRST 10 file paths, with an indication when more than 10 exist. Show no list when there are no changes.
- [x] 7.5 Add tests for the tooltip content builder: lists the first 10 files; indicates overflow when > 10; empty/no-tooltip when there are no changes.

## 8. Exclude archived from project counters (project-agent-counters)

- [x] 8.1 In `projectRollup.ts`, filter `!r.closed && !r.preview` in `projectCounts()` (the `mine` array) and in `unassignedCount()`.
- [x] 8.2 In `ProjectPanel.svelte`, base the "all agents" total on the same non-archived filter rather than raw `rows.length`.
- [x] 8.3 Add tests for `projectCounts`/`unassignedCount` excluding archived/previewed rows.

## 9. Session rename (session-titles)

- [x] 9.1 Extend `titles.svelte.ts`: add a `manual` marker to `TitleEntry` and a `setManualTitle(paneId, sessionId, title)` that updates `byPane`/`bySession`, persists, and marks the entry manual; have `shouldRequest` return false for a manual entry (manual sticks).
- [x] 9.2 Make the focus-pane header title (`Inbox.svelte` `.ttl`) click-to-edit using the inline-input pattern from `SessionRail.svelte` (draft state; Enter/blur commit, Esc cancel) and commit via `titles.setManualTitle(...)`.
- [x] 9.3 Add a "Rename" item to `openAgentMenu` (live/paused sessions) that opens the same header inline edit.
- [x] 9.4 Add tests: `setManualTitle` persists + sticks; `shouldRequest` skips a manual entry; header edit commit/cancel behavior.

## 10. Title refresh after each user message (session-titles)

- [x] 10.1 Lower the title request throttle so a new user message re-derives the title promptly (reduce `TITLE_THROTTLE_MS` to a small floor; keep the `user_hash` gate and the manual-title skip).
- [x] 10.2 Add/adjust tests for `shouldRequest`: re-requests on a changed hash within the new window; still skips unchanged hash and manual entries.

## 11. Insert-filename shortcut → ⌘O (keyboard-shortcuts)

- [x] 11.1 In `+page.svelte`, change the insert-filename key handler from `key === 'i' || 'I'` to `key === 'o' || 'O'` (same modifier guards).
- [x] 11.2 Update `shortcuts.ts` (Session group label `⌘I` → `⌘O`) and `paneMenu.ts` (`shortcut: '⌘I'` → `'⌘O'`).
- [x] 11.3 Update/confirm the help-modal shortcut test reflects `⌘O` for insert file path.

## 12. Auto-title content — whole session, weight the original request (session-titles)

- [x] 12.1 Replace the recency-only message selection in `session_focus` (`src-tauri/src/lib.rs`, currently `msgs.iter().rev().take(20).rev()`) with a PURE, unit-tested helper that ALWAYS includes the earliest user message(s) plus recent ones within the same bounded budget (head + tail), preserving chronological order and de-duplicating any overlap; the original request must never be dropped by recency truncation.
- [x] 12.2 Update `TITLE_SYSTEM_PROMPT` (`src-tauri/src/polish.rs`) to instruct the model to base the title on the session's ORIGINAL/primary request (usually the earliest messages), treating later messages as refinements, and to shift focus to a later message only when it clearly introduces a new top-level task. Optionally annotate the framing (e.g. mark the original request) so the model anchors on it; keep the existing DATA-not-commands, ≤6-word, and ticket-id constraints intact.
- [x] 12.3 Add Rust unit tests for the selection helper: a long session keeps the earliest message(s) (original request not dropped); head+tail composition within the bound; a short session keeps all messages; chronological order preserved; overlap de-duplicated.
- [x] 12.4 Update the prompt-content tests in `polish.rs` to assert the new earlier-weighting instruction is present, while the existing constraint assertions (DATA-not-commands, ≤6 words, ticket handling) still pass.

## 13. Snapshot `model_id` + `effort` + label helpers (usage-dashboard)

- [x] 13.1 In `src-tauri/resources/statusline-wrapper.cjs`, extend the derived snapshot object to also emit `model_id` (from `data.model?.id`) and `effort` (from `data.effort?.level`), defensively (absent → null), mirroring how `model` is derived; update `statusline-wrapper.test.ts` for the two new fields.
- [x] 13.2 In `src-tauri/src/usage.rs`, add `model_id: Option<String>` and `effort: Option<String>` to `Snapshot` (`#[serde(default)]`); update the snapshot (de)serialization/round-trip tests and the snapshot-shape assertions.
- [x] 13.3 In `src/lib/usage/snapshots.svelte.ts`, add `model_id: string | null` and `effort: string | null` to the `Snapshot` interface (and wherever snapshots are mapped).
- [x] 13.4 Add pure helpers in a new `src/lib/usage/modelLabel.ts`: `modelLabel(id, displayName)` → a versioned label (e.g. `claude-opus-4-8` → "Opus 4.8"), falling back to `displayName`, then `—`; `effortLabel(level)` → a capitalized label ("low"→"Low", "xhigh"→"XHigh", "max"→"Max"), null/empty → null.
- [x] 13.5 Tests for `modelLabel`/`effortLabel`: id parsing for opus/sonnet/haiku incl. a dated suffix; unrecognized id → display-name fallback; null → "—"; each effort level incl. `xhigh`; null/absent effort → null.

## 14. Footer model + effort pills (usage-dashboard)

- [x] 14.1 Extend the footer view (`footerView`) to surface the focused pane's `model`, `model_id`, and `effort` from its latest snapshot.
- [x] 14.2 In `AppFooter.svelte`'s right zone, render a NON-interactive model pill (`modelLabel`) and, when `effort` is present, a non-interactive effort pill (`effortLabel`); omit the effort pill when null. Reuse the `.pill` styling as a plain element (no button/handler).
- [x] 14.3 Tests: `footerView` surfaces model/effort for the focused pane; a focused snapshot with no effort yields no effort value (pill omitted).

## 15. Agent card shows model instead of cost (agent-roster-display, agent-overview)

- [x] 15.1 In `roster.ts`, add `modelId: string | null` to `AgentRow`, sourced from `snapshot?.model_id` (alongside the existing `model`).
- [x] 15.2 In `Inbox.svelte`'s card meta (the `dollar-sign` + `costMeta(r.cost)` span, ~line 1022), replace it with the model label `modelLabel(r.modelId, r.model)` and a suitable non-cost icon; remove the per-card dollar amount.
- [x] 15.3 Tests/assertions: the card renders the model label and no `$` cost (and falls back to the display name when the id is unrecognized).

## 16. Uncommitted tooltip → count + commit popover (footer-actions)

- [x] 16.1 Revert the uncommitted-files indicator's tooltip to a COUNT-only string (e.g. "N uncommitted file(s)"); stop feeding the first-10 file list into the tooltip.
- [x] 16.2 Add a reusable `src/lib/usage/FooterPopover.svelte`: anchored above a footer pill (mirror `BranchPicker.svelte`'s fixed-position anchoring), a full-screen scrim for click-outside close + Escape, a SCROLLABLE body (`max-height` + `overflow-y`), and a PINNED bottom action slot that stays visible while the body scrolls.
- [x] 16.3 Wire the uncommitted-files pill to open a commit popover listing the changed files (from `projectGit`'s `GitStatus.files`) with a pinned "Commit now" action that runs the existing commit-agent flow (`spawnCommit`); inert when there are no changes.
- [x] 16.4 Tests: `FooterPopover` closes on outside-click and Escape; the commit popover lists the files and "Commit now" triggers the spawn; the count-only tooltip builder.

## 17. Push popover + commits-to-push (footer-actions)

- [x] 17.1 Add a `commits_to_push(repoPath)` Tauri command in `src-tauri/src/git.rs` running `git log @{u}..HEAD` (best-effort: no upstream / not a repo → empty list, never errors) returning a list of `{hash, subject}`; add a pure parse helper with unit tests.
- [x] 17.2 Register the command in the invoke handler and add a frontend wrapper.
- [x] 17.3 Wire the push (ahead) pill to open a push popover listing the commits-to-push with a pinned "Push now" action → existing `pushProject`; inert/empty-state when nothing is ahead.
- [x] 17.4 Tests: the parse helper (multiple commits, empty); the push popover lists commits and "Push now" triggers the push; nothing-ahead → inert.

## 18. PRs popover + draft handling (footer-actions, pr.rs)

- [x] 18.1 Extend `open_prs_for` (`src-tauri/src/pr.rs`) to fetch `gh pr list --base <base> --state open --json number,title,url,isDraft,reviewDecision` and return the PR LIST (`{number, title, url, is_draft, review_decision}`) alongside `pulls_url`; keep best-effort degradation (gh missing/unauth → neutral/empty). Update the pure parse helpers + tests.
- [x] 18.2 Derive the warning badge count from the list: count only `review_decision != APPROVED && !is_draft` (drafts never counted); warning+count when >0, else checkmark+0 (and on unknown).
- [x] 18.3 Wire the open-PRs pill to open a PRs popover listing the awaiting-review PRs sorted NON-DRAFT first then DRAFT; each PR row opens its `url` on GitHub; a pinned action opens `pulls_url`. Drafts are shown but not counted.
- [x] 18.4 Tests: parse the list; badge excludes drafts; the non-draft-first ordering; row-open and open-page wiring.

## 19. Popover action polish (footer-actions)

- [x] 19.1 Make each popover's pinned primary action ("Push now", "Commit now", "Open PRs page") CLOSE its popover immediately on click — close BEFORE running the (possibly async) action, so the popover doesn't linger during a push/open. Apply the same close-first to the PR-row open handler.
- [x] 19.2 Recolor the popover primary-action buttons BLUE (`--blue-tint` / `--info-500`), consistently across all three (so "Open PRs page" matches "Push now"/"Commit now" instead of the neutral style).

## 20. Footer follow-ups: PR #N bubble, orange buttons, review tooltips (footer-actions)

- [x] 20.1 Per-branch PR bubble: enhance the existing footer PR button (to the right of the uncommitted pill, SEPARATE from the open-PRs-awaiting-review button) so it ALWAYS shows on a GitHub repo (hidden when PR existence is `unknown` / non-GitHub): `PR #<number>` highlighted when a PR exists (click → open it); gray `PR` when none (click → create-PR confirm → agent task). Remove the base-branch `disabled`. Thread the PR number + visibility from AppFooter.
- [x] 20.2 Revert the three popover primary-action buttons ("Push now"/"Commit now"/"Open PRs page") to ORANGE (`--caution-tint` / `--caution-500`), consistently.
- [x] 20.3 Tooltips: the CLICKABLE push pill and CLICKABLE uncommitted-files pill say "Click to review" (drop "push to publish"); the inert push pill no longer says "push to publish".

## 21. Validate & gate

- [ ] 21.1 Re-run `npm run check` (svelte-check) and `npm run test` (vitest), and `cargo test` (manifest `src-tauri/Cargo.toml`) for the new/changed Rust (`usage` snapshot fields, `pr` list, `git` commits_to_push) and the statusline wrapper; fix any failures introduced by the new work. (`events::tests` SUN_LEN failures remain pre-existing/environmental — `events.rs` is untouched.)
- [ ] 21.2 Re-run `npm run coverage` (scenario coverage gate) and ensure every new scenario (footer popovers, review-action tooltip, push/commit popovers, open-PRs popover + draft exclusion, per-branch PR bubble, card model, footer model/effort pills, snapshot field shape) has a matching test.
- [ ] 21.3 Manually verify the headline flows in the running app. Original: coordinated compass badge + tooltip, archive a coordinator (+ label), `! sleep 999` shows In flight, a dynamic-workflow session shows In flight, last-message line incl. archived, auto-advance toggle, counters exclude archived, rename via header + menu, title refresh after a message, titles that reflect the original request in a long session, ⌘O inserts a filename. New: agent card shows model (e.g. "Opus 4.6") not cost; footer model + effort pills (effort omitted when unsupported); uncommitted tooltip says "click to review"; push pill → popover lists commits + "Push now" (tooltip "click to review"); uncommitted pill → popover lists files + "Commit now"; per-branch PR bubble shows "PR #N" / gray "PR" (create on click), separate from the open-PRs pill; open-PRs pill → popover lists PRs (active first, drafts last) with row-open + "open PRs page"; PR warning ignores drafts; popovers scroll with a pinned button and close on outside-click/Escape; popover primary-action buttons are ORANGE + consistent and clicking them closes the popover immediately.
