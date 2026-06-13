# Tasks

## 1. Backend — upstream-aware status, commits-to-push, and publish

- [x] 1.1 Add `upstream: Option<bool>` to `GitStatus` (git.rs).
- [x] 1.2 `status_for_dir`: detect upstream via `@{upstream}`; compute `ahead` as
  `@{upstream}..HEAD` when published, else `HEAD --not --remotes` when a remote
  exists, else null.
- [x] 1.3 `commits_to_push_for`: mirror that range (`@{u}..HEAD` published, else
  `HEAD --not --remotes`, else empty).
- [x] 1.4 `push`: publish an unpushed branch with `git push -u <remote> HEAD`
  (remote = `origin` else first configured); plain `git push` when published.
- [x] 1.5 Cargo unit tests for each case (upstream true/false, zero-commit publish,
  no-remote null, commits list, publish-sets-upstream).

## 2. Frontend — carry upstream, always-open popover, pill state

- [x] 2.1 `pushPopover.ts`: `pushPopoverOpen` opens whenever a handler is wired;
  add pure `aheadPillEnabled(ahead, upstream)`.
- [x] 2.2 `snapshots.svelte.ts`: add `upstream` to `GitStatus`.
- [x] 2.3 `projectGit.svelte.ts`: `normalizeGitMap` carries `upstream` (bool|null).
- [x] 2.4 `GitInfo.svelte`: ↑ pill always a button when a handler is wired,
  highlighted/neutral via `aheadPillEnabled`, disabled only while busy, updated
  tooltips.
- [x] 2.5 Vitest coverage for the pure helpers + normalize.

## 3. Verify

- [x] 3.1 `npm run check` (svelte-check), `npm test` (vitest), `cargo test --lib git::`.
