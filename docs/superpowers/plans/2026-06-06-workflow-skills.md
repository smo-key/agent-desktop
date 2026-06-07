# Workflow Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a set of Claude Code skills (`workflow` + `workflow-start` / `-build` / `-close` / `-quick`) that drive our OpenSpec development lifecycle and update a pluggable ticket tracker's status as work moves through stages.

**Architecture:** Skills are markdown `SKILL.md` files auto-discovered under `.claude/skills/`. The `workflow` skill owns shared reference docs (config schema, provider contract, linkage format, per-provider procedures) under `.claude/skills/workflow/references/`; the four stage skills are thin and link to those references to stay DRY. A provider is a documented procedure (which CLI/MCP tools to call), not code. Per-repo config lives in `.claude/workflow.yaml`; each in-flight task is linked to its OpenSpec change via `openspec/changes/<name>/workflow.json`.

**Tech Stack:** Markdown skills (Claude Code), YAML config, `gh` CLI (GitHub Projects), `curl` + Jira REST, existing `openspec-*` skills.

**Source design:** `docs/superpowers/specs/2026-06-06-workflow-skills-design.md`

---

## File structure

Created under `.claude/skills/`:

```
workflow/
  SKILL.md                      # router/index (Task 7)
  references/
    config.md                   # config schema + scaffold default (Task 1)
    linkage.md                  # workflow.json format + read/write (Task 2)
    providers.md                # provider contract + event→status mapping (Task 3)
    build-loop.md               # subagent-driven build loop + TDD (Task 6.5)
    providers/
      local.md                  # local provider (Task 4)
      github.md                 # GitHub Projects provider (Task 5)
      jira.md                   # Jira provider (Task 6)
workflow-start/SKILL.md         # Task 8
workflow-build/SKILL.md     # Task 9
workflow-close/SKILL.md         # Task 10
workflow-quick/SKILL.md         # Task 11
```

No registry file is edited — Claude Code auto-discovers skills by scanning `.claude/skills/*/SKILL.md` (same as the existing `openspec-*` skills). Reference docs are addressed by repo-relative path so any stage skill can read them.

**Verification conventions used throughout:**
- Frontmatter check: `head -5 <file>` shows `---`, `name:`, `description:`.
- "Reads cleanly": the file exists and contains the required section headers (grep).
- The embedded example config in `references/config.md` is the canonical YAML shape; Task 12 parses it.

---

### Task 1: Config reference (`references/config.md`)

Defines `.claude/workflow.yaml`: schema, every field, the lifecycle-event→status map, and the default the skills scaffold when the file is missing.

**Files:**
- Create: `.claude/skills/workflow/references/config.md`

- [ ] **Step 1: Write the file**

````markdown
# Workflow config — `.claude/workflow.yaml`

Per-repo, version-controlled. Every workflow skill loads this first. If it is
missing, the skill scaffolds the **Default** below (writing the file) and tells
the user, then continues with `provider: local`.

## Schema

```yaml
provider: github            # local | github | jira  (required)
branchPerTask: true         # create a git branch when Start/Quick begins (default: true)

github:                     # required when provider: github
  project: "owner/repo"     # repo for issues; project resolved via `gh project` for that owner
jira:                       # required when provider: jira
  baseUrl: https://acme.atlassian.net
  projectKey: PROJ
  # auth read from env: JIRA_EMAIL, JIRA_API_TOKEN

# Map workflow lifecycle events -> the EXACT provider status name.
# Omit any event to make that transition a no-op.
statuses:
  started:      "In Progress"
  planned:      "In Progress"
  implementing: "In Progress"
  review:       "In Review"
  done:         "Done"
```

## Fields

- `provider` — which tracker integration to use. `local` needs no other config.
- `branchPerTask` — when true, Start/Quick create a git branch named after the
  change (e.g. `git switch -c <change-name>`) before discovery/implementation.
- `github.project` — `owner/repo`. Issues are read/created here; the org/user
  Project (v2) board is discovered from that owner for status edits.
- `jira.baseUrl` / `jira.projectKey` — Jira site and project. Credentials come
  from the `JIRA_EMAIL` and `JIRA_API_TOKEN` environment variables, never the file.
- `statuses` — maps each lifecycle event (see `../providers.md`) to the literal
  status string the provider expects. Trackers with a coarse To Do/Doing/Done
  flow can omit `planned`/`review`.

## Lifecycle events

| Event          | Emitted by                                     |
|----------------|------------------------------------------------|
| `started`      | `workflow-start` / `workflow-quick` at intake  |
| `planned`      | `workflow-start` once the change is apply-ready |
| `implementing` | `workflow-build` at start                  |
| `review`       | `workflow-build` after tasks complete      |
| `done`         | `workflow-close` / `workflow-quick` after archive |

## Default (scaffolded when the file is absent)

```yaml
provider: local
branchPerTask: true
statuses:
  started:      "In Progress"
  planned:      "In Progress"
  implementing: "In Progress"
  review:       "In Review"
  done:         "Done"
```

When scaffolding, write exactly the block above to `.claude/workflow.yaml` and
tell the user: "No `.claude/workflow.yaml` found — created a default using the
`local` provider (no external tracker). Edit it to point at GitHub or Jira."
````

- [ ] **Step 2: Verify frontmatter-free reference reads cleanly**

Run: `grep -E "^## (Schema|Fields|Lifecycle events|Default)" .claude/skills/workflow/references/config.md`
Expected: all four headers listed.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/workflow/references/config.md
git commit -m "feat(workflow): config schema reference for workflow skills"
```

---

### Task 2: Linkage reference (`references/linkage.md`)

Defines `openspec/changes/<name>/workflow.json`, the link between a tracker task and its OpenSpec change, plus how skills read/write it.

**Files:**
- Create: `.claude/skills/workflow/references/linkage.md`

- [ ] **Step 1: Write the file**

````markdown
# Task ↔ change linkage — `workflow.json`

`workflow-start` and `workflow-quick` write
`openspec/changes/<name>/workflow.json` so later stages know which tracker task
to transition without re-asking. It is version-controlled and committed with the
change's artifacts.

## Format

```json
{
  "provider": "github",
  "taskRef": "owner/repo#123",
  "url": "https://github.com/owner/repo/issues/123",
  "lastEvent": "planned"
}
```

- `provider` — copied from config at creation time.
- `taskRef` — the provider-native reference (`owner/repo#N`, `PROJ-123`, or a
  short slug for free-form `local` tasks).
- `url` — link to the task if one exists (empty string for local free-form).
- `lastEvent` — the most recent lifecycle event emitted, updated in place each
  time a skill calls `set_status`.

## Reading (Build / Close)

1. If on a branch matching a change name, look for
   `openspec/changes/<branch>/workflow.json`.
2. Otherwise list `openspec/changes/*/workflow.json`; if exactly one is
   un-archived, use it; if several, ask the user which change to act on.
3. If none exists, the change predates workflow tracking — ask the user for the
   task ref (or proceed with no status updates).

## Writing / updating

- Start/Quick create it after the change directory exists.
- On every `set_status(event)`, update `lastEvent` to that event and rewrite the
  file.
- `workflow-close` / `workflow-quick` leave the final file in the change so it is
  carried into the archive alongside the other artifacts.
````

- [ ] **Step 2: Verify**

Run: `grep -E "^## (Format|Reading|Writing)" .claude/skills/workflow/references/linkage.md`
Expected: three headers.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/workflow/references/linkage.md
git commit -m "feat(workflow): workflow.json linkage reference"
```

---

### Task 3: Provider contract (`references/providers.md`)

The shared contract every provider implements, plus how skills turn a lifecycle event into a `set_status` call via the config map.

**Files:**
- Create: `.claude/skills/workflow/references/providers.md`

- [ ] **Step 1: Write the file**

````markdown
# Provider contract

A "provider" is a documented procedure (in `providers/<name>.md`) for four
operations. There is no provider code — follow the matching doc using the tools
named there. Select the provider from `provider:` in `.claude/workflow.yaml`
(see `config.md`).

## Operations

| Operation             | Returns / effect                                  |
|-----------------------|---------------------------------------------------|
| `resolve(ref)`        | `{ title, description, status, url }` for a task   |
| `list_open()`         | A list of `{ ref, title, status }` for open tasks  |
| `set_status(ref, st)` | Transition the task to status string `st`          |
| `create(title, desc)` | File a new task; returns `{ ref, url }`            |

Each provider doc gives the exact command(s) for each operation.

## Emitting a lifecycle event

Skills never hardcode a status string. To emit event `E` for the active task:

1. Read `statuses.E` from `.claude/workflow.yaml`.
2. If absent/empty → **no-op** (do nothing; the tracker has no matching status).
3. Otherwise call the provider's `set_status(taskRef, statuses.E)`.
4. Update `lastEvent` in `workflow.json` (see `linkage.md`).

The events are: `started`, `planned`, `implementing`, `review`, `done`
(see `config.md`).

## Intake (used by Start / Quick)

Given the user's input:

- A provider-native ref or task URL → `resolve(ref)`; use its title/description
  to seed the OpenSpec change.
- Free-form text → use it directly as the task description. If the config
  provider is not `local`, offer to `create(title, desc)` so the work is tracked;
  if the user declines, proceed untracked (treat as `local` for status ops).
- Nothing → `list_open()` and let the user pick one.

## Errors

If a provider command fails (missing `gh` auth, missing `JIRA_*` env, network),
report the failure and ask whether to continue **untracked** (skip status
updates) or stop. Never block the actual development work on a tracker error.
````

- [ ] **Step 2: Verify**

Run: `grep -E "^## (Operations|Emitting a lifecycle event|Intake|Errors)" .claude/skills/workflow/references/providers.md`
Expected: four headers.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/workflow/references/providers.md
git commit -m "feat(workflow): provider contract reference"
```

---

### Task 4: Local provider (`references/providers/local.md`)

The zero-setup default: no external tracker.

**Files:**
- Create: `.claude/skills/workflow/references/providers/local.md`

- [ ] **Step 1: Write the file**

````markdown
# Provider: local

No external tracker. Used when `provider: local` (the scaffold default) or when
the user declines to file a free-form task.

- **resolve(ref)** — there is nothing to fetch. `ref` is a short kebab slug
  derived from the task description (it usually equals the change name). Return
  `{ title: <description first line>, description: <the text>, status: "", url: "" }`.
- **list_open()** — read `openspec/changes/*/` (excluding `archive/`). Each
  un-archived change is a candidate; return `{ ref: <change-name>, title:
  <proposal.md first heading>, status: <workflow.json.lastEvent or ""> }`.
- **set_status(ref, st)** — no external system. Record it: set `lastEvent` in the
  change's `workflow.json` (the status string itself is informational only). Do
  not print noise on every call.
- **create(title, desc)** — nothing to create remotely; the OpenSpec change *is*
  the record. Return `{ ref: <change-name>, url: "" }`.

No credentials, network, or CLI required.
````

- [ ] **Step 2: Verify**

Run: `grep -E "resolve|list_open|set_status|create" .claude/skills/workflow/references/providers/local.md`
Expected: all four operation names present.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/workflow/references/providers/local.md
git commit -m "feat(workflow): local provider reference"
```

---

### Task 5: GitHub provider (`references/providers/github.md`)

GitHub Issues + Projects (v2) via `gh` CLI.

**Files:**
- Create: `.claude/skills/workflow/references/providers/github.md`

- [ ] **Step 1: Write the file**

````markdown
# Provider: github

Uses the `gh` CLI against `github.project: "owner/repo"`. Requires `gh auth
status` to be logged in with `project` scope. If a command fails, follow the
Errors guidance in `../providers.md`.

`ref` format: `owner/repo#NUMBER` (issue). The Project (v2) board is the owner's
board that contains the issue; its single-select **Status** field holds the
workflow status.

- **resolve(ref)** — parse `owner/repo#N`, then:
  ```bash
  gh issue view N --repo owner/repo --json title,body,url,state
  ```
  Return `{ title, description: body, status: state, url }`.

- **list_open()** — open issues assigned to the user:
  ```bash
  gh issue list --repo owner/repo --state open --assignee @me \
    --json number,title --limit 30
  ```
  Map to `{ ref: "owner/repo#"+number, title, status: "open" }`.

- **set_status(ref, st)** — set the Project Status field for the issue. Resolve
  the project, item, field, and option ids, then edit:
  ```bash
  # 1. find the project number for the owner
  gh project list --owner OWNER --format json
  # 2. find the item id for this issue within the project
  gh project item-list NUMBER --owner OWNER --format json   # match content.url to the issue
  # 3. find the Status field id and the option id whose name == st
  gh project field-list NUMBER --owner OWNER --format json
  # 4. apply
  gh project item-edit --id ITEM_ID --field-id FIELD_ID \
     --project-id PROJECT_ID --single-select-option-id OPTION_ID
  ```
  If the issue is not on any project board, report it and treat as untracked.

- **create(title, desc)** —
  ```bash
  gh issue create --repo owner/repo --title "TITLE" --body "DESC" \
    --assignee @me
  ```
  Capture the printed URL; derive `ref` as `owner/repo#N` from it. Adding the new
  issue to the project board (so `set_status` works) is optional — if the board
  has a workflow that auto-adds issues, nothing more is needed; otherwise
  `gh project item-add NUMBER --owner OWNER --url <issue-url>`.

## Verify your setup (dry run)

```bash
gh auth status
gh issue list --repo owner/repo --state open --limit 1
```
````

- [ ] **Step 2: Verify**

Run: `grep -E "gh (issue|project)" .claude/skills/workflow/references/providers/github.md | head`
Expected: several `gh issue` / `gh project` commands present.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/workflow/references/providers/github.md
git commit -m "feat(workflow): github projects provider reference"
```

---

### Task 6: Jira provider (`references/providers/jira.md`)

Jira Cloud REST v3 via `curl`.

**Files:**
- Create: `.claude/skills/workflow/references/providers/jira.md`

- [ ] **Step 1: Write the file**

````markdown
# Provider: jira

Jira Cloud REST API v3 via `curl`. Reads `jira.baseUrl` and `jira.projectKey`
from `.claude/workflow.yaml`; auth from env `JIRA_EMAIL` and `JIRA_API_TOKEN`
(basic auth). If either env var is unset, follow the Errors guidance in
`../providers.md` (offer untracked or stop).

`ref` format: an issue key like `PROJ-123`.

Common auth prefix (used in every call):
```bash
AUTH="-u ${JIRA_EMAIL}:${JIRA_API_TOKEN}"
BASE="${JIRA_BASEURL}"   # from config jira.baseUrl
```

- **resolve(ref)** —
  ```bash
  curl -s $AUTH "$BASE/rest/api/3/issue/PROJ-123?fields=summary,description,status" \
    -H "Accept: application/json"
  ```
  Return `{ title: fields.summary, description: fields.description,
  status: fields.status.name, url: "$BASE/browse/PROJ-123" }`.

- **list_open()** — JQL for the user's open issues in the project:
  ```bash
  curl -s $AUTH -G "$BASE/rest/api/3/search" \
    --data-urlencode 'jql=project=PROJ AND assignee=currentUser() AND statusCategory!=Done ORDER BY updated DESC' \
    --data-urlencode 'fields=summary,status' --data-urlencode 'maxResults=30' \
    -H "Accept: application/json"
  ```
  Map issues to `{ ref: key, title: fields.summary, status: fields.status.name }`.

- **set_status(ref, st)** — Jira moves status via *transitions*, not direct
  writes. Find the transition whose target status name equals `st`, then POST it:
  ```bash
  # 1. list available transitions
  curl -s $AUTH "$BASE/rest/api/3/issue/PROJ-123/transitions" -H "Accept: application/json"
  # 2. pick the transition where .transitions[].to.name == st  -> TRANSITION_ID
  # 3. apply
  curl -s $AUTH -X POST "$BASE/rest/api/3/issue/PROJ-123/transitions" \
    -H "Content-Type: application/json" \
    -d '{"transition":{"id":"TRANSITION_ID"}}'
  ```
  If no transition leads to `st` from the current status, report it (the Jira
  workflow may not allow that move) and continue untracked for this event.

- **create(title, desc)** —
  ```bash
  curl -s $AUTH -X POST "$BASE/rest/api/3/issue" \
    -H "Content-Type: application/json" \
    -d '{"fields":{"project":{"key":"PROJ"},"summary":"TITLE",
         "description":{"type":"doc","version":1,"content":[{"type":"paragraph",
         "content":[{"type":"text","text":"DESC"}]}]},
         "issuetype":{"name":"Task"}}}'
  ```
  Return `{ ref: <key from response>, url: "$BASE/browse/<key>" }`.

## Verify your setup (dry run)

```bash
curl -s -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  "$JIRA_BASEURL/rest/api/3/myself" -H "Accept: application/json"
```
Expected: your account JSON (not 401).
````

- [ ] **Step 2: Verify**

Run: `grep -E "rest/api/3/(issue|search)" .claude/skills/workflow/references/providers/jira.md | head`
Expected: several REST endpoints present.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/workflow/references/providers/jira.md
git commit -m "feat(workflow): jira provider reference"
```

---

### Task 6.5: Build-loop reference (`references/build-loop.md`)

The self-contained subagent-driven build methodology `workflow-build` follows
(and the TDD discipline `workflow-quick` borrows). Documents how to spawn
implementer/reviewer subagents per task. Deliberately references **no** external
skill set so the workflow skills can be shared standalone.

**Files:**
- Create: `.claude/skills/workflow/references/build-loop.md`

- [ ] **Step 1: Write the file**

````markdown
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
````

- [ ] **Step 2: Verify**

Run: `grep -E "^## (Loop|Concurrency|Model selection|TDD discipline)" .claude/skills/workflow/references/build-loop.md && ! grep -qi superpowers .claude/skills/workflow/references/build-loop.md && echo "no-superpowers-ok"`
Expected: the four headers listed, then `no-superpowers-ok`.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/workflow/references/build-loop.md
git commit -m "feat(workflow): self-contained subagent-driven build-loop reference"
```

---

### Task 7: `workflow` index skill

Router/overview. Explains the staged process, links the references, and routes to a stage skill (including `quick`).

**Files:**
- Create: `.claude/skills/workflow/SKILL.md`

- [ ] **Step 1: Write the file**

````markdown
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
````

- [ ] **Step 2: Verify frontmatter**

Run: `head -3 .claude/skills/workflow/SKILL.md`
Expected: `---`, `name: workflow`, `description: ...`.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/workflow/SKILL.md
git commit -m "feat(workflow): workflow index/router skill"
```

---

### Task 8: `workflow-start` skill

**Files:**
- Create: `.claude/skills/workflow-start/SKILL.md`

- [ ] **Step 1: Write the file**

````markdown
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
````

- [ ] **Step 2: Verify frontmatter + step coverage**

Run: `head -3 .claude/skills/workflow-start/SKILL.md && grep -cE "^[0-9]+\. \*\*" .claude/skills/workflow-start/SKILL.md`
Expected: valid frontmatter; step count `8`.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/workflow-start/SKILL.md
git commit -m "feat(workflow): workflow-start skill"
```

---

### Task 9: `workflow-build` skill

(Renamed from `workflow-implement`; the stage's human label is "Build".)

**Files:**
- Create: `.claude/skills/workflow-build/SKILL.md`

- [ ] **Step 1: Write the file**

````markdown
---
name: workflow-build
description: Implement the active OpenSpec change in the development workflow — mark it in progress, then drive the change's tasks through a self-contained subagent-driven build loop (fresh subagent per task, TDD, spec + quality review), and mark it in review. Use when the user wants to implement or continue work on a started change.
---

# Workflow — Build

Resume the active change and implement its tasks, updating the tracker. Building
is **subagent-driven**: each task is delegated to a fresh subagent with isolated
context, then reviewed, so quality stays high and your own context stays clean.
This skill is self-contained — it relies on no external skill set.

Read first:
- `.claude/skills/workflow/references/linkage.md`
- `.claude/skills/workflow/references/providers.md` and the configured provider
  file.
- `.claude/skills/workflow/references/build-loop.md` (the subagent-driven build
  loop + TDD discipline you will follow in step 4).

## Steps

1. **Load config** (`.claude/workflow.yaml`).

2. **Resolve the active change** using the "Reading" procedure in `linkage.md`
   (branch name → single un-archived `workflow.json` → ask). Load its
   `workflow.json` for `provider`/`taskRef`.

3. **Mark implementing.** Emit the `implementing` event; update `lastEvent`.

4. **Run the build loop.** Read the change's `tasks.md` and implement it by
   following `references/build-loop.md`: for each unchecked task, dispatch a
   fresh implementer subagent (TDD, full task text + context), then a
   spec-compliance review subagent, then a code-quality review subagent, fixing
   in loops until both pass; mark the task `- [x]` and commit. Spawn subagents as
   needed — a trivial task may be done inline. Do not stop until every `- [ ]`
   task is checked. End with one final review subagent over the whole change.

5. **Mark review.** When tasks are complete, emit the `review` event; update
   `lastEvent`.

6. **Hand off.** Tell the user implementation is complete and `workflow-close` is
   next (drift reconciliation → verify → archive).
````

- [ ] **Step 2: Verify**

Run: `head -3 .claude/skills/workflow-build/SKILL.md && grep -cE "^[0-9]+\. \*\*" .claude/skills/workflow-build/SKILL.md`
Expected: valid frontmatter; step count `6`. Also confirm no occurrence of "superpowers": `! grep -qi superpowers .claude/skills/workflow-build/SKILL.md && echo "no-superpowers-ok"`.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/workflow-build/SKILL.md
git commit -m "feat(workflow): workflow-build skill"
```

---

### Task 10: `workflow-close` skill

**Files:**
- Create: `.claude/skills/workflow-close/SKILL.md`

- [ ] **Step 1: Write the file**

````markdown
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
````

- [ ] **Step 2: Verify**

Run: `head -3 .claude/skills/workflow-close/SKILL.md && grep -cE "^[0-9]+\. \*\*" .claude/skills/workflow-close/SKILL.md`
Expected: valid frontmatter; step count `7`.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/workflow-close/SKILL.md
git commit -m "feat(workflow): workflow-close skill"
```

---

### Task 11: `workflow-quick` skill

**Files:**
- Create: `.claude/skills/workflow-quick/SKILL.md`

- [ ] **Step 1: Write the file**

````markdown
---
name: workflow-quick
description: Fast lane for a small, clear change — implement with TDD, capture a minimal spec delta, sync it into the durable specs, archive, and mark the tracker Done in one pass. Use when the change is small enough to skip the full start/implement/close ceremony.
---

# Workflow — Quick

One-pass path for small, well-understood changes. Collapses
Start→Build→Close.

Read first:
- `.claude/skills/workflow/references/config.md`
- `.claude/skills/workflow/references/providers.md` and the configured provider.
- `.claude/skills/workflow/references/linkage.md`
- `.claude/skills/workflow/references/build-loop.md` (TDD discipline)

## Steps

1. **Load config** (`.claude/workflow.yaml`; scaffold default if missing).

2. **Intake** the task (ref / free-form / pick — see `providers.md`). **Ask
   clarifying questions only if the change is ambiguous**; otherwise proceed.
   Derive a kebab-case change name.

3. **Mark started.** Emit the `started` event.

4. **Branch** if `branchPerTask` (`git switch -c <change-name>`).

5. **Implement with TDD.** Make the change directly following the TDD discipline
   in `references/build-loop.md` (failing test → minimal code → pass → commit),
   committing as you go. Spawn a subagent for any chunky sub-part if it helps,
   but a quick change is usually done inline.

6. **Capture the delta.** Create a minimal OpenSpec change directory for
   `<change-name>` containing a spec delta (`## ADDED`/`## MODIFIED` with at least
   one `#### Scenario:`) describing the behavior change, plus a short `tasks.md`
   reflecting what you did. Write `workflow.json` (linkage.md). Commit.

   If, while implementing, the change turns out to be larger than expected
   (needs design discussion or spans multiple capabilities), STOP and hand off to
   the full path: keep the work, tell the user, and suggest `workflow-start` /
   `workflow-build` instead.

7. **Sync specs.** Invoke **openspec-sync-specs** to fold the delta into
   `openspec/specs/`.

8. **Archive.** Invoke **openspec-archive-change** so nothing lingers under
   `openspec/changes/`.

9. **Mark done.** Emit the `done` event. Report what shipped and the task status.
````

- [ ] **Step 2: Verify**

Run: `head -3 .claude/skills/workflow-quick/SKILL.md && grep -cE "^[0-9]+\. \*\*" .claude/skills/workflow-quick/SKILL.md`
Expected: valid frontmatter; step count `9`.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/workflow-quick/SKILL.md
git commit -m "feat(workflow): workflow-quick skill"
```

---

### Task 12: Integration verification

Confirm all skills are well-formed, the example config is valid YAML, references resolve, and the repo's existing gates still pass. Then a dry end-to-end walkthrough against the `local` provider.

**Files:**
- None created (verification + final commit if anything was fixed).

- [ ] **Step 1: Every skill has valid frontmatter**

Run:
```bash
for f in .claude/skills/workflow/SKILL.md \
         .claude/skills/workflow-start/SKILL.md \
         .claude/skills/workflow-build/SKILL.md \
         .claude/skills/workflow-close/SKILL.md \
         .claude/skills/workflow-quick/SKILL.md; do
  echo "== $f =="; head -3 "$f"
done
```
Expected: each starts with `---` then `name:` then `description:`.

- [ ] **Step 2: Example config parses as YAML**

Extract the Default block from `config.md` and parse it. Use whichever YAML
parser is available:
```bash
# write the scaffold default to a temp file and validate it
cat > /tmp/wf.yaml <<'YAML'
provider: local
branchPerTask: true
statuses:
  started:      "In Progress"
  planned:      "In Progress"
  implementing: "In Progress"
  review:       "In Review"
  done:         "Done"
YAML
python3 -c "import yaml;print(yaml.safe_load(open('/tmp/wf.yaml')))" 2>/dev/null \
  || ruby -ryaml -e "p YAML.load_file('/tmp/wf.yaml')" 2>/dev/null \
  || node -e "const fs=require('fs');const s=fs.readFileSync('/tmp/wf.yaml','utf8');if(!/provider:\s*local/.test(s))process.exit(1);console.log('basic-ok')"
```
Expected: a parsed dict / `basic-ok` (no parser error).

- [ ] **Step 3: Reference links resolve**

Every `references/...` path mentioned in the SKILL.md files must exist.
```bash
ls .claude/skills/workflow/references/config.md \
   .claude/skills/workflow/references/linkage.md \
   .claude/skills/workflow/references/providers.md \
   .claude/skills/workflow/references/build-loop.md \
   .claude/skills/workflow/references/providers/local.md \
   .claude/skills/workflow/references/providers/github.md \
   .claude/skills/workflow/references/providers/jira.md
```
Expected: all seven listed, no "No such file".

Also confirm no shared skill leaks a superpowers dependency:
```bash
! grep -rqi superpowers .claude/skills/workflow .claude/skills/workflow-* && echo "self-contained-ok"
```
Expected: `self-contained-ok`.

- [ ] **Step 4: Existing OpenSpec gate still passes**

Run: `openspec validate --all 2>/dev/null || openspec validate`
Expected: existing changes still pass (these skills add no OpenSpec changes).

- [ ] **Step 5: Dry end-to-end walkthrough (local provider, no commits)**

Read the five SKILL.md files in order and confirm, by tracing the steps against
a hypothetical free-form task with `provider: local`:
- Start: scaffolds config → intake free-form → `started` no-op (local) → branch →
  recommends explore/propose → writes `workflow.json` with `lastEvent: started` →
  `planned`.
- Build: reads `workflow.json` → `implementing` → apply → `review`.
- Close: drift reconcile → verify → archive (`workflow.json` carried along) →
  `done`.
- Quick: intake → implement → delta → sync-specs → archive → `done`.
Confirm no step references a file, event, or operation not defined in Tasks 1–11
(events: started/planned/implementing/review/done; ops: resolve/list_open/
set_status/create).

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "test(workflow): integration verification fixes" || echo "nothing to fix"
```

---

## Notes for the implementer

- Skills are auto-discovered; after creating them you may need to reload the
  Claude Code session for the new skills to appear in the skills list.
- The reference docs are the single source of truth for provider procedures and
  the config/event model — the stage skills intentionally stay thin and link to
  them. Keep them DRY: if a procedure changes, edit the reference, not each skill.
- `provider` procedures are instructions, not code; "verification" for them is
  the dry-run command in each provider doc, run by a human with real credentials.
