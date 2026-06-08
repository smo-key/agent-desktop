# Provider contract

A "provider" is a documented procedure (in `providers/<name>.md`) for four
operations. There is no provider code — follow the matching doc using the tools
named there. Select the provider from `provider:` in `.claude/workflow.yaml`
(see `config.md`).

## Operations

| Operation                     | Returns / effect                                   |
|-------------------------------|----------------------------------------------------|
| `resolve(ref)`                | `{ title, description, status, url }` for a task    |
| `list_open()`                 | A list of `{ ref, title, status }` for open tasks   |
| `set_status(ref, st)`         | Transition the task to status string `st`           |
| `create(title, desc)`         | File a new task; returns `{ ref, url }`             |
| `set_requirements(ref, text)` | Write a requirements brief into the task's field    |

Each provider doc gives the exact command(s) for each operation.

`set_requirements` is used only by `workflow-define`: it writes the BA's brief to
the work item's requirements field — the item body by default, or the configured
`requirementsField` (see `config.md`). It is the write half of the requirements
handoff; `workflow-start` reads the brief back via `resolve(ref).description` (or
that same custom field) when a developer picks the item up. For `local` it is a
no-op — `workflow-define` prints the brief to the terminal instead.

## Emitting a lifecycle event

Skills never hardcode a status string. To emit event `E` for the active task:

1. Read `statuses.E` from `.claude/workflow.yaml`.
2. If absent/empty → **no-op** (do nothing; the tracker has no matching status).
3. Otherwise call the provider's `set_status(taskRef, statuses.E)`.
4. Update `lastEvent` in `workflow.json` (see `linkage.md`).

The events are: `started`, `refined`, `planned`, `implementing`, `review`,
`done` (see `config.md`).

## Intake (used by Start / Quick / Define)

Given the user's input:

- A provider-native ref or task URL → `resolve(ref)`; use its title/description
  to seed the OpenSpec change — and, when the item is `refined`, to read the
  requirements brief the BA wrote so `workflow-start` plans from it.
- Free-form text → use it directly as the task description. If the config
  provider is not `local`, offer to `create(title, desc)` so the work is tracked;
  if the user declines, proceed untracked (treat as `local` for status ops).
  `workflow-define` needs a work item to write the brief into, so it offers
  `create` even for a stub.
- Nothing → `list_open()` and let the user pick one. `workflow-start` surfaces
  items in the `refined` ("Ready for Dev") status here too — those carry a BA's
  requirements brief.

## Errors

If a provider command fails (missing `gh` auth, missing `JIRA_*` env, network),
report the failure and ask whether to continue **untracked** (skip status
updates) or stop. Never block the actual development work on a tracker error.
