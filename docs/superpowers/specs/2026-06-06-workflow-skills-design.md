# Workflow skills — design

**Date:** 2026-06-06
**Status:** Approved (brainstorming) — pending implementation plan

## Purpose

A set of Claude Code skills that guide our development workflow end-to-end,
wrapping the existing OpenSpec lifecycle (explore/propose → apply → verify →
archive) and driving an external ticket/backlog tracker's status as work moves
through the stages. The tracker is pluggable (local, GitHub Projects, Jira) and
configured per-repo.

## Skills

All live as flat directories under `.claude/skills/`, matching the existing
`openspec-*` skills.

- **`workflow`** — thin index/router. Explains the staged process, points at the
  config, and routes to the right stage skill. Invoking it with an argument
  (`start` | `build` | `close` | `quick`) defers to that skill. When a task
  is small and clear it routes to `workflow-quick`; otherwise the full path.
- **`workflow-start`** — task intake → status update → discovery
  (`openspec-explore` or `openspec-propose`) → apply-ready OpenSpec change →
  commit.
- **`workflow-build`** — resume the active change → status update →
  `openspec-apply-change` (TDD) → tasks complete.
- **`workflow-close`** — spec/implementation drift reconciliation →
  `openspec-verify-change` → `openspec-archive-change` → final status update.
- **`workflow-quick`** — fast lane for small, clear changes: intake (asking
  clarifying questions only if ambiguous) → implement with TDD, capturing the
  behavior delta as a minimal OpenSpec change → `openspec-sync-specs` to fold the
  delta into the durable specs → archive the change → status update. Collapses
  Start→Build→Close into one pass.

## Config — `.claude/workflow.yaml`

Per-repo, version-controlled. If absent when a skill runs, the skill scaffolds a
default (`provider: local`) and tells the user.

```yaml
provider: github            # local | github | jira
branchPerTask: true         # create a git branch when Start/Quick runs

github:
  project: "owner/repo"     # or project number / URL for `gh project`
jira:
  baseUrl: https://acme.atlassian.net
  projectKey: PROJ
  # auth via env: JIRA_EMAIL, JIRA_API_TOKEN

# Map workflow lifecycle events -> the provider's status name.
# Omit an event to skip that transition.
statuses:
  started:      "In Progress"   # Start/Quick begins discovery
  planned:      "In Progress"   # plan committed, apply-ready (optional)
  implementing: "In Progress"   # Build begins
  review:       "In Review"     # implementation done (optional)
  done:         "Done"          # Close/Quick complete
```

### Lifecycle events

The canonical events the skills emit; each maps (optionally) to a provider
status via the config:

| Event          | Emitted by                                  |
|----------------|---------------------------------------------|
| `started`      | `workflow-start` / `workflow-quick` at intake |
| `planned`      | `workflow-start` after the change is apply-ready |
| `implementing` | `workflow-build` at start               |
| `review`       | `workflow-build` after tasks complete   |
| `done`         | `workflow-close` / `workflow-quick` after archive |

Omitting an event key in `statuses` makes that transition a no-op (useful for
trackers with a coarse To Do / Doing / Done lifecycle).

## Provider contract

A "provider" is a reference doc instructing the agent which tools to call for
four operations. There is no provider code — the skill follows the doc using
available CLIs/MCP tools.

| Operation             | Purpose                                          |
|-----------------------|--------------------------------------------------|
| `resolve(ref)`        | Fetch a task's title, description, status, URL   |
| `list_open()`         | List candidate open tasks (for pick-from-list)   |
| `set_status(ref, st)` | Transition a task to a status                     |
| `create(title, desc)` | File a new task (when a free-form task should be tracked) |

### Implementations

- **local** (default) — no external tracker. Tasks are free-form descriptions or
  existing OpenSpec changes. `list_open` reads `openspec/changes/`. `set_status`
  is a no-op logged into the change's `workflow.json`. Works with zero setup.
- **github** — `gh` CLI. `resolve` via `gh issue view`; `list_open` via
  `gh project item-list`; `set_status` via `gh project item-edit` (single-select
  status field); `create` via `gh issue create`.
- **jira** — REST via `curl` with `JIRA_EMAIL` / `JIRA_API_TOKEN`. `resolve` via
  `GET /rest/api/3/issue/{key}`; `set_status` via `GET .../transitions` then
  `POST .../transitions`; `list_open` via JQL search; `create` via
  `POST /rest/api/3/issue`.

## Task ↔ change linkage

`workflow-start` (and `workflow-quick`) writes
`openspec/changes/<name>/workflow.json`:

```json
{
  "provider": "github",
  "taskRef": "owner/repo#123",
  "url": "https://github.com/owner/repo/issues/123",
  "lastEvent": "planned"
}
```

Co-located with the change, version-controlled. `workflow-build` and
`workflow-close` read it to know which task to transition without re-asking.

## Stage flows

### Start (`workflow-start`)
1. Load `.claude/workflow.yaml`; scaffold a `local` default if missing.
2. Intake: a ticket ref → `resolve`; or free-form text; or neither →
   `list_open` and the user picks.
3. `set_status(started)`. Create a branch if `branchPerTask`.
4. **Assess uncertainty and recommend** `openspec-explore` (fuzzy) vs
   `openspec-propose` (clear); confirm with the user; drive that skill until the
   change is apply-ready (proposal/design/specs/tasks).
5. Write `workflow.json`, commit artifacts, `set_status(planned)`.

### Build (`workflow-build`)
1. Resolve the active change from `workflow.json` / current branch / ask.
   `set_status(implementing)`.
2. Invoke `openspec-apply-change` (TDD per superpowers) through all tasks.
3. `set_status(review)`.

### Close (`workflow-close`)
1. Resolve the active change. **Drift gate** (per `CLAUDE.md`): reconcile
   anything discussed or implemented this session that the specs/tasks/proposal
   don't yet reflect; update them.
2. `openspec-verify-change` → `openspec-archive-change`.
3. `set_status(done)`.

### Quick (`workflow-quick`)
1. Intake the task; ask clarifying questions only if ambiguous. `set_status(started)`.
2. Make the change with TDD, capturing the behavior delta as a minimal OpenSpec
   change (`## ADDED`/`## MODIFIED` spec delta + short tasks). Write
   `workflow.json`.
3. `openspec-sync-specs` to fold the delta into `openspec/specs/`.
4. `openspec-archive-change` so nothing lingers under `openspec/changes/`.
5. `set_status(done)`, commit.

## Decisions (defaults chosen during brainstorming)

- **explore vs propose** in Start: the agent assesses uncertainty and
  recommends, then confirms with the user (rather than always asking or always
  guessing).
- **linkage location**: `openspec/changes/<name>/workflow.json` (co-located with
  the change), not a top-level state file.
- **quick close-out**: sync the delta into main specs, then archive the change.

## Testing

- Provider docs include copy-paste verification commands (e.g. a dry-run
  `gh project item-list`).
- The `local` provider and config parsing get a small fixture-based check.
- The skills are validated by walking one task end-to-end against the `local`
  provider (start → build → close, and a separate quick pass).

## Out of scope

- Linear provider (Linear MCP is available but not requested for v1; the provider
  contract leaves room to add it).
- Auto-selecting tasks without user confirmation.
- Any change to the OpenSpec skills themselves — these skills orchestrate them.
