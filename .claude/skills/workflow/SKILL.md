---
name: workflow
description: Guide a task through our development workflow (start, build, close) wrapping OpenSpec and updating a configured ticket tracker. Use when the user wants to begin, continue, finish, or quickly make a tracked change, or asks about the workflow process.
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
3. **Close** — `workflow-close`: reconcile spec drift, verify, archive, mark Done.

**Quick** — `workflow-quick`: a fast lane for small, clear changes. One pass:
implement with TDD, capture a minimal spec delta, sync it into the durable specs,
archive, mark Done.

## Routing

- "start / begin / pick up <task>" → invoke **workflow-start**.
- "build / implement / continue / work the tasks" → invoke **workflow-build**.
- "close / wrap up / finish / archive" → invoke **workflow-close**.
- "quick / small change / tweak" or a change small enough to need no design
  discussion → invoke **workflow-quick**.

If unsure whether a task is quick or full, ask the user once; default to the full
path when the change touches behavior that needs a spec discussion.

If the user invoked this skill with an explicit argument
(`start`/`build`/`close`/`quick`), invoke the matching stage skill directly.
