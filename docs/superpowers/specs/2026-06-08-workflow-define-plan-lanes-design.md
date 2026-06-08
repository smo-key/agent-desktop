# Workflow: BA `define` + developer `plan` lanes

**Date:** 2026-06-08
**Status:** Superseded (2026-06-08) — the separate `workflow-plan` dev-pickup
command was folded into `workflow-start`, which now detects a BA's requirements
brief on a `refined` item and plans from it. Decision #2 below is reversed; the
rest of the design (BA `define` lane, `refined` status, `set_requirements`,
requirements-only handoff) still holds. Read with that in mind.

## Problem

A business analyst needs to produce a requirements draft for work that a
developer may pick up *weeks later*. Two mechanisms were on the table: a new
variant of `workflow-start`, or having the BA write and commit the entire
OpenSpec change folder. The latter overshoots — it forces the BA to author
`design.md` and `tasks.md` (technical, perishable) and to use git, which BAs
typically don't. Requirements should end up in the project-management system
(Jira / GitHub Projects) when one is configured; otherwise they are produced for
the developer to carry forward.

## Decisions

1. **Requirements-only handoff.** The BA produces *requirements* (problem, scope,
   acceptance criteria) — never `design.md` / `tasks.md`. Those are authored by
   the developer at pickup, against the codebase as it stands then.
2. ~~**Separate dev pickup command** (`workflow-plan`) takes requirements →
   apply-ready OpenSpec change.~~ **Reversed 2026-06-08:** dev pickup lives in
   `workflow-start`, which detects a requirements brief on a `refined` item (or
   pasted in) and, when present, treats it as authoritative and plans straight
   from it. No separate command.
3. **New `refined` status** ("Ready for Dev") sits between BA and developer.
4. **The PM system is the system of record** for requirements when configured;
   the BA command writes the brief into a tracker field.
5. **BA language**, not OpenSpec jargon, in everything the BA sees and everything
   written to the tracker. The brief makes "what the requirements are and what
   changed" obvious at a glance.
6. **`workflow-define` writes no files, never branches, never commits.** Its only
   outputs are a tracker field (configured) or the terminal (local).

## Lanes

```
workflow-define  (BA)   → requirements brief → tracker field OR terminal   [status: Refined]
workflow-start   (dev)  → proposal+specs+design+tasks → apply-ready, commit [status: In Progress]
                          ↑ detects a brief on a refined item / pasted in; else discovers fresh
workflow-build   (dev)  → implement via build loop                         [status: In Review]
workflow-done    (dev)  → adversarial review, verify, archive              [status: Done]

workflow-quick   (solo) → unchanged
```

## `workflow-define` (BA)

- Reads config + tracker only. **No filesystem writes, no branch, no commit, and
  it does NOT invoke the file-writing OpenSpec skills.**
- Intake: ref → `resolve`; free-form + configured tracker → offer to `create` a
  stub item (so there's something to write the brief to); free-form + local /
  declined → terminal output; nothing → `list_open` pick.
- Interviews in BA language using the coverage rubric from
  `openspec/config.yaml` (problem, stakeholders, scope, business rules,
  acceptance criteria, alternatives) — but produces text, not files.
- Assembles a structured **requirements brief**: summary/user story · what's
  changing (the delta in plain language) · acceptance criteria (WHEN/THEN) ·
  business rules · in/out scope · stakeholder impact · open questions.
- Emits:
  - **Tracker configured** → `set_requirements(taskRef, brief)` into the item's
    requirements field, then `refined` → "Ready for Dev".
  - **Local** → prints the brief to the terminal. No status, no file.

### Consequence (accepted)

In local mode there is **no durable BA artifact** — the brief lives only in the
terminal until a developer feeds it into `workflow-start`. Persisting it is a
tracker's job, not `define`'s. The configured-tracker path is where the BA→dev
gap is durably bridged.

## `workflow-start` dev-pickup path (was `workflow-plan`)

`workflow-start` gained a brief-aware lane instead of a separate command. When
the intaken task carries a requirements brief, Start runs this path:

- Obtains requirements: tracker → read the item's requirements field (via
  `resolve`); local → developer supplies the brief text.
- Derives the change name, emits `started` (→ In Progress, off "Refined"),
  branches if configured.
- **Materializes the OpenSpec change**: authors `proposal.md` + `specs/**` from
  the brief (the brief satisfies the proposal interview gate — don't re-interview
  settled points), then `design.md` + `tasks.md` **against the current
  codebase** → apply-ready.
- Writes `workflow.json` and commits (the developer's first commit = requirements
  materialized + plan). Emits `planned`. Hands off to `workflow-build`.

## Provider / config changes

- New provider operation **`set_requirements(ref, content)`** — write the brief to
  the work item's requirements field (description by default, or an optional
  configured custom field). `local` is a no-op (the brief goes to the terminal).
  Reading back is `resolve(ref).description`.
- Config: new `refined: "Ready for Dev"` status; optional `github.requirementsField`
  / `jira.requirementsField` to target a custom field instead of the description.
- Lifecycle events gain `refined` (emitted by `workflow-define`). `started` and
  `planned` continue to be emitted by `workflow-start`, including on its
  brief-aware pickup path.

## Out of scope

- Auto-syncing edits made directly in the tracker back into the brief.
- A file-based local tracker for BA persistence (noted as the future fix if local
  durability is ever wanted).
