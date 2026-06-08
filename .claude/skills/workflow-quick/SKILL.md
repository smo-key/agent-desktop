---
name: workflow-quick
description: Fast lane for a small, clear change — implement with TDD, capture a minimal spec delta, sync it into the durable specs, archive, and mark the tracker Done in one pass. Use when the change is small enough to skip the full start/implement/close ceremony.
---

# Workflow — Quick

One-pass path for small, well-understood changes. Collapses
Start→Build→Close.

Read first:
- `.claude/skills/workflow/references/config.md`
- `.claude/skills/workflow/references/providers.md` and the configured provider.
- `.claude/skills/workflow/references/linkage.md`
- `.claude/skills/workflow/references/build-loop.md` (TDD discipline)
- `.claude/skills/workflow/references/worktrees.md` (only if `worktreePerTask`)

## Steps

1. **Load config** (`.claude/workflow.yaml`; scaffold default if missing).

2. **Intake** the task (ref / free-form / pick — see `providers.md`). **Ask
   clarifying questions only if the change is ambiguous**; otherwise proceed.
   Derive a kebab-case change name.

3. **Mark started.** Emit the `started` event.

4. **Branch or worktree.** If `worktreePerTask`, create a worktree for the change
   and work inside it, recording `baseBranch` + `worktreePath` for step 6's
   `workflow.json` (see `worktrees.md`); this supersedes `branchPerTask`. Else if
   `branchPerTask`, `git switch -c <change-name>`.

5. **Implement with TDD.** Make the change directly following the TDD discipline
   in `references/build-loop.md` (failing test → minimal code → pass → commit),
   committing as you go. Spawn a subagent for any chunky sub-part if it helps,
   but a quick change is usually done inline.

6. **Capture the delta.** Create a minimal OpenSpec change directory for
   `<change-name>` containing a spec delta (`## ADDED`/`## MODIFIED` with at least
   one `#### Scenario:`) describing the behavior change, plus a short `tasks.md`
   reflecting what you did. Write `workflow.json` (linkage.md) — including
   `baseBranch` + `worktreePath` if you created a worktree in step 4. Commit.

   If, while implementing, the change turns out to be larger than expected
   (needs design discussion or spans multiple capabilities), STOP and hand off to
   the full path: keep the work, tell the user, and suggest `workflow-start` /
   `workflow-build` instead.

7. **Sync specs.** Invoke **openspec-sync-specs** to fold the delta into
   `openspec/specs/`.

8. **Archive.** Invoke **openspec-archive-change** so nothing lingers under
   `openspec/changes/`.

9. **Mark done.** Emit the `done` event.

10. **Merge back (only if `worktreePerTask`).** Merge the task branch into its
    `baseBranch` and remove the worktree per `worktrees.md` — Quick always merges
    here, since build and archive coincide in this one pass (`worktreeMergeAt`
    does not apply). Stop and surface any merge conflict.

11. **Report** what shipped and the task status.
