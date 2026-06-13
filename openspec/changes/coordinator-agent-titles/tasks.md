## 1. Identify agents by their generated session title

- [x] 1.1 Extend `src/lib/orchestration/executor.svelte.test.ts`: `list_agents` and `inspect_agent` return an agent's generated session title (via an injected `titleOf`) as its `name`; when `titleOf` returns null they fall back to the workspace/cwd name (existing behavior).
- [x] 1.2 Add `titleOf: (paneId: string) => string | null` to `ExecutorDeps`; in `infoFor` use `this.deps.titleOf(pane.paneId) ?? nameFor(pane)`. Make 1.1 pass.
- [x] 1.3 Wire the real binding in `realDeps()` to the title store (`titleOf: (paneId) => titles.titleFor(paneId)`), importing the `titles` singleton.
- [x] 1.4 Run `npm run check:gate` and fix any failures.
</content>
