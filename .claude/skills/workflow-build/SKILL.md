---
name: workflow-build
description: Implement the active OpenSpec change in the development workflow — mark it in progress, then drive the change's tasks through a self-contained subagent-driven build loop (fresh subagent per task, TDD, spec + quality review), and mark it in review. Use when the user wants to implement or continue work on a started change.
---

# Workflow — Build

Resume the active change and implement its tasks, updating the tracker. Building
is **subagent-driven**: each task is delegated to a fresh subagent with isolated
context, then reviewed, so quality stays high and your own context stays clean.
This skill is self-contained — it relies on no external skill set.

Read first:
- `.claude/skills/workflow/references/linkage.md`
- `.claude/skills/workflow/references/providers.md` and the configured provider
  file.
- `.claude/skills/workflow/references/build-loop.md` (the subagent-driven build
  loop + TDD discipline you will follow in step 4).
- `.claude/skills/workflow/references/worktrees.md` (only if `worktreePerTask`)

## Steps

1. **Load config** (`.claude/workflow.yaml`).

2. **Resolve the active change** using the "Reading" procedure in `linkage.md`
   (branch name → single un-archived `workflow.json` → ask). Load its
   `workflow.json` for `provider`/`taskRef`.

3. **Mark implementing.** Emit the `implementing` event; update `lastEvent`.

4. **Run the build loop.** Read the change's `tasks.md` and implement it by
   following `references/build-loop.md`: for each unchecked task, dispatch a
   fresh implementer subagent (TDD, full task text + context), then a
   spec-compliance review subagent, then a code-quality review subagent, fixing
   in loops until both pass; mark the task `- [x]` and commit. Spawn subagents as
   needed — a trivial task may be done inline. Do not stop until every `- [ ]`
   task is checked. End with one final review subagent over the whole change.

5. **Mark review.** When tasks are complete, emit the `review` event; update
   `lastEvent`.

6. **Merge back (only if `worktreePerTask` and `worktreeMergeAt: build`).** Merge
   the task branch into its `baseBranch` and remove the worktree per the merge
   procedure in `worktrees.md`. Stop and surface any merge conflict. (When
   `worktreeMergeAt` is `archive`, leave the worktree in place — `workflow-done`
   merges it.)

7. **Hand off.** Tell the user implementation is complete and `workflow-done` is
   next (drift reconciliation → adversarial code review → verify → archive). If
   you merged in step 6, note that Done now runs in the main working tree on
   `baseBranch`.
