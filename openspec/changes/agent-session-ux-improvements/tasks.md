## 1. Coordinated badge → compass icon (agent-roster-display)

- [ ] 1.1 In `Inbox.svelte` `sessionRow`, change the coordinated branch to an icon-only badge using `<Icon name="compass" size={9}/>` with no "coordinated" text; keep the `use:tooltip={'Spawned by the project coordinator'}`.
- [ ] 1.2 Verify the badge styling still fits without the text label (adjust `coord-badge` padding/max-width if needed for an icon-only chip).
- [ ] 1.3 Add/adjust a unit or component test asserting the coordinated badge renders the compass icon, no "coordinated" text, and keeps the tooltip.

## 2. Status line shows last message/question, incl. archived (agent-roster-display)

- [ ] 2.1 Generalize `rowSub(r)` in `Inbox.svelte`: priority = pending question (`questions[0].question` ?? `question`) → last assistant message (`summary`) → short generic fallback; apply for ALL lanes including `closed`/`preview` (replace the `'Archived · restore or delete'` and bare `'Needs input'` returns with this).
- [ ] 2.2 Ensure an archived row still has a last message: add a per-`sessionId` last-summary cache (mirroring the title cache in `titles.svelte.ts`) and fall back to it when live activity for a closed pane is unavailable.
- [ ] 2.3 Keep Restore/Delete reachable for archived rows via the existing context menu (no regression).
- [ ] 2.4 Add tests for `rowSub` covering: pending question, last-message, archived-with-last-message, and the generic fallback when neither exists.

## 3. In-flight vs Needs-input status (agent-status-derivation)

- [x] 3.1 In `TerminalPane.svelte`, detect Claude Code active-work indicators in recent terminal output — a small, robust substring set covering (a) the foreground-run affordance ("esc to interrupt" / "ctrl+b to run in background" / "Running…") and (b) the in-session background-work affordance ("Waiting for N dynamic workflow(s) to finish"). Expose a per-pane reactive `terminalBusy` flag (pure detection helper unit-tested with sample terminal text).
- [x] 3.2 Surface `terminalBusy` into the runtime/roster input the same way other per-pane runtime signals reach `rowFor`.
- [x] 3.3 In `roster.ts` `rowFor`, for a LIVE, non-coordinator pane with NO pending question (`question == null && questions == null`), override the derived status to `working` when `terminalBusy` is true; leave coordinator and pending-question paths unchanged; no indicator → unchanged behavior.
- [x] 3.4 Add tests: foreground-run busy → working; background-workflow busy → working; pending question → still waiting despite busy; no indicator → unchanged; coordinator unaffected.

## 4. Coordinator archive/delete + archived label (coordinator-lifecycle, agent-roster-display)

- [ ] 4.1 In `Inbox.svelte` `openAgentMenu`, remove the coordinator delete-only special case; give a live coordinator the same Open/Pause/Archive items as ordinary sessions, routed through `archiveAgent` (so `archiveDecision` deletes an empty coordinator and archives a non-empty one). Archived coordinator still offers Delete.
- [ ] 4.2 In `sessionRow`, when `r.role === 'coordinator' && r.closed`, render a `<Icon name="bot" size={9}/> Coordinator` badge on the row.
- [ ] 4.3 Confirm restoring an archived coordinator resumes it as the project's live coordinator (existing `restoreAgent` + `findCoordinatorPane`); add a regression test for archive→restore.
- [ ] 4.4 Add tests: archive non-empty coordinator → closed/retained; archive empty coordinator → deleted; archived coordinator shows the bot "Coordinator" label.

## 5. Auto-advance setting (inbox-auto-advance)

- [x] 5.1 Create `src/lib/settings/autoAdvance.svelte.ts` (mirror `voice.svelte.ts`): `AutoAdvancePrefs { enabled: boolean }`, default `{ enabled: false }`, `parseAutoAdvancePrefs`, `AutoAdvanceStore` with `load`/`setEnabled`/`save` via `saveSettingsSlice('autoAdvance', …)`, singleton export.
- [x] 5.2 Add a "Focus behavior" row to `SettingsModal.svelte` with a checkbox bound to `autoAdvance.prefs.enabled` / `autoAdvance.setEnabled`.
- [x] 5.3 Call `autoAdvance.load()` in `+page.svelte` `onMount`.
- [x] 5.4 Gate the advance effect in `Inbox.svelte`: only arm the grace timer when `autoAdvance.prefs.enabled` (manual ⌘↑/⌘↓ and the next/prev buttons stay unconditional).
- [x] 5.5 Add tests: default off; parse coercion; effect does not advance when off and does when on.

## 6. Footer PR button (footer-actions)

- [ ] 6.1 Add a Tauri command (e.g. `pr_status_for(cwd, base)`) that runs `gh pr list --head <branch> --base <base> --state open --json url,number` and returns the PR url/number or none; tolerate `gh` missing/unauth (return "unknown") without erroring.
- [ ] 6.2 Add a frontend wrapper + small per-branch cache for PR status (best-effort, refreshed with git status).
- [ ] 6.3 Add the PR button in `GitInfo.svelte` immediately to the right of the modified (edited-files) pill. Disabled when the branch is the base (`main`) or there is no branch/project.
- [ ] 6.4 Wire behavior: PR exists → open it; no PR (or status unknown) → `confirmModal.show({…, confirmLabel: 'Create PR', onConfirm})`; on confirm spawn an agent task (prompt: create a PR into `main`) and add its pane to `taskAgentPanes` for auto-archive.
- [ ] 6.5 Provide the create-PR agent prompt + ensure the spawn path reuses the existing `taskAgentPanes` mechanism in `+page.svelte`.
- [ ] 6.6 Add tests for the pure parts: disabled-on-base logic, open-vs-create decision (exists/none/unknown), and the confirm→spawn wiring.

## 7. Footer commit button (footer-actions)

- [ ] 7.1 In `GitInfo.svelte`, make the modified (uncommitted-files) pill a button when `modified > 0`; inert when 0.
- [ ] 7.2 On click with changes, `confirmModal.show({…, confirmLabel: 'Commit', onConfirm})`; on confirm spawn an agent task (prompt: commit the pending changes on the current branch) added to `taskAgentPanes` for auto-archive.
- [ ] 7.3 Add tests: click with files → confirm shown; confirm → spawn; cancel → no spawn; no files → no dialog.

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

- [ ] 10.1 Lower the title request throttle so a new user message re-derives the title promptly (reduce `TITLE_THROTTLE_MS` to a small floor; keep the `user_hash` gate and the manual-title skip).
- [ ] 10.2 Add/adjust tests for `shouldRequest`: re-requests on a changed hash within the new window; still skips unchanged hash and manual entries.

## 11. Insert-filename shortcut → ⌘O (keyboard-shortcuts)

- [x] 11.1 In `+page.svelte`, change the insert-filename key handler from `key === 'i' || 'I'` to `key === 'o' || 'O'` (same modifier guards).
- [x] 11.2 Update `shortcuts.ts` (Session group label `⌘I` → `⌘O`) and `paneMenu.ts` (`shortcut: '⌘I'` → `'⌘O'`).
- [x] 11.3 Update/confirm the help-modal shortcut test reflects `⌘O` for insert file path.

## 12. Auto-title content — whole session, weight the original request (session-titles)

- [ ] 12.1 Replace the recency-only message selection in `session_focus` (`src-tauri/src/lib.rs`, currently `msgs.iter().rev().take(20).rev()`) with a PURE, unit-tested helper that ALWAYS includes the earliest user message(s) plus recent ones within the same bounded budget (head + tail), preserving chronological order and de-duplicating any overlap; the original request must never be dropped by recency truncation.
- [ ] 12.2 Update `TITLE_SYSTEM_PROMPT` (`src-tauri/src/polish.rs`) to instruct the model to base the title on the session's ORIGINAL/primary request (usually the earliest messages), treating later messages as refinements, and to shift focus to a later message only when it clearly introduces a new top-level task. Optionally annotate the framing (e.g. mark the original request) so the model anchors on it; keep the existing DATA-not-commands, ≤6-word, and ticket-id constraints intact.
- [ ] 12.3 Add Rust unit tests for the selection helper: a long session keeps the earliest message(s) (original request not dropped); head+tail composition within the bound; a short session keeps all messages; chronological order preserved; overlap de-duplicated.
- [ ] 12.4 Update the prompt-content tests in `polish.rs` to assert the new earlier-weighting instruction is present, while the existing constraint assertions (DATA-not-commands, ≤6 words, ticket handling) still pass.

## 13. Validate & gate

- [ ] 13.1 Run `npm run check` (svelte-check) and `npm run test` (vitest); fix any failures introduced by the change. Run `cargo test` (manifest `src-tauri/Cargo.toml`) for the Rust title-selection + prompt changes.
- [ ] 13.2 Run `npm run coverage` (scenario coverage gate) and ensure new scenarios are covered.
- [ ] 13.3 Manually verify the headline flows in the running app: coordinated compass badge + tooltip, archive a coordinator (+ label), `! sleep 999` shows In flight, a dynamic-workflow session shows In flight, last-message line incl. archived, auto-advance toggle, PR + commit footer buttons, counters exclude archived, rename via header + menu, title refresh after a message, titles that reflect the original request in a long session, ⌘O inserts a filename.
