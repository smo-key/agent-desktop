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
- **Commit popover (footer)** — clicking the uncommitted-files indicator when there
  are changes opens a popover listing the uncommitted files with a pinned "Commit now"
  action that spawns an agent session (task) to commit them (auto-archiving as before).
  The indicator's hover tooltip shows only the COUNT of uncommitted files — the file
  list moved into the popover.
- **Push popover (footer)** — clicking the push (ahead) indicator opens a popover
  listing the commits a push would send, with a pinned "Push now" action that pushes
  the focused project's branch. Inert when there is nothing to push.
- **Open-PRs popover (footer)** — the open-PRs button still shows the number of open
  PRs targeting `main` awaiting review (warning + count, else checkmark + `0`), but now
  EXCLUDES draft PRs from that count. Clicking it opens a popover listing the
  awaiting-review PRs (non-draft first, drafts last — drafts are shown but not counted);
  each PR row opens that PR on GitHub, and a pinned action opens the repo's
  pull-requests page. Degrades to the neutral checkmark/`0` state when `gh` is unavailable.
- **Footer popovers** — the push, uncommitted-files, and open-PRs popovers share one
  behavior: a scrollable body with the primary action pinned at the bottom, dismissed
  by clicking outside or pressing Escape.
- **Agent card shows the model, not the cost** — each agent card displays the agent's
  model as a versioned label (e.g. "Opus 4.6", parsed from the snapshot model id,
  falling back to the display name) instead of its dollar amount. Cost stays in the
  aggregate total / footer.
- **Footer model + effort pills** — the footer's right side gains two non-interactive
  pills showing the focused session's model (versioned label) and reasoning effort
  level; the effort pill is omitted when the model reports no effort. Backed by two new
  snapshot fields (`model_id`, `effort`) the statusline wrapper parses from Claude
  Code's statusline JSON.
- **Project counters exclude archived** — archived (closed/previewed) agents are no
  longer counted in the per-project, unassigned, or all-agents counters.
- **Rename a session** — the user can rename a session by clicking its title in the
  focus-pane header or via the agent card's context menu. A manually-set title is
  sticky: auto-title generation stops for that session and never overwrites it.
- **Titles refresh after every user message** — auto-generated titles are
  re-derived promptly after each new user message (not only on a long throttle),
  for sessions that have not been manually renamed.
- **Titles reflect the whole session, weighted to the original request** — auto-title
  generation considers the user's messages across the whole session instead of skewing
  to the most recent one. The earliest messages (where the original request usually
  lives) are always included even in long sessions and are weighted more heavily, while
  a genuinely new later task can still take over the title.
- **Insert-filename shortcut → ⌘O** — the insert-file-path shortcut moves from ⌘I
  to ⌘O (help modal and pane menu updated to match).

## Capabilities

### New Capabilities
- `agent-roster-display`: how an agent card renders its role/coordination badge,
  archived-coordinator label, the status sub-line (last message / question), and the
  per-agent model label shown in place of the dollar cost.
- `coordinator-lifecycle`: archiving vs deleting the project coordinator, including
  the empty-session rule and the archived-coordinator label.
- `agent-status-derivation`: classifying an agent as In flight vs Needs input,
  including the foreground-process-running case and in-session background work (a
  dynamic workflow or another agent still running while the main loop looks idle).
- `inbox-auto-advance`: the opt-in setting that gates auto-advancing focus to the
  next Needs-Input agent.
- `footer-actions`: the footer git indicators — the per-branch PR button (create/open),
  and the push, uncommitted-files, and open-PRs indicators that each open a popover
  (commits-to-push + "Push now"; uncommitted files + "Commit now"; awaiting-review PRs
  with drafts last + open-on-GitHub + a pull-requests-page action). The uncommitted
  tooltip shows only the count; the open-PRs warning count excludes drafts; popovers
  scroll with a pinned action and dismiss on outside-click/Escape.
- `project-agent-counters`: which agents count toward project/unassigned/all-agents
  counters (archived excluded).

### Modified Capabilities
- `session-titles`: add user rename (header click + context menu, manual sticks),
  re-derive auto-titles after each user message, and derive auto-titles from the whole
  session weighted to the original request (earliest messages always included).
- `keyboard-shortcuts`: the insert-file-path binding is ⌘O (was ⌘I).
- `usage-dashboard`: the per-pane snapshot gains `model_id` and `effort` fields (parsed
  from Claude Code's statusline JSON), and the footer surfaces the focused session's
  model + effort as non-interactive pills.
- `agent-overview`: a per-agent card surfaces the model and context instead of the
  dollar cost (cost remains in the aggregate total).

## Impact

- **UI (Svelte):** `src/lib/overview/Inbox.svelte` (badges, status sub-line,
  context menu, header rename, auto-advance gate, card model-not-cost),
  `src/lib/overview/roster.ts` + `src/lib/overview/events.ts` (status derivation,
  `modelId`), `src/lib/overview/titles.svelte.ts` (rename + cadence),
  `src/lib/usage/AppFooter.svelte` + `src/lib/usage/GitInfo.svelte` (model/effort
  pills + push/commit/open-PRs popovers), new `src/lib/usage/FooterPopover.svelte`
  (scrollable popover with a pinned action) + `src/lib/usage/modelLabel.ts`
  (versioned model + effort labels), `src/lib/projects/projectRollup.ts` +
  `src/lib/projects/ProjectPanel.svelte` (counters), `src/lib/ui/SettingsModal.svelte`
  + new `src/lib/settings/*.svelte.ts` (auto-advance setting),
  `src/lib/icons/projectIcons.ts` (compass already present), `src/routes/+page.svelte`
  (⌘O handler, task-agent spawning), `src/lib/ui/shortcuts.ts` +
  `src/lib/layout/paneMenu.ts` (⌘O label).
- **Backend (Rust) + wrapper:** `src-tauri/resources/statusline-wrapper.cjs` emits the
  new `model_id` + `effort` snapshot fields; `src-tauri/src/usage.rs` adds them to the
  `Snapshot` struct; `src-tauri/src/pr.rs` extends the open-PRs lookup to return the PR
  list (number/title/url/isDraft/reviewDecision); `src-tauri/src/git.rs` adds a
  `commits_to_push` command (`git log @{u}..HEAD`). The In-flight status detection still
  reads existing terminal/PTY signals already available to the UI (no new backend).
- **External dependency:** the PR button + open-PRs popover use the `gh` CLI for PR
  detection/open; the spawned agent task creates the PR. Requires an authenticated `gh`
  and a GitHub remote.
- **No data migrations.** New snapshot fields default to null so older snapshots still
  parse; the new settings slice persists alongside existing settings; custom titles
  persist in the existing title cache.
