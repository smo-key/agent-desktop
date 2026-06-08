---
name: workflow-start
description: Start a task in the development workflow — intake a ticket or free-form task (including a requirements brief a business analyst defined with workflow-define), mark it in progress, and run OpenSpec until an apply-ready change exists. Use when the user wants to begin or pick up a new piece of work.
---

# Workflow — Start

Take a task and drive it to an apply-ready OpenSpec change, updating the tracker.

This is the single developer entry point. It handles both lanes:
- **Fresh task** — requirements and planning in one sitting: choose explore vs
  propose by uncertainty and discover from scratch.
- **Pre-defined requirements** — a business analyst already produced a
  requirements brief with **workflow-define** (the item sits at the `refined` /
  "Ready for Dev" status with its requirements field populated). Treat that brief
  as authoritative and go straight to planning against the current codebase.

Which lane applies is decided in Intake, by whether the task carries a brief.

Read these references first:
- `.claude/skills/workflow/references/config.md`
- `.claude/skills/workflow/references/providers.md` and the file for the
  configured provider under `.claude/skills/workflow/references/providers/`
- `.claude/skills/workflow/references/linkage.md`
- `.claude/skills/workflow/references/worktrees.md` (only if `worktreePerTask`)

## Steps

1. **Load config.** Read `.claude/workflow.yaml`. If absent, scaffold the default
   from `config.md` (provider `local`), write it, and tell the user.

2. **Intake the task** (see "Intake" in `providers.md`):
   - Ticket ref / URL → `resolve(ref)`.
   - Free-form text → use as the description; if provider ≠ `local`, offer to
     `create` it; proceed untracked if declined.
   - Nothing given → `list_open()` and have the user pick. Surface `refined`
     ("Ready for Dev") items too — these are the ones a BA defined.
   - **Pre-defined brief pasted/pointed at** (the terminal output from
     `workflow-define`, or a path) → use it as the requirements brief directly.
   Derive a kebab-case change name from the task title (e.g. "Add SSO login" →
   `add-sso-login`).

   **Detect a requirements brief.** A task carries one when the resolved item is
   at the `refined` status and/or its requirements field (the description, or the
   configured `requirementsField`) holds a `workflow-define` brief — or when the
   user supplied a brief inline. Note whether you have a brief; it selects the
   discovery lane in step 5.

3. **Mark started.** Emit the `started` event (see "Emitting a lifecycle event"
   in `providers.md`): `set_status(taskRef, statuses.started)` if mapped.

4. **Branch or worktree.**
   - If `worktreePerTask` is true → create a worktree for the change and operate
     inside it for everything that follows (see `worktrees.md`). Record
     `baseBranch` + `worktreePath` for step 6's `workflow.json`. This supersedes
     `branchPerTask`.
   - Else if `branchPerTask` is true → create and switch to a branch named after
     the change: `git switch -c <change-name>` (skip if it already exists).

5. **Drive to apply-ready.** Pick the lane from step 2:

   - **Brief in hand (pre-defined requirements)** — the brief is the
     authoritative source: it already settled the problem, scope, and acceptance
     criteria. Invoke **openspec-propose** and feed it the brief — its interview
     gate is satisfied by the brief, so only ask the developer about genuine gaps
     or ambiguity, never re-litigate settled points. Author `design.md` and
     `tasks.md` **against the current codebase** — this is the payoff of deferring
     planning: the design reflects the code as it stands now, possibly weeks after
     the requirements were written.

   - **No brief (fresh task)** — assess how well-understood the task is,
     **recommend** a depth, then confirm with the user:
     - High uncertainty / fuzzy problem → invoke **openspec-explore** to think it
       through, then proceed to a proposal.
     - Clear, well-scoped → invoke **openspec-propose** directly.

   Either way, drive the chosen OpenSpec skill until the change is apply-ready
   (its `applyRequires` artifacts — typically proposal/design/specs/tasks — are
   complete), respect the repo's `openspec/config.yaml` interview/scope gates, and
   run `openspec validate <change-name>`.

6. **Link + commit.** Write `openspec/changes/<change-name>/workflow.json`
   (format in `linkage.md`) with `provider`, `taskRef`, `url`, and
   `lastEvent: "started"` — plus `baseBranch` + `worktreePath` if a worktree was
   created in step 4. Stage and commit the OpenSpec artifacts and `workflow.json`
   together (inside the worktree, when one is in use).

7. **Mark planned.** Emit the `planned` event; update `lastEvent` in
   `workflow.json`.

8. **Hand off.** Tell the user the change is apply-ready and that
   `workflow-build` is next.
