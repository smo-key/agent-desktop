# Workflow config — `.claude/workflow.yaml`

Per-repo, version-controlled. Every workflow skill loads this first. If it is
missing, the skill scaffolds the **Default** below (writing the file) and tells
the user, then continues with `provider: local`.

## Schema

```yaml
provider: github            # local | github | jira  (required)
branchPerTask: true         # create a git branch when Start/Quick begins (default: true)
worktreePerTask: false      # run each task in its own git worktree, merged back when complete (default: false)
worktreeMergeAt: archive    # when worktreePerTask: merge the task branch back at `archive` (after Done) or `build` (when implementation completes). default: archive

github:                     # required when provider: github
  project: "owner/repo"     # repo for issues; project resolved via `gh project` for that owner
  requirementsField: ""     # optional: a Projects (v2) text field for the workflow-define brief; default is the issue body
jira:                       # required when provider: jira
  baseUrl: https://acme.atlassian.net
  projectKey: PROJ
  requirementsField: ""     # optional: a custom field id (e.g. customfield_10042) for the workflow-define brief; default is the description
  # auth read from env: JIRA_EMAIL, JIRA_API_TOKEN

# Map workflow lifecycle events -> the EXACT provider status name.
# Omit any event to make that transition a no-op.
statuses:
  started:      "In Progress"
  refined:      "Ready for Dev"   # workflow-define: requirements drafted, awaiting a developer
  planned:      "In Progress"
  implementing: "In Progress"
  review:       "In Review"
  done:         "Done"
```

## Fields

- `provider` — which tracker integration to use. `local` needs no other config.
- `branchPerTask` — when true, Start/Quick create a git branch named after the
  change (e.g. `git switch -c <change-name>`) before discovery/implementation.
- `worktreePerTask` — when true, each task runs in its own git worktree (on a
  branch named after the change) instead of switching branches in place, and is
  merged back into the branch you started from when complete. This supersedes
  `branchPerTask`'s in-place switch — the worktree carries the task branch. See
  `../worktrees.md` for the create/merge mechanics.
- `worktreeMergeAt` — only meaningful when `worktreePerTask` is true. `archive`
  (default) merges the task branch back at the end of `workflow-done`, after the
  change is verified and archived — the safest path, since a failing review
  blocks the merge. `build` merges as soon as `workflow-build` finishes
  implementation, for projects where testing the change requires it merged first.
- `github.project` — `owner/repo`. Issues are read/created here; the org/user
  Project (v2) board is discovered from that owner for status edits.
- `github.requirementsField` / `jira.requirementsField` — optional. Where
  `workflow-define` writes its requirements brief via `set_requirements`. Leave
  empty to use the item's main body (GitHub issue body / Jira description);
  set it to target a dedicated field instead.
- `jira.baseUrl` / `jira.projectKey` — Jira site and project. Credentials come
  from the `JIRA_EMAIL` and `JIRA_API_TOKEN` environment variables, never the file.
- `statuses` — maps each lifecycle event (see `../providers.md`) to the literal
  status string the provider expects. Trackers with a coarse To Do/Doing/Done
  flow can omit `refined`/`planned`/`review` (those transitions become no-ops).

## Lifecycle events

| Event          | Emitted by                                          |
|----------------|-----------------------------------------------------|
| `started`      | `workflow-start` / `workflow-quick` at intake (including picking up a `refined` item) |
| `refined`      | `workflow-define` once the requirements brief is emitted |
| `planned`      | `workflow-start` once the change is apply-ready     |
| `implementing` | `workflow-build` at start                           |
| `review`       | `workflow-build` after tasks complete               |
| `done`         | `workflow-done` / `workflow-quick` after archive    |

## Default (scaffolded when the file is absent)

```yaml
provider: local
branchPerTask: true
worktreePerTask: false
worktreeMergeAt: archive
statuses:
  started:      "In Progress"
  refined:      "Ready for Dev"
  planned:      "In Progress"
  implementing: "In Progress"
  review:       "In Review"
  done:         "Done"
```

When scaffolding, write exactly the block above to `.claude/workflow.yaml` and
tell the user: "No `.claude/workflow.yaml` found — created a default using the
`local` provider (no external tracker). Edit it to point at GitHub or Jira."
