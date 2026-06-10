## Why

The agent inbox, coordinator, and footer have accumulated rough edges that slow
the multi-agent workflow: a noisy "coordinated" text label with a misleading
branch icon, a coordinator that can only be deleted (never archived), agents that
read "Needs input" while a foreground shell command is still running, status
lines that hide what the agent actually last said, no way to rename a session,
archived agents inflating project counts, and no one-click path from "the work is
done" to "open a PR / commit it." This change clears those rough edges in one
pass so the at-a-glance roster tells the truth and the common end-of-task actions
are one click away.

## What Changes

- **Coordinated-agent badge** — drop the "coordinated" text; keep only an icon,
  switched from the branch icon (`git-branch`) to `compass` so it no longer reads
  as a git branch. The hover tooltip ("Spawned by the project coordinator") stays.
- **Coordinator can be archived** — the coordinator's context menu gains Archive
  (and an archived coordinator can later be deleted), matching ordinary sessions
  instead of being delete-only. An **empty** coordinator (no user messages) still
  deletes outright, following the same empty-session rule as other sessions. An
  archived coordinator shows a `<bot icon> Coordinator` label on its row.
- **Busy-while-the-loop-looks-idle status** — while Claude Code is actively
  working but its event hooks report idle, the agent shows **In flight** rather
  than **Needs input**, until the work finishes or the user interrupts it. Two
  cases: (a) a foreground command running in the terminal (the "Running… / esc to
  interrupt / ctrl+b to run in background" state, e.g. from `! sleep 999`); and
  (b) in-session background work — a dynamic workflow or another agent still
  running within the session (the "Waiting for N dynamic workflow(s) to finish"
  state) after the main agent's turn has returned.
- **Auto-advance setting** — a new on/off setting controls whether focus
  auto-advances to the next Needs-Input agent after the current one is handled.
  Defaults to **off** (no auto-advance); manual ⌘↑/⌘↓ navigation is unaffected.
- **Last-message line** — the agent-card status line always shows the agent's last
  message or pending question (not just the generic "Needs input"), including for
  archived agents. A short generic fallback remains only when there is genuinely
  no message or question yet.
- **PR button (footer)** — a PR button sits to the right of the edited-files count.
  When no PR targets `main` from the current branch, clicking it opens a confirm
  dialog; on confirm it spawns an agent session (task) that creates the PR into
  `main` and auto-archives (exactly how agent tasks run today). When a PR already
  exists, clicking opens it. The button is disabled when the current branch is the
  base branch (`main`), where there is nothing to PR.
- **Commit button (footer)** — clicking the uncommitted-files indicator when there
  are changes opens a confirm dialog; on confirm it spawns an agent session (task)
  that commits the changes and auto-archives.
- **Project counters exclude archived** — archived (closed/previewed) agents are no
  longer counted in the per-project, unassigned, or all-agents counters.
- **Rename a session** — the user can rename a session by clicking its title in the
  focus-pane header or via the agent card's context menu. A manually-set title is
  sticky: auto-title generation stops for that session and never overwrites it.
- **Titles refresh after every user message** — auto-generated titles are
  re-derived promptly after each new user message (not only on a long throttle),
  for sessions that have not been manually renamed.
- **Insert-filename shortcut → ⌘O** — the insert-file-path shortcut moves from ⌘I
  to ⌘O (help modal and pane menu updated to match).

## Capabilities

### New Capabilities
- `agent-roster-display`: how an agent card renders its role/coordination badge,
  archived-coordinator label, and the status sub-line (last message / question).
- `coordinator-lifecycle`: archiving vs deleting the project coordinator, including
  the empty-session rule and the archived-coordinator label.
- `agent-status-derivation`: classifying an agent as In flight vs Needs input,
  including the foreground-process-running case and in-session background work (a
  dynamic workflow or another agent still running while the main loop looks idle).
- `inbox-auto-advance`: the opt-in setting that gates auto-advancing focus to the
  next Needs-Input agent.
- `footer-actions`: the footer PR button and the commit action on the
  uncommitted-files indicator, each gated by a confirm dialog and run as an
  auto-archiving agent task.
- `project-agent-counters`: which agents count toward project/unassigned/all-agents
  counters (archived excluded).

### Modified Capabilities
- `session-titles`: add user rename (header click + context menu, manual sticks)
  and re-derive auto-titles after each user message.
- `keyboard-shortcuts`: the insert-file-path binding is ⌘O (was ⌘I).

## Impact

- **UI (Svelte):** `src/lib/overview/Inbox.svelte` (badges, status sub-line,
  context menu, header rename, auto-advance gate), `src/lib/overview/roster.ts`
  + `src/lib/overview/events.ts` (status derivation), `src/lib/overview/titles.svelte.ts`
  (rename + cadence), `src/lib/usage/AppFooter.svelte` + `src/lib/usage/GitInfo.svelte`
  (PR + commit buttons), `src/lib/projects/projectRollup.ts` +
  `src/lib/projects/ProjectPanel.svelte` (counters), `src/lib/ui/SettingsModal.svelte`
  + new `src/lib/settings/*.svelte.ts` (auto-advance setting),
  `src/lib/icons/projectIcons.ts` (compass already present), `src/routes/+page.svelte`
  (⌘O handler, task-agent spawning), `src/lib/ui/shortcuts.ts` +
  `src/lib/layout/paneMenu.ts` (⌘O label).
- **External dependency:** the PR button uses the `gh` CLI for PR detection/open;
  the spawned agent task creates the PR. Requires an authenticated `gh` and a
  GitHub remote.
- **No backend (Rust) changes expected** for most items; the foreground-process
  status detection reads existing terminal/PTY signals already available to the UI.
- **No data migrations.** New settings slice persists alongside existing settings;
  custom titles persist in the existing title cache.
