## Context

This is a bundle of UX refinements to the agent inbox (`src/lib/overview/`),
the project coordinator (`src/lib/orchestration/`), session titles
(`src/lib/overview/titles.svelte.ts`), the app footer (`src/lib/usage/`), and a
keyboard binding. The relevant code already exists and is well-factored; most
items are localized edits to existing components plus two new footer actions and
one new setting. The app is Tauri + SvelteKit (Svelte 5 runes); git/PR shell-outs
go through Tauri commands, and the on-device title model is invoked via the
existing `session_focus` command.

Key current-state facts the design builds on:

- Agent status precedence (`roster.ts:rowFor`): a live process uses
  `liveEventStatus ?? ptyStatus`, where `liveEventStatus` is the event-sourced
  status (from Claude Code hooks) excluding a stale `finished`. The PTY-byte
  heuristic (`deriveStatus`) is only a fallback.
- Agent-card badges + status sub-line render in `Inbox.svelte` (`sessionRow`
  snippet, `rowSub()`); the coordinated badge is `<Icon name="git-branch"/>coordinated`,
  the coordinator badge is `<Icon name="bot"/>coordinator`.
- Archive vs delete: `archiveDecision(userHash)` → `delete` when empty, else
  `archive`; `workspace.closeAgent` archives (sets `closed:true`),
  `workspace.deleteAgent` removes the registry entry. The coordinator is currently
  hard-coded in `openAgentMenu` to offer **Delete only**.
- Agent tasks auto-archive via `taskAgentPanes` + the `$effect` in `+page.svelte`
  that calls `taskAgentReturnedToUser(status, timeline)` then `closeAgent`.
- The auto-advance-to-next-attention behavior already exists in `Inbox.svelte`
  (the `leftAttention` → 1s grace → advance effect); it is currently always on.
- Settings are per-slice in one JSON blob via `loadSettings` / `saveSettingsSlice`;
  the `voice` store is the canonical example of a boolean-setting store.
- Session titles are auto-generated from the user's messages, gated on the
  transcript `user_hash`, throttled to `TITLE_THROTTLE_MS = 120_000`. There is no
  user-set title path today.
- `gh` is installed and authenticated; the remote is a GitHub repo.

## Goals / Non-Goals

**Goals:**
- Make the roster read truthfully at a glance: correct coordination badge,
  archivable coordinator with a clear label, In-flight vs Needs-input that matches
  what the terminal is actually doing, and a status line that shows the agent's
  last words.
- Put the two common end-of-task actions (open/create PR into `main`; commit
  pending changes) one click away in the footer, reusing the existing
  auto-archiving agent-task mechanism.
- Add an opt-in auto-advance setting (default off) and session renaming, and keep
  auto-titles fresh after each message.
- Move the insert-filename shortcut to ⌘O.

**Non-Goals:**
- No changes to how agent tasks themselves run — the PR/commit actions reuse the
  existing spawn + `taskAgentPanes` auto-archive path verbatim.
- No full PR-management UI (no review, status checks, multi-base targeting). PRs
  always target `main`.
- No backend orchestration / coordinator-protocol changes.
- No change to the on-device title model itself, only when it is invoked.

## Decisions

### 1. Busy-while-idle status — detect Claude Code's active-work indicators
**Decision:** While an agent's terminal shows any Claude Code active-work
affordance, force that pane's status to **In flight** (`working`). Surface a
per-pane boolean `terminalBusy` (set by `TerminalPane` from a lightweight scan of
recent terminal output, the same way terminal links are detected) into the runtime
the roster reads. In `rowFor`, for a **live, non-coordinator** pane with **no
pending question**, `terminalBusy` overrides `liveEventStatus`/`ptyStatus` to
`working`. When the indicator disappears (work finishes or the user interrupts with
Ctrl-C/Esc), the flag clears and normal derivation resumes.

The indicator family covers two cases the event hooks miss:
- **(a) Foreground command** — the "esc to interrupt" / "ctrl+b to run in
  background" / "Running…" affordance, which appears for `! <cmd>` bash-mode runs
  and other foreground work.
- **(b) In-session background work** — the "Waiting for N dynamic workflow(s) to
  finish" (and equivalent background-agent/subagent) affordance shown after the
  main agent's turn has returned while a dynamic workflow or another agent is
  still running inside the session.

**Why:** A `!` bash-mode command emits no PreToolUse/PostToolUse hook, and a
returned main turn that still has a background workflow running emits a `Stop`
(idle) while work continues — so in both cases the event-sourced status reads
`waiting` and the card says "Needs input" even though the session is busy. The
terminal indicators are the unambiguous, version-tolerant signal that the session
is still working; neither is present at a genuine idle prompt, so the override
cannot mislabel a truly-waiting agent.

**Guards:** Only apply when `question == null && questions == null` so a pending
AskUserQuestion still reads as Needs input; never apply to the coordinator (its
existing needs-input suppression is unchanged); fail-safe — if no indicator is
present/recognized, behavior is exactly as today.

**Alternatives considered:** (a) Prefer fresh PTY `working` over event `waiting`
whenever bytes are recent — rejected: any idle redraw (notifications, cursor
restore) would flash In flight, and event-status was deliberately made
authoritative; it also would not catch a quiet background workflow. (b) A new
Claude Code hook bracketing bash-mode/background runs — rejected: out of our
control and `!` is intentionally hook-free.

### 2. Coordinator archive/delete — drop the special case, reuse the session rule
**Decision:** Remove the delete-only branch for the coordinator in
`openAgentMenu`; give it the same Archive/Delete affordance as ordinary sessions,
routed through `archiveAgent` → `archiveDecision(userHash)` (empty → `deleteAgent`,
non-empty → `closeAgent`). An archived coordinator (`role === 'coordinator' &&
closed`) renders a `<Icon name="bot"/> Coordinator` label on its row.

**Why:** The empty-session rule already encodes exactly "delete if nothing to
resume, else archive." A closed coordinator is already treated as not-live
(`findCoordinatorPane` requires `closed !== true`), so the project simply shows
"Start coordinator" again; restoring brings it back live.

**Edge:** If a user archives the coordinator, starts a new one, then restores the
old archived one, two non-closed coordinators could exist. The single-coordinator
gate is best-effort (`liveCoordinator` returns the first match); this is a rare
manual sequence and out of scope to fully arbitrate here.

### 3. Last-message line — generalize `rowSub`, retain last summary for archived
**Decision:** `rowSub` returns, in priority order: pending question
(`questions[0].question` or `question`) → last assistant message (`summary`) →
a short generic fallback (`Needs input` / `Working…` / `Archived`). This applies
to **all** lanes, including archived rows (which previously showed
"Archived · restore or delete"). Restore/Delete remain available via the context
menu and the archived lane grouping. To ensure an archived row still has a last
message when its live activity is no longer polled, cache the last-known
`summary` per `sessionId` (mirroring the title cache) and fall back to it.

**Why:** The user wants to always see what the agent said/asked. `summary` and
`question(s)` already exist on the row; the only gap is data retention for closed
panes, solved with a small persisted cache consistent with how titles persist.

### 4. PR button — `gh`-based detection, create via an auto-archiving agent task
**Decision:** Add a footer PR button immediately to the right of the
edited-files (modified) pill in `GitInfo`. Its state derives from a best-effort
`gh` lookup for the focused project's repo + current branch:
`gh pr list --head <branch> --base main --state open --json url,number` (via a new
Tauri command, cached per branch). 
- **PR exists** → button opens it (open the PR URL).
- **No PR** → confirm dialog ("Create a PR into main?"); on confirm, spawn an
  agent session (task) with a prompt to create the PR into `main`, added to
  `taskAgentPanes` so it auto-archives when it returns — identical to how agent
  tasks run today.
- **On the base branch (`main`)** or no branch/git → button **disabled**.

**Why:** Detection is required to choose open-vs-create and to open an existing
PR; `gh` is the established, authenticated tool. The heavy lifting (actually
creating the PR) is delegated to an agent task, matching the existing pattern and
avoiding bespoke PR-creation code.

**Degradation:** If `gh` is unavailable/unauthenticated or the lookup fails, the
button defaults to the create-confirm path (never silently opens nothing).

### 5. Commit button — confirm on the uncommitted-files pill → agent task
**Decision:** When the modified count > 0, the uncommitted-files pill becomes a
button; clicking opens a confirm dialog; on confirm, spawn an auto-archiving agent
task with a prompt to commit the pending changes (on the current branch, per the
repo's no-auto-branch rule). When the count is 0 it is inert (as today).

### 6. Auto-advance setting — new settings slice gating the existing effect
**Decision:** Add an `autoAdvance` boolean settings slice (default `false`) with a
store mirroring `voice` (`load`/`setEnabled`/`save` via `saveSettingsSlice`), a
row in `SettingsModal`, and a `load()` in `+page.svelte` `onMount`. Gate the
existing advance effect in `Inbox.svelte` so the grace-timer is only armed when
the setting is on. Manual ⌘↑/⌘↓ and the header next/prev buttons are unaffected.

### 7. Session rename — sticky manual title; reuse the inline-edit pattern
**Decision:** Extend the title store with a manual title path:
`setManualTitle(paneId, sessionId, title)` writes `byPane`/`bySession` and marks
the entry `manual: true`; `titleFor` returns it as today. `shouldRequest` returns
`false` for a `manual` entry, so auto-generation stops for renamed sessions
(manual sticks). The focus-pane header title (`Inbox.svelte` `.ttl`) becomes
click-to-edit and the context menu gains a **Rename** item; both reuse the inline
`<input>` edit pattern already proven in `SessionRail.svelte` (draft state,
Enter commits / Esc cancels / blur commits).

### 8. Title refresh cadence — re-derive after each user message
**Decision:** Reduce the title throttle so a new user message re-derives the title
promptly (lower `TITLE_THROTTLE_MS` to a small value, e.g. a few seconds, rather
than 120s). Generation stays gated on `user_hash` change (only re-titles when the
user's messages actually changed) and excludes manual titles. This yields
"updates after every message the user sends" without spamming the model
mid-stream.

### 9. ⌘O insert-filename
**Decision:** Change the handler in `+page.svelte` (`key === 'i'` → `'o'`), the
help registry in `shortcuts.ts` (`⌘I` → `⌘O`), and the pane menu label in
`paneMenu.ts` (`'⌘I'` → `'⌘O'`). ⌘O is currently unbound and reads naturally as
"open a file."

### 10. Coordinated badge icon
**Decision:** In `sessionRow`, the coordinated branch becomes icon-only,
`<Icon name="compass" size={9}/>` (no "coordinated" text), tooltip unchanged
("Spawned by the project coordinator"). `compass` exists in the icon set and does
not imply branching.

## Risks / Trade-offs

- **[Terminal-indicator brittleness]** Claude Code could change the running
  indicator text. → Match a small set of robust substrings; absence fails safe to
  current status derivation (no regression, just the old behavior).
- **[`gh` latency / auth / wrong account]** PR detection shells out to `gh`. →
  Best-effort with caching; failure degrades to the create-confirm path; the
  actual PR creation is an agent task that surfaces any auth errors in its pane.
- **[More frequent title model calls]** Lowering the throttle increases
  on-device model invocations. → Still gated on `user_hash` change (one call per
  actual new message) with a small floor throttle to avoid mid-typing churn;
  manual titles skip generation entirely.
- **[Archived last-message retention]** Closed panes may stop being polled,
  leaving `summary` stale/empty. → Persist a last-summary cache per `sessionId`
  (same shape as the title cache) and fall back to it for archived rows.
- **[Restore-collision on coordinator]** Restoring an archived coordinator after a
  new one started could yield two live coordinators. → Best-effort single-gate;
  documented edge, not arbitrated here.

## Open Questions

- None blocking. PR-status detection mechanism (new Tauri `gh` command vs.
  extending the existing git command surface) is an implementation detail resolved
  during apply.
