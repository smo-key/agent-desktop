# Tasks — projects-panel-working-indicator

## 1. Working predicate + rollup flag (TS)
- [x] 1.1 `roster.ts`: add a pure `isWorking(row)` predicate — `status === 'working'` and not paused/closed/preview (+ tests in `roster.test.ts`)
- [x] 1.2 `projectRollup.ts`: add a `working` flag to `ProjectCount` computed as `mine.some(isWorking)`; update the module/interface docs (+ tests in `projectRollup.test.ts`)

## 2. Render the working indicator (Svelte — `ProjectPanel.svelte`)
- [x] 2.1 Collapsed rail: render `.pp-rail-work` in an `{:else if c.working}` branch after `c.attn`
- [x] 2.2 Expanded row: render `.pp-work` in an `{:else if c.working}` branch after `c.attn`
- [x] 2.3 CSS: blue, flashing dots (`pp-flash` keyframes) for both, reusing the inbox flightflash look; honor `prefers-reduced-motion`

## 3. Close-out
- [x] 3.1 `openspec validate projects-panel-working-indicator`, `npm test`, and `npm run check` (for the changed files) pass
- [x] 3.2 Adversarial code review (no findings), verify, sync spec delta into `openspec/specs/`, archive
