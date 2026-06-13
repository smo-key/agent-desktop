# Tasks

## 1. Durable UI-preferences store
- [x] 1.1 Add `src/lib/settings/uiPrefs.svelte.ts` — a `uiPrefs` singleton owning
      the `ui` settings slice (collapse, terminals width, tasks-launcher fraction,
      project filter, lane order), with a pure `parseUiPrefs` validator (clamps
      numbers, per-field defaults, drops non-string lane ids), `hydrate()`, and
      best-effort setters that persist via `saveSettingsSlice`.
- [x] 1.2 Unit-test `parseUiPrefs` (defaults, verbatim parse, clamping, per-field
      fallback, lane-id filtering) and the store (hydrate, fresh-install defaults,
      slice persistence, setter clamping).

## 2. Migrate consumers off localStorage
- [x] 2.1 `projectFilter.svelte.ts` → façade over `uiPrefs.data.projectFilter`
      (public `selected` / `select` unchanged).
- [x] 2.2 `tasks/panel.svelte.ts` → terminals `width` / `setWidth` delegate to
      `uiPrefs` (clamp bounds moved into `uiPrefs`); `open`/`toggle` stay in-memory.
- [x] 2.3 `overview/Inbox.svelte` → project-pane collapse, tasks-launcher fraction,
      and lane order read/write through `uiPrefs`; gate lane reconciliation until
      the saved order hydrates so it isn't overwritten by mount order.
- [x] 2.4 `routes/+page.svelte` → `uiPrefs.hydrate()` once on mount.

## 3. Guardrail
- [x] 3.1 Add `tools/check-localstorage.mjs` — fail when a file outside the
      regenerable-cache allowlist (titles / summaries / costs) accesses
      `localStorage`.
- [x] 3.2 Wire the gate into `.githooks/pre-commit` and `package.json`
      (`lint:storage`, added to `check:gate`).

## 4. Verify
- [x] 4.1 `npm run check` (svelte-check) passes.
- [x] 4.2 `npm run test` (vitest) passes.
- [x] 4.3 `node tools/check-localstorage.mjs` passes on the tree and fails on a
      planted violation.
