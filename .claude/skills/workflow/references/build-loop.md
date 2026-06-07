# Build loop — subagent-driven implementation

`workflow-build` implements a change's tasks by dispatching fresh subagents — one
per task — with review gates. Isolated context per task keeps quality high and
the orchestrator's context clean. This loop is self-contained: it depends on no
external skill set, only the host's ability to spawn a subagent with a prompt and
read its final report (e.g. Claude Code's Task/Agent tool).

## Loop

For the active change, read `openspec/changes/<name>/tasks.md`. For each unchecked
task (or coherent group of small tasks), in order:

1. **Dispatch an implementer subagent** with the full task text plus enough
   surrounding context to place it (relevant files, conventions, excerpts of the
   change's proposal/specs). Do NOT have it read this file or the plan — give it
   the task text directly. Instruct it to:
   - Follow the TDD discipline below.
   - Implement ONLY what the task specifies — nothing extra.
   - Run the tests/build and confirm they pass.
   - Self-review its diff, then commit.
   - Report `STATUS: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED`.

2. **Handle status.** `NEEDS_CONTEXT` → provide it and re-dispatch.
   `DONE_WITH_CONCERNS` → read the concerns; resolve correctness/scope ones before
   reviewing. `BLOCKED` → change something before retrying (more context, a more
   capable model, or split the task); never silently re-run the same prompt and
   model. Escalate to the user only if the plan itself is wrong.

3. **Spec-compliance review.** Dispatch a reviewer subagent that checks the commit
   implements exactly the task's requirements — nothing missing, nothing extra. If
   it finds issues, the SAME implementer subagent fixes them; re-review until
   clean. Do this BEFORE quality review.

4. **Code-quality review.** Only after spec compliance passes, dispatch a reviewer
   subagent for correctness, clarity, test quality, and adherence to local
   conventions. Fix loop until approved.

5. **Mark the task** `- [x]` in `tasks.md`, then move to the next.

After all tasks pass both reviews, dispatch one final reviewer subagent over the
whole change's diff to confirm the change is coherent and complete.

## When to spawn (vs inline)

Spawn subagents for substantive tasks. A trivial task (a one-line edit, a doc
tweak) may be done inline without the full loop — use judgment. The default for
real implementation work is: one implementer subagent per task.

## Concurrency

Dispatch ONE implementer at a time — parallel implementers editing shared files
conflict. Independent tasks touching strictly disjoint files MAY be parallelized
only when you are certain they do not overlap.

## Model selection

Use the cheapest model that fits each role: mechanical, well-specified single-file
tasks → a fast model; multi-file integration → a standard model; design or review
judgment → the most capable model.

## TDD discipline

For each unit of behavior:

1. Write a failing test first.
2. Run it; confirm it fails for the right reason.
3. Write the minimal code to make it pass.
4. Run it; confirm it passes.
5. Refactor if needed; keep tests green.
6. Commit.

Never write implementation before a failing test exists for it. If a unit is not
testable (pure docs/config), substitute the task's own verification command for
the test.
