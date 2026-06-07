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
