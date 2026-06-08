---
name: workflow
description: Guide a task through our development workflow (start, build, done) wrapping OpenSpec and updating a configured ticket tracker. Use when the user wants to begin, continue, finish, or quickly make a tracked change, or asks about the workflow process.
---

# Development workflow

A staged process that wraps OpenSpec and keeps a ticket tracker's status in sync.

## Configuration

Per-repo config: `.claude/workflow.yaml` (schema in `references/config.md`). If
missing, the stage skills scaffold a `local` default. The tracker is pluggable —
see `references/providers.md` and `references/providers/{local,github,jira}.md`.
Each task is linked to its OpenSpec change via `workflow.json`
(`references/linkage.md`). Building is subagent-driven and self-contained —
`references/build-loop.md`.

These skills depend only on the `openspec-*` skills and standard host tools (no
other skill set required), so they can be shared standalone.

## Stages

1. **Start** — `workflow-start`: take a task (ticket ref, free-form, or pick from
   the tracker), set it In Progress, run OpenSpec explore/propose until an
   apply-ready change exists, commit.
2. **Build** — `workflow-build`: resume the change, implement its tasks via the
   subagent-driven build loop (fresh subagent per task, TDD, spec + quality
   review — `references/build-loop.md`), mark it In Review.
3. **Done** — `workflow-done`: reconcile spec drift, run the adversarial code
   review, verify, archive, mark Done.

**Quick** — `workflow-quick`: a fast lane for small, clear changes. One pass:
implement with TDD, capture a minimal spec delta, sync it into the durable specs,
archive, mark Done.

### Split intake: BA defines, developer starts

When a business analyst gathers requirements before any developer is assigned, an
optional **Define** stage runs ahead of Start so the requirements can sit in the
tracker (Refined / Ready for Dev) until someone picks the work up — possibly
weeks later:

- **Define** — `workflow-define`: a BA elicits requirements in business-analyst
  language and emits a structured brief to the tracker's requirements field (or,
  with no tracker, to the terminal). It writes no files, never branches, never
  commits, and authors no design/tasks. Status → Refined.
- **Start** — `workflow-start`: a developer picks up that `refined` item, and Start
  detects the requirements brief in its requirements field (or pasted in). It
  treats the brief as authoritative — satisfying the proposal interview gate — and
  materializes the OpenSpec change (proposal + specs + design + tasks against the
  *current* codebase) to apply-ready, then commits. Status → In Progress.

`workflow-start` is the single developer entry point either way: with no brief it
discovers requirements and plans in one sitting; with a brief it skips
re-interviewing and goes straight to planning. Define is just the requirements
half done earlier, by someone else.

## Routing

- "start / begin / pick up / plan <task>" → invoke **workflow-start** (it handles
  both a fresh task and picking up a BA-defined `refined` item with a requirements
  brief).
- "define / draft requirements / refine <task>" (a BA gathering requirements,
  no coding) → invoke **workflow-define**.
- "build / implement / continue / work the tasks" → invoke **workflow-build**.
- "done / close / wrap up / finish / archive" → invoke **workflow-done**.
- "quick / small change / tweak" or a change small enough to need no design
  discussion → invoke **workflow-quick**.

If unsure whether a task is quick or full, ask the user once; default to the full
path when the change touches behavior that needs a spec discussion.

If the user invoked this skill with an explicit argument
(`start`/`define`/`build`/`done`/`quick`, or the legacy alias `close` for `done`),
invoke the matching stage skill directly. The legacy alias `plan` maps to
`workflow-start`.
