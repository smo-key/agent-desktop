## Why

The footer's (and project pane's) ahead/behind counts are computed from the
LOCAL remote-tracking ref (`HEAD..@{upstream}`), which only advances when
something runs `git fetch`. The app's git probe is deliberately local-only and
polled on a fast clock, but it NEVER fetches — so the "commits to pull" count is
frozen at whatever the last manual fetch left behind. A user with one new commit
on the remote sees `0` until they run `git fetch` by hand, then `1`. The count is
silently stale, which defeats the purpose of the indicator.

## What Changes

- Add a background `git fetch` that periodically refreshes each tracked project's
  remote-tracking refs, so the EXISTING ahead/behind probe then reports an
  accurate count without any manual `git fetch`.
- The fetch runs ALWAYS-ON, on a SLOW clock (~3 minutes), SEPARATE from the fast
  local status poll, plus one initial fetch shortly after launch so the count is
  fresh without waiting a full interval.
- It covers ALL tracked project folders, in parallel and best-effort, reusing the
  existing non-interactive git guards (`GIT_TERMINAL_PROMPT=0`,
  `GIT_SSH_COMMAND="ssh -o BatchMode=yes -o ConnectTimeout=10"`). Fetch is
  read-only (never touches the worktree) and fails fast offline / without
  credentials, so a folder that can't fetch is simply a no-op.
- The fast local status probe (`status_for_dir`) is UNCHANGED — it stays
  local-only and fast. Decoupling fetch (slow, network) from status read (fast,
  local) keeps the per-pane footer responsive.

Out of scope: the `statusline-wrapper.cjs` ahead/behind path (the footer does not
use it — it rides the `git_status_for` command), and any manual / on-demand fetch
UI affordance.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `projects`: the "Project Git State Is Shown In The Footer" behavior gains a
  requirement that the ahead/behind counts are kept fresh against the remote by a
  periodic background fetch (rather than reflecting only a stale local
  remote-tracking ref).

## Impact

- `src-tauri/src/git.rs`: new best-effort, parallel, non-interactive fetch
  helper (mirroring `run_git_action`'s guards) over a list of folders.
- `src-tauri/src/lib.rs`: new `git_fetch_for(paths)` Tauri command.
- `src/lib/projects/projectGit.svelte.ts`: store method to invoke the fetch
  command, then refresh status so advanced refs are read promptly.
- `src/routes/+page.svelte`: a new slow background-fetch interval (initial fetch +
  ~3 min cadence) over the current project paths.
- No new dependencies. Adds periodic background network activity (git fetch) for
  repos with remotes — read-only, non-interactive, best-effort.
