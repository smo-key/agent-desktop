## 1. Rust: best-effort background fetch

- [x] 1.1 Add a `fetch_dir(dir)` helper in `src-tauri/src/git.rs` that runs
      `git -C <dir> fetch` with the SAME non-interactive guards as
      `run_git_action` (`GIT_TERMINAL_PROMPT=0`,
      `GIT_SSH_COMMAND="ssh -o BatchMode=yes -o ConnectTimeout=10"`). It returns
      whether the fetch ran successfully, skips folders with no remote
      (`has_remote`), and never panics (a failed/offline fetch is a no-op).
- [x] 1.2 Add `fetch_remotes(paths)` that fans out `fetch_dir` across a thread per
      folder and joins (mirroring `status_for_paths`), swallowing all errors so
      one bad folder can't block the others.
- [x] 1.3 Add a `git_fetch_for(paths)` `#[tauri::command(async)]` in
      `src-tauri/src/lib.rs` wrapping `git::fetch_remotes`, always returning `Ok`,
      and register it in the invoke handler.
- [x] 1.4 Tests (git.rs): build a local repo whose upstream advances by one
      commit; assert `status_for_dir` reports `behind == 0` BEFORE fetching, then
      `fetch_dir`/`fetch_remotes` makes the next `status_for_dir` report
      `behind == 1`. Assert a no-remote / bogus folder is a safe no-op and that
      the worktree is untouched (status `dirty`/`modified` unchanged by the fetch).

## 2. Frontend: invoke + schedule the background fetch

- [x] 2.1 Add `fetchRemotes(paths)` to `ProjectGitStore`
      (`src/lib/projects/projectGit.svelte.ts`): invoke `git_fetch_for`,
      best-effort (log once and continue on failure), mirroring `refresh`.
- [x] 2.2 Unit-test `fetchRemotes` with a mocked `invoke` (asserts it calls
      `git_fetch_for` with the paths and swallows errors) in
      `projectGit.svelte.test.ts`.
- [x] 2.3 Add a SEPARATE slow background-fetch `$effect` in
      `src/routes/+page.svelte` (a `FETCH_POLL_MS` ~180000 interval, distinct from
      `GIT_POLL_MS`): an initial fetch shortly after launch, then on the interval,
      over the current project paths; after each fetch resolves, call
      `projectGit.refresh(paths)` so advanced refs surface immediately. Leave the
      fast `status_for_dir` / `GIT_POLL_MS` path unchanged.

## 3. Adversarial review fixes

- [x] 3.0a Bound each `git fetch` with an OVERALL wall-clock timeout
      (`FETCH_TIMEOUT`, spawn + poll + kill in `run_git_fetch`). The ssh
      `ConnectTimeout` only bounds ssh; a non-ssh / black-hole remote had no
      overall timeout, so a fetch thread could block for the OS TCP timeout and
      accumulate one stuck thread per poll. Add a unix-guarded test that a hanging
      `ext::` transport is abandoned promptly at the deadline.
- [x] 3.0b Make the `+page.svelte` background fetch MOUNT-ONCE: the `$effect` owns
      ONLY the recurring interval (reads no rune synchronously), so it no longer
      fires an immediate network fetch-all on every `projects.list` reassignment
      (coordinator start, drag-reorder, edit, reload). The INITIAL fetch is chained
      onto `projects.load()` in `onMount` (a re-review found the list is empty at
      mount, so an in-effect initial fetch fetched nothing and the first real fetch
      waited a full cadence). A new project is picked up on the next interval tick.
- [x] 3.0c Correct the `fetch_dir` doc + design "read-only" claim: a fetch can also
      advance non-checked-out local refs under a custom refspec, but never the
      index / worktree / checked-out branch (git refuses).

## 4. Verify

- [x] 4.1 Run the Rust tests (`cargo test`) and the frontend tests
      (`npm test` / vitest) and confirm green. (All git.rs tests + all frontend
      tests pass. NOTE: two `events::tests` fail with a socket `bind … SUN_LEN`
      error — a pre-existing macOS temp-path-length issue in a module this change
      does not touch, not a regression.)
- [x] 4.2 `openspec validate add-background-remote-fetch --strict` passes.
