# Make the footer's ↑ pill publish unpushed branches

## Why

A branch that has never been pushed has no upstream, so the footer's ahead (↑)
pill computed `ahead` from `@{upstream}..HEAD` — which git can't answer — leaving
the pill a dim, inert `↑ 0`. The user could see their branch was local-only but
had no way to act on it from the footer, and a plain `git push` would fail with
"no upstream branch" anyway. The pill should instead let the user publish an
unpushed branch (with its local commits) directly.

## What Changes

The footer's ahead (↑) pill becomes always-actionable, and the git backend learns
to publish:

- **Always a button + popover in every case.** Clicking the ↑ pill always opens
  the push popover (whenever a real project folder is bound); the user takes the
  secondary "Push now" action there. The pill is no longer inert when there is
  nothing to push, and is disabled ONLY while a push/pull for the project is in
  flight.
- **Highlighted vs neutral.** The pill reads HIGHLIGHTED whenever there is
  something to do — commits to push, OR an UNPUBLISHED branch (no upstream) that
  pushing would publish, even at zero commits. It falls to a NEUTRAL empty state
  (mirroring the open-PRs zero pill) only when the branch is published and fully in
  sync, or when the count is unknown (e.g. no remote).
- **Publishable count.** For an unpublished branch `ahead` now counts the commits
  not yet on ANY remote — i.e. what publishing would upload — instead of being
  null. It stays null only when there is no remote to push to. The popover's commit
  list mirrors that range.
- **Publish on push.** `push` publishes an unpublished branch with
  `git push -u <remote> HEAD` (remote defaults to `origin`, else the first
  configured remote), creating the remote branch and recording tracking so later
  pushes are a plain `git push`. A published branch still pushes with `git push`.
  "No upstream" is therefore no longer a push failure.

## Impact

- Affected specs:
  - `footer-actions` → "Push indicator opens a push popover" requirement.
  - `projects` → "Push And Pull A Project From Its Context Menu" requirement.
- Code: `src-tauri/src/git.rs` (`GitStatus.upstream`, ahead/commits-to-push for an
  unpublished branch, `push` publishes via `-u <remote> HEAD`),
  `src/lib/usage/snapshots.svelte.ts` + `src/lib/projects/projectGit.svelte.ts`
  (carry/normalize `upstream`), `src/lib/usage/pushPopover.ts`
  (`pushPopoverOpen` opens whenever a handler is wired; new `aheadPillEnabled`),
  and `src/lib/usage/GitInfo.svelte` (the always-button ↑ pill + state styling).
