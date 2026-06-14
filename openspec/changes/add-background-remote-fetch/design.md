## Context

The footer's ahead/behind pills are fed by `projectGit.forPath()` →
`git_status_for` (Rust) → `status_for_dir()` in `src-tauri/src/git.rs`, which
computes `behind = git rev-list HEAD..@{upstream} --count`. `@{upstream}` is the
LOCAL remote-tracking ref, advanced only by `git fetch`. The status probe is
polled on a fast clock (`GIT_POLL_MS = 4000` in `src/routes/+page.svelte`) and is
deliberately local-only — it never fetches. So the behind count reflects only the
last fetch. The fix must keep the fast probe fast and local while refreshing the
remote-tracking refs on a slower cadence.

Existing building blocks to reuse:
- `run_git_action` (git.rs) already runs git non-interactively with
  `GIT_TERMINAL_PROMPT=0` and `GIT_SSH_COMMAND="ssh -o BatchMode=yes -o
  ConnectTimeout=10"`, turning an otherwise-infinite credential/host-key wait into
  a fast clean failure.
- `status_for_paths` already fans out per-folder git work across threads.
- `ProjectGitStore` (projectGit.svelte.ts) already wraps the `git_status_for`
  invoke and is polled from the route.

## Goals / Non-Goals

**Goals:**
- The footer / project-pane behind count reflects the remote within one fetch
  interval (~3 min) of a remote push, with no manual `git fetch`.
- Keep the 4s status probe fast and local-only (no added latency / hang risk).
- Best-effort, non-interactive, read-only: a repo that can't fetch is a silent
  no-op; the worktree is never touched.

**Non-Goals:**
- The `statusline-wrapper.cjs` ahead/behind path (the footer does not use it).
- Any manual / on-demand fetch UI affordance.
- A user-facing setting to disable background fetch (always-on per decision).
- Changing how ahead/behind are computed or displayed.

## Decisions

### Decision: A separate slow fetch, NOT a fetch inside `status_for_dir`
Fetching inside the 4s probe would add network latency (and hang risk) to a hot,
local path and would fetch 15× too often. Instead, add a dedicated background
fetch on its own slow interval; the unchanged fast probe simply reads the
advanced refs on its next tick. This cleanly separates "slow, network, write refs"
from "fast, local, read refs."

*Alternative considered:* fetch-on-demand when the user opens the pull popover —
rejected because the user explicitly chose always-on background freshness, and a
popover only covers the active project, not the project pane's other rows.

### Decision: Non-interactive guards PLUS an overall wall-clock timeout
The fetch helper runs `git -C <dir> fetch` with the same `GIT_TERMINAL_PROMPT=0`
and `BatchMode`/`ConnectTimeout` ssh env as push/pull, so a repo needing
credentials fails fast instead of prompting. But `ConnectTimeout` only bounds an
*ssh* connect — an `https://` (or other non-ssh) remote, or a black-hole host, has
NO git-level overall timeout and would otherwise block a background thread for the
OS TCP timeout (~75-130s), piling up a stuck thread on every poll. So the fetch
also runs under an OVERALL wall-clock cap (`FETCH_TIMEOUT`, 30s): the child is
spawned, polled, and killed at the deadline, guaranteeing each background fetch
thread is short-lived regardless of transport and can never accumulate.

*Alternative considered:* relying on `run_git_action` (which captures output and
has no overall timeout) — rejected because it cannot bound a non-ssh transport;
the dedicated bounded path is the only way to cap thread lifetime.

### Decision: Fan out per folder, best-effort, in parallel (mirror `status_for_paths`)
A new `fetch_remotes(paths)` spawns a thread per folder and joins, swallowing all
errors (a fetch that fails / has no remote yields nothing). Exposed as a
`git_fetch_for(paths)` Tauri command that always returns `Ok` (never fails the
caller). Skip folders with no remote (a `git remote` probe) so local-only repos
don't shell out a doomed fetch.

### Decision: A MOUNT-ONCE slow route effect, then refresh status
`src/routes/+page.svelte` gets a second effect (separate from the existing
`GIT_POLL_MS` status effect): an initial fetch shortly after launch, then a
`FETCH_POLL_MS` (~180000) interval. After each fetch completes it calls
`projectGit.refresh(paths)` so the advanced refs surface immediately rather than
waiting up to 4s for the next status tick. The store gains a thin
`fetchRemotes(paths)` method wrapping the `git_fetch_for` invoke (mirroring
`refresh`), unit-testable with a mocked `invoke`.

The effect owns ONLY the recurring interval and reads no rune synchronously, so it
MOUNTS ONCE and is NOT re-run on every `projects.list` reassignment. Unlike the
cheap local status poll (which re-runs to probe a new project immediately), an
immediate re-fetch here is a *network* fan-out, and `projects.list` is reassigned
often (coordinator start, drag-reorder, edit, reload) — so re-running would be an
off-schedule fetch storm. The interval re-reads the live list each tick, so a newly
added project is fetched within one cycle, and its LOCAL branch/status already shows
at once via the 4s poll.

The INITIAL fetch is kicked off from `onMount`, chained onto `projects.load()` —
NOT inside the effect — because at mount time `projects.list` is still empty (it is
populated asynchronously by `load()`), so an initial fetch in the effect would fetch
nothing and the first real fetch would not happen until a full `FETCH_POLL_MS` later.
Running it after `load()` resolves gives the promised "shortly after launch" refresh.

## Risks / Trade-offs

- **Background network/credential use the user didn't explicitly trigger** →
  Mitigated: read-only, non-interactive (no prompts), best-effort; fails fast
  offline. Always-on was the user's explicit choice.
- **Many projects × periodic fetch = network load** → Mitigated by the slow (~3
  min) cadence and skipping remote-less repos; fetch is cheap when there's nothing
  new.
- **A slow/hung remote ties up a worker thread** → `ConnectTimeout`/`BatchMode`
  bound an *ssh* connect, but NOT a non-ssh transport. The OVERALL `FETCH_TIMEOUT`
  (30s) is what guarantees no fetch thread outlives a poll cycle, so threads can
  never accumulate even against a black-hole `https://` remote. (Killing the git
  child also breaks the pipe to any transport helper it spawned, which then exits;
  a pathological helper that ignores pipe closure may briefly linger but holds none
  of our threads.)
- **A network fetch storm on unrelated UI churn** → The route effect reads project
  paths `untrack`ed so it mounts once; it does not re-fetch on every `projects.list`
  reassignment (coordinator start, drag-reorder, edit). New projects are picked up
  on the next interval tick.
- **Fetch races the worktree during heavy git activity** → A fetch writes only refs
  (remote-tracking refs, `FETCH_HEAD`, and — under a non-default fetch refspec — at
  most other non-checked-out branch refs); git refuses to fetch into the checked-out
  branch, and it never touches the index or worktree, so it is safe to run
  concurrently with the user's own git work.
