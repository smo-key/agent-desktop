---
name: workflow-done
description: Close out the active OpenSpec change — reconcile any spec drift from the session, run the adversarial code review, verify, archive, and mark the tracker Done. Use when the user wants to finish, wrap up, or archive completed work.
---

# Workflow — Done

Finalize the active change: reconcile drift, verify, archive, mark Done.

Read first:
- `.claude/skills/workflow/references/linkage.md`
- `.claude/skills/workflow/references/providers.md` and the configured provider
  file.
- `.claude/skills/workflow/references/worktrees.md` (only if `worktreePerTask`)

## Steps

1. **Load config** (`.claude/workflow.yaml`).

2. **Resolve the active change** via the "Reading" procedure in `linkage.md`.

3. **Drift reconciliation (required).** Review everything discussed or
   implemented this session against the change's `specs/**`, `tasks.md`, and
   `proposal.md`. Any behavior that diverged from the artifacts must be brought
   back into sync NOW — update the delta specs (`## ADDED`/`## MODIFIED`/
   `## REMOVED` with `#### Scenario:` blocks), check off or add tasks, and adjust
   the proposal's scope. This enforces the `CLAUDE.md` close-out gate. Commit the
   updates.

4. **Adversarial code review (required).** Invoke **adversarial-code-review**
   for this change. It dispatches an independent skeptical reviewer over the
   change's implementation diff to hunt for real defects (bugs, edge cases,
   regressions) — distinct from the spec checks in the next step. Resolve every
   **CRITICAL** finding before proceeding; do not archive with unresolved
   CRITICALs. This enforces the `CLAUDE.md` Verify gate.

5. **Verify.** Invoke **openspec-verify-change** for this change and resolve any
   issues it raises (including conversation drift it surfaces).

6. **Archive.** Invoke **openspec-archive-change** to promote the delta specs
   into `openspec/specs/` and move the change to the archive. (Note:
   `workflow.json` is carried into the archive with the change.)

7. **Mark done.** Emit the `done` event; the tracker task moves to its Done
   status.

8. **Merge back (only if `worktreePerTask` and `worktreeMergeAt: archive`).** Now
   that the change is verified and archived, merge the task branch into its
   `baseBranch` and remove the worktree per the merge procedure in
   `worktrees.md`. Stop and surface any merge conflict. (Skip if `workflow-build`
   already merged under `worktreeMergeAt: build`.)

9. **Report.** Summarize what shipped and the task's final status/URL.
