---
name: adversarial-code-review
description: Adversarial LLM code review of a change's implementation diff before archive. Dispatches an independent skeptical reviewer subagent that tries to prove the code is broken — real bugs, edge cases, regressions — not spec coverage or style. Use as a verification gate when closing out an OpenSpec change.
---

# Adversarial code review

An independent, skeptical review of the **code** an OpenSpec change actually
introduced — run as a verification gate before archiving. This complements
`openspec-verify-change` (which checks the implementation against the *specs*):
here we ignore the specs and hunt for real defects in the diff.

**Input**: Optionally a change name. If omitted, infer the active change from
conversation context the same way `openspec-verify-change` does; if ambiguous,
run `openspec list --json` and prompt with the **AskUserQuestion** tool. Do NOT
guess.

## Steps

1. **Resolve the implementation diff.** Determine the base branch (usually the
   repo's main branch) and compute the change's code diff:

   ```bash
   base="$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || echo main)"
   mergebase="$(git merge-base HEAD "$base" 2>/dev/null || git merge-base HEAD main)"
   git diff "$mergebase"...HEAD --stat
   git diff "$mergebase"...HEAD
   ```

   If the working tree has uncommitted implementation changes, include them too
   (`git diff` and `git diff --staged`). The goal is the complete set of code
   this change is responsible for. If the diff is empty, report that and stop.

2. **Dispatch an independent adversarial reviewer subagent** (fresh context, via
   the Agent tool — `general-purpose`). Give it the diff (or the list of changed
   files plus the base ref so it can read them), **the contents of
   `.claude/REVIEW.md`** (the project-specific risk map — read it and pass it
   inline so the reviewer knows where this codebase's real bugs live), and this
   charge:

   > You are a hostile senior reviewer. **Your job is to prove this code is
   > broken.** Review the diff and read the surrounding code as needed. Find:
   > real correctness bugs, unhandled edge cases and null/empty inputs, race
   > conditions and ordering bugs, regressions in existing behavior, broken or
   > missing error handling, incorrect logic, resource leaks, and security
   > issues. For **every** finding give `file:line`, what is wrong, and a
   > **concrete failing scenario** (inputs/sequence that triggers it). Do NOT
   > report style nits, naming, formatting, or whether the work matches a spec —
   > those are out of scope. Rank each finding **CRITICAL** (a real defect that
   > will misbehave) or **WARNING** (likely issue worth a human look). If you
   > genuinely find nothing, say so explicitly rather than inventing issues.

   **Scaling (optional).** Default to a single reviewer. For large or high-risk
   changes, dispatch 2–3 reviewers in parallel (same charge) and keep findings
   that a majority agree on, to suppress one-off false positives. Note in the
   report how many reviewers ran.

3. **Consolidate findings into a report**, in the same shape as the
   `openspec-verify-change` report so the two compose:

   ```
   ## Adversarial Code Review: <change-name>
   Reviewers: N · Diff: <mergebase>..HEAD (<files> files, +X/-Y)

   ### CRITICAL  (block archive)
   - `file.ts:123` — <bug> — repro: <scenario>

   ### WARNING  (resolve or consciously accept)
   - `file.ts:45` — <issue> — repro: <scenario>
   ```

   Deduplicate overlapping findings. Drop anything that is actually a style nit
   or a spec-coverage question (defer those to `openspec-verify-change`).

4. **Gate the outcome.**
   - **CRITICAL findings → block archive.** The change is not done until each is
     fixed (or proven a false positive with reasoning). Re-run this skill after
     fixes.
   - **Only WARNINGs → not blocking,** but list them so they are resolved or
     consciously accepted before archiving.
   - **None → "No defects found in the implementation diff."**

This is a code-defect gate, not a spec gate. Run it alongside
`openspec-verify-change` during close-out (`workflow-done`), and never let a
change archive with unresolved CRITICAL findings.
