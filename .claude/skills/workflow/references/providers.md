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
