# Worktree-per-task — create and merge

Active only when `worktreePerTask: true` in `.claude/workflow.yaml`. When off,
ignore this file entirely and use `branchPerTask` as before.

When on, each task runs in its **own git worktree** on a branch named after the
change, isolated from your main working tree. The branch is merged back into the
branch you started from once the work is complete, and the worktree is removed.
`worktreePerTask` supersedes `branchPerTask`'s in-place `git switch -c` — the
worktree carries the task branch, so do **not** also switch branches in place.

## Create (Start / Quick)

After intake, with the change name derived and **before** any artifacts are
written, from the current branch (call it the **base branch**):

```sh
# default path convention: a sibling dir grouping this repo's worktrees
git worktree add ../<repo-name>-worktrees/<change-name> -b <change-name>
```

Then **operate entirely inside that worktree** for the rest of the task — all
OpenSpec artifacts, code, and commits land on `<change-name>` there. Record the
linkage so later stages can merge back without asking (see `linkage.md`):

- `baseBranch` — the branch you branched from (the merge target).
- `worktreePath` — the absolute path of the worktree.

If the worktree or branch already exists (resuming work), reuse it instead of
recreating.

## Merge back + clean up (Build or Done)

Triggered by `worktreeMergeAt`:

| `worktreeMergeAt` | Merge happens                                              |
|-------------------|------------------------------------------------------------|
| `archive` (default) | at the end of **workflow-done**, after archive + mark done |
| `build`           | at the end of **workflow-build**, right after `review` — for projects where testing the change requires it merged first |

For **workflow-quick** (one pass, build and archive coincide) the merge always
happens at the very end, after archive, regardless of `worktreeMergeAt`.

Procedure — run from the **main working tree** (the first entry of
`git worktree list`, which has `baseBranch` checked out), using `baseBranch` and
`worktreePath` from `workflow.json`:

```sh
MAIN=$(git worktree list --porcelain | sed -n '1s/^worktree //p')
git -C "$MAIN" switch <baseBranch>        # ensure base branch is current
git -C "$MAIN" merge <change-name>        # merge the task branch back
git -C "$MAIN" worktree remove <worktreePath>
git -C "$MAIN" branch -d <change-name>    # safe delete; only removes if merged
```

- **Conflicts:** if `git merge` reports a conflict, **STOP** — do not attempt to
  resolve automatically. Leave the worktree in place, tell the user which files
  conflict, and let them resolve and complete the merge.
- **`branch -d` refuses to delete:** that means the branch is not fully merged —
  STOP and surface it rather than forcing `-D`.
- After a `build`-time merge the worktree is gone, so `workflow-done` runs in the
  main working tree on `baseBranch` (it resolves the change via the single
  un-archived `workflow.json`, since the branch name no longer matches).
