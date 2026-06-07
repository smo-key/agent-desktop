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
