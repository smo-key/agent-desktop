---
name: workflow-close
description: Close out the active OpenSpec change — reconcile any spec drift from the session, verify, archive, and mark the tracker Done. Use when the user wants to finish, wrap up, or archive completed work.
---

# Workflow — Close

Finalize the active change: reconcile drift, verify, archive, mark Done.

Read first:
- `.claude/skills/workflow/references/linkage.md`
- `.claude/skills/workflow/references/providers.md` and the configured provider
  file.

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

4. **Verify.** Invoke **openspec-verify-change** for this change and resolve any
   issues it raises (including conversation drift it surfaces).

5. **Archive.** Invoke **openspec-archive-change** to promote the delta specs
   into `openspec/specs/` and move the change to the archive. (Note:
   `workflow.json` is carried into the archive with the change.)

6. **Mark done.** Emit the `done` event; the tracker task moves to its Done
   status.

7. **Report.** Summarize what shipped and the task's final status/URL.
