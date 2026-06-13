## Why

The coordinator's toolkit (`list_agents` / `inspect_agent`) reports each agent by
its raw workspace name — the auto-assigned `"Session N"` — because `nameFor` reads
only the workspace registry and never the generated session title. The app already
generates a short focus title per session (e.g. "Fix login dialog") and shows it on
every agent card, but the coordinator sees `"Session 1"`, `"Session 2"`, … . That
makes the coordinator's view of its fleet hard to follow and its messages to the
user opaque: it can only refer to agents by a meaningless ordinal.

## What Changes

- The orchestration toolkit SHALL identify an agent by its **generated session
  title** when one is available, falling back to the workspace/cwd display name
  otherwise — so `list_agents` / `inspect_agent` return `"Fix login dialog"` rather
  than `"Session 1"`, matching the label on the agent's card.
- Plumb the title lookup through the executor's dependency injection (a new
  `titleOf(paneId)` dep bound to the title store) rather than reaching into a
  singleton, keeping the executor unit-testable.

## Capabilities

### Modified Capabilities
- `agent-orchestration-runtime`: the agent identity returned by `list_agents` /
  `inspect_agent` uses the generated session title when available (was: the raw
  workspace name only).

## Impact

- **Modified frontend**: `src/lib/orchestration/executor.svelte.ts` (`ExecutorDeps`
  gains `titleOf`; `infoFor` prefers it over `nameFor`; real bindings wire it to the
  `titles` store), `src/lib/orchestration/executor.svelte.test.ts` (fake `titleOf`).
- **No backend / protocol changes**: the `AgentInfo` shape is unchanged; only the
  value of its `name` field improves.
</content>
</invoke>
