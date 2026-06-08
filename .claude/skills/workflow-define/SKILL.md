---
name: workflow-define
description: Define a task's requirements as a business analyst — interview for the problem, scope, and acceptance criteria, then emit a structured requirements brief to the tracker's requirements field (or, with no tracker, to the terminal). Writes no files, never branches, never commits. Use when a BA or product owner is drafting or refining requirements before any development begins.
---

# Workflow — Define (requirements)

Elicit requirements in business-analyst terms and hand them off **without
touching the repo**. This skill never writes files, never creates a branch, and
never commits. Its only outputs are a tracker field (when a tracker is
configured) or the terminal.

Read first:
- `.claude/skills/workflow/references/config.md`
- `.claude/skills/workflow/references/providers.md` and the configured provider
  file under `.claude/skills/workflow/references/providers/`.

## What this lane is for

A business analyst defines *what* and *why* — the requirements. A developer
later runs **workflow-start** to turn the brief into an OpenSpec change
(proposal + specs + design + tasks) and implement it. Design and tasks are
deliberately **not** the BA's job: leaving them to pickup means they are authored
against the codebase as it stands then, not as it was weeks earlier.

## Steps

1. **Load config** (`.claude/workflow.yaml`; scaffold the default if missing).

2. **Intake the task** (see "Intake" in `providers.md`):
   - Tracker ref / URL → `resolve(ref)`; seed from its title/description.
   - Free-form text → use it as the starting description. If a tracker is
     configured you need a work item to write the brief to, so offer to
     `create(title, desc)` now (a stub is fine — you fill it in at step 6). If
     the user declines, fall back to terminal output (local-style).
   - Nothing given → `list_open()` and let the BA pick.

3. **Interview for requirements.** Use the **AskUserQuestion** tool, grouped into
   small focused batches (you need not ask strictly one at a time). Cover, in
   **business-analyst language — never OpenSpec jargon** (no "delta",
   "capability", "ADDED/MODIFIED", "scenario block"):
   - the **problem** and why it matters now;
   - the **stakeholders / users** affected;
   - **scope** — what is explicitly in and out;
   - **business rules & constraints** — compliance, dependencies, timing;
   - **acceptance criteria** — concrete WHEN/THEN conditions for "done";
   - **alternatives** already considered or rejected.
   Start from what the BA already told you; only ask genuine unknowns. This
   mirrors the interview coverage in `openspec/config.yaml`, but produces text,
   not files.

4. **Reflect back & confirm.** Summarize the requirements in 3–5 sentences and
   get explicit confirmation before producing the brief.

5. **Assemble the requirements brief** — one structured document, all in BA
   language:
   - **Summary / user story** — who, what, why.
   - **What's changing** — a plain-language statement of the new or changed
     behavior *versus today*, so a reader instantly sees the delta.
   - **Acceptance criteria** — numbered WHEN/THEN conditions.
   - **Business rules**.
   - **In scope** / **Out of scope**.
   - **Stakeholder impact**.
   - **Open questions** — anything still unresolved (omit if none).
   Keep all engineering/OpenSpec vocabulary out; stakeholders and a future
   developer both read this.

6. **Emit the brief** — this is the *only* output:
   - **Tracker configured** → `set_requirements(taskRef, brief)` to write the full
     brief into the work item's requirements field, then emit the `refined` event
     (`set_status` → "Ready for Dev"). Report the item URL.
   - **No tracker (local) / create declined** → **print the brief to the terminal
     verbatim.** No status change, no file. Tell the BA to hand it to a developer's
     `workflow-start` (or paste it into a ticket) to take it forward.

7. **Hand off.** State plainly where the requirements now live (tracker field or
   terminal) and that a developer runs **workflow-start** next — it detects the
   brief and goes straight to planning.

## Guardrails

- Do **not** create `openspec/changes/<name>/`, write `proposal.md` / `specs/**`,
  create a branch, or commit. If you reach for the filesystem, stop —
  materializing the OpenSpec change is `workflow-start`'s job.
- Do **not** design a solution or break work into tasks. Stay in the
  problem/requirements space; `design.md` and `tasks.md` belong to the developer.
