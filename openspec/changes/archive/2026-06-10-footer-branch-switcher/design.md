## Context

The footer's branch pill (`GitInfo.svelte:41`) is display-only. The footer already
turns the ahead/behind pills into action buttons via optional `onPush`/`onPull`
props supplied only by `AppFooter.svelte`; the actions live in the unit-tested
`projectGitActions.ts`, which `invoke`s a Rust command, toasts git's message on
success, and on failure opens an interactive terminal in the project folder (via a
`setGitTerminalOpener`-injected opener) — falling back to a toast when no terminal
surface is wired. A `gitBusy` store (keyed by folder path) guards double-triggers.
On the Rust side, `git.rs` has `run_git` (silent status probes) and
`run_git_action` (user-initiated; returns git's own message on success/failure and
runs git non-interactively so a network sync can't hang). This change adds branch
listing + switching by following those same patterns, so the new surface inherits
the same safety and feedback behavior.

The footer's git is folder-based: `AppFooter.svelte` derives `gitProject` (the
focused pane's project, else the panel selection) and reads `folderGit` via
`projectGit.forPath(gitProject.path)`. `projectGit` is polled slowly.

## Goals / Non-Goals

**Goals:**

- Make the footer branch pill open a picker that switches local branches, checks
  out remote branches as local tracking branches, and creates new branches off
  HEAD — surfacing git's own output, exactly like push/pull.
- Reuse the existing patterns (`run_git`/`run_git_action`, `projectGitActions`
  shape, `gitBusy`, `gitTerminalOpener`, `ProjectSelect` combobox) rather than
  inventing new ones.
- Keep the picker footer-only; the project-pane pill stays read-only.

**Non-Goals:**

- Merge, delete-branch, rebase, stash, or any conflict-resolution UI.
- Choosing a non-HEAD base when creating a branch.
- Changing how `projectGit` polling or the footer geometry works.

## Decisions

### Rust: three new commands in the `run_git`/`run_git_action` style

In `git.rs`:

- `list_branches(dir) -> BranchList` — a `run_git` (silent, returns `None`/empty on
  failure) helper. Use porcelain-stable plumbing rather than parsing `git branch`
  decorations:
  - local branches: `git for-each-ref --format=%(refname:short) refs/heads`
  - remote branches: `git for-each-ref --format=%(refname) refs/remotes`, then
    drop every `*/HEAD` and strip the `refs/remotes/` prefix → `origin/main`. We
    read the FULL refname (not `%(refname:short)`) on purpose: git's short form
    renders the remote's symbolic HEAD `refs/remotes/origin/HEAD` as the bare
    remote name `origin`, which is **not** a checkout-able branch and would
    otherwise leak into the list. Reading the full ref guarantees every entry is a
    real `<remote>/<branch>`.
  - current branch: reuse the existing `rev-parse --abbrev-ref HEAD` (already used
    by `status_for_dir`); `HEAD` means detached → no current branch.
  Returns a serializable `{ current: Option<String>, local: Vec<String>, remotes:
  Vec<String> }`. A non-repo / unreadable folder yields an empty list, never an
  error (mirrors `status_for_dir`'s null-on-failure contract).
- `checkout(dir, branch) -> Result<String,String>` — `run_git_action(dir,
  ["checkout", branch])`. For a remote-tracking ref like `origin/feature`, modern
  git's DWIM (`git checkout feature`) creates the local tracking branch; so the
  frontend passes the **short local name** for a remote selection (see below) and
  this command stays a plain `checkout <name>`. Git's own error (dirty tree,
  ambiguous name) is returned as `Err(message)`.
- `create_branch(dir, name) -> Result<String,String>` — `run_git_action(dir,
  ["checkout", "-b", name])`, off the current HEAD. Invalid/duplicate names return
  git's `Err(message)`.

Register `git_list_branches` / `git_checkout` / `git_create_branch` in
`lib.rs` next to `git_push`/`git_pull` and add them to the `invoke_handler` list.
All three take `repoPath` (camelCase, matching `git_push`'s `repo_path`).

### Remote checkout = derive the short local name, let git DWIM

Rather than a dedicated `checkout --track` command, the frontend maps a selected
remote ref `origin/feature-x` to its short name `feature-x` (strip the first path
segment / remote name) and calls `git_checkout(path, "feature-x")`:

- If no local `feature-x` exists, git's DWIM creates it tracking `origin/feature-x`.
- If a local `feature-x` already exists, git just switches to it.

This satisfies both remote-branch scenarios with the single `checkout` command and
no special-casing. Alternative considered: an explicit `checkout -b <local>
--track <remote>` — rejected because it errors when the local branch already
exists, forcing extra existence-checking the DWIM path avoids.

### Frontend: `branchActions.ts` mirrors `projectGitActions.ts`

A new `src/lib/projects/branchActions.ts` exports `listBranches(path)`,
`switchBranch(path, branch, name, projectId, onDone?)`, and
`createBranch(path, name, projectName, projectId, onDone?)`. They:

- guard with `gitBusy.isBusy/begin/end` (shared with push/pull, so a switch and a
  push on the same folder are mutually exclusive);
- `invoke` the Rust command;
- on success: `toast.show(...)` with git's one-line message and call an injected
  refresh callback so the footer updates immediately;
- on failure: reuse the existing failure-surfacing path — open an interactive
  terminal in the folder running the failed command (`git checkout …`), falling
  back to a toast. Reuse `projectGitActions`' `gitTerminalOpener` rather than
  wiring a second opener — extract the shared `surfaceFailure`/`oneLine` helpers,
  or import them, so there is one terminal-opener registration. (`listBranches` is
  a silent query — no toast, no busy guard; it returns `[]` on error.)

This module is the unit-tested seam (mirroring `projectGitActions.test.ts`):
invoke is mocked, and tests assert the success toast, the busy guard no-op on a
double trigger, the refresh callback firing, and the remote-name derivation.

### Targeted refresh that does not clobber the poll map

`projectGit.refresh(paths)` **replaces** `byPath` with only the queried paths, so
calling it with a single path would wipe other projects' statuses until the next
full poll. Add `projectGit.refreshOne(path)` that fetches `git_status_for([path])`
and **merges** the one entry into `byPath` (assigning `byPath[path]`), leaving
other entries intact. `branchActions` calls this after a successful switch/create.

### Component: `BranchPicker.svelte` modeled on `ProjectSelect.svelte`

A new `src/lib/usage/BranchPicker.svelte` (co-located with the footer that owns
it) is the **menu only** — the trigger is the existing branch pill in
`GitInfo.svelte`, which becomes a `<button>` (see below) and toggles the footer's
`open` state. BranchPicker owns its filter/highlight/branch-list state and renders:

- a menu that opens **upward** from just above the trigger. It is **`position:
  fixed`**, not `absolute` — the footer's `.zone.left` / `.left-git` are
  `overflow: hidden` (so a long branch name ellipsizes), which would clip an
  upward-opening absolute popup. The footer passes the pill's wrapper as an
  `anchor` element; on open the menu measures `anchor.getBoundingClientRect()` and
  sets `left = rect.left`, `bottom = window.innerHeight - rect.top + 6`, so the
  fixed menu escapes the clipping and sits above the pill (mirrors how
  `ContextMenu.svelte` positions a fixed popover);
- a filter `<input>` at the top; arrow/Home/End/Enter/Escape keyboard nav with a
  roving highlight over the flattened actionable rows (combobox pattern from
  `ProjectSelect`), scrolled into view;
- a **Local** section (current branch marked with a check) and a **Remotes**
  section (only when non-empty);
- an inline **create** row (seeded with the filter text) that runs `createBranch`;
- an outside-click scrim + a busy/disabled reflection of `gitBusy.isBusy(path)`.

On open it calls `listBranches(path)` to load the lists (and `onClose`s immediately
if `path` is falsy — the no-folder guard). Selecting a local option calls
`switchBranch`; a remote option calls `switchBranch(remoteShortName(ref))`; the
create row calls `createBranch`; all close the menu.

### `GitInfo.svelte` gains an optional `onPickBranch` seam — footer-only

Add an optional prop `onPickBranch?: () => void` (or, to keep the pill's markup in
one place, render the pill as a `<button>` when a pick callback is present, exactly
as the ahead/behind pills already switch between `<span>`/`<button>` on
`onPush`/`onPull`). Only `AppFooter.svelte` supplies it; the project pane omits it,
so that pill stays read-only.

The actual picker (menu, lists, filter) lives in `BranchPicker.svelte`, which
`AppFooter` composes around/with `GitInfo` so the menu anchors to the footer pill.
`AppFooter` passes the `gitProject` path/name/id and a `() =>
projectGit.refreshOne(gitProject.path)` callback.

## Risks / Trade-offs

- **Remote-name collision / ambiguity** (e.g. two remotes both have `feature-x`,
  so `git checkout feature-x` is ambiguous) → git returns an error, which we
  surface like any other failure. Acceptable for v1; out of scope to disambiguate.
- **`checkout` DWIM depends on git's `checkout.guess`/`--guess` default being on**
  → it is the default in supported git versions; if a user disabled it, the remote
  checkout surfaces git's error rather than silently failing. Acceptable.
- **Single shared `gitBusy` key per folder** means a branch switch blocks a push on
  the same folder and vice-versa → intended: they mutate the same working tree, so
  serializing them is correct.
- **`refreshOne` adds a second code path** alongside `refresh` → small, and it
  preserves the poll map; the alternative (calling `refresh([path])`) is wrong
  because it drops every other project's status.
- **Picker opening upward** could clip on very short windows → it inherits
  `ProjectSelect`'s `max-height` + internal scroll, so a long list scrolls rather
  than overflowing the viewport.
