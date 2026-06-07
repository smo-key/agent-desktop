---
name: workflow-start
description: Start a task in the development workflow — intake a ticket or free-form task, mark it in progress, and run OpenSpec explore/propose until an apply-ready change exists. Use when the user wants to begin or pick up a new piece of work.
---

# Workflow — Start

Take a task and drive it to an apply-ready OpenSpec change, updating the tracker.

Read these references first:
- `.claude/skills/workflow/references/config.md`
- `.claude/skills/workflow/references/providers.md` and the file for the
  configured provider under `.claude/skills/workflow/references/providers/`
- `.claude/skills/workflow/references/linkage.md`

## Steps

1. **Load config.** Read `.claude/workflow.yaml`. If absent, scaffold the default
   from `config.md` (provider `local`), write it, and tell the user.

2. **Intake the task** (see "Intake" in `providers.md`):
   - Ticket ref / URL → `resolve(ref)`.
   - Free-form text → use as the description; if provider ≠ `local`, offer to
     `create` it; proceed untracked if declined.
   - Nothing given → `list_open()` and have the user pick.
   Derive a kebab-case change name from the task title (e.g. "Add SSO login" →
   `add-sso-login`).

3. **Mark started.** Emit the `started` event (see "Emitting a lifecycle event"
   in `providers.md`): `set_status(taskRef, statuses.started)` if mapped.

4. **Branch.** If `branchPerTask` is true, create and switch to a branch named
   after the change: `git switch -c <change-name>` (skip if it already exists).

5. **Choose discovery depth.** Assess how well-understood the task is and
   **recommend** one, then confirm with the user:
   - High uncertainty / fuzzy problem → invoke **openspec-explore** to think it
     through, then proceed to a proposal.
   - Clear, well-scoped → invoke **openspec-propose** directly.
   Drive the chosen OpenSpec skill until the change is apply-ready (its
   `applyRequires` artifacts — typically proposal/design/specs/tasks — are
   complete). Respect the repo's `openspec/config.yaml` interview/scope gates.

6. **Link + commit.** Write `openspec/changes/<change-name>/workflow.json`
   (format in `linkage.md`) with `provider`, `taskRef`, `url`, and
   `lastEvent: "started"`. Stage and commit the OpenSpec artifacts and
   `workflow.json` together.

7. **Mark planned.** Emit the `planned` event; update `lastEvent` in
   `workflow.json`.

8. **Hand off.** Tell the user the change is apply-ready and that
   `workflow-build` is next.
