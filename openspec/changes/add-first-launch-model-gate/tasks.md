# Tasks

- [x] 1.1 Add a pure display catalog to `src/lib/voice/models.ts`: `formatBytes`
  and `downloadRows(missing)` mapping registry filenames → `{ label, bytes }` rows
  + total, mirroring `models.rs`. Unit-test both.
- [ ] 1.2 Add `src/lib/onboarding/onboarding.svelte.ts`: a reactive store holding
  the model status + `dismissedThisSession`, with a pure
  `shouldShowOnboarding(status, dismissed)` and `init/refresh/dismiss` methods.
  Unit-test the pure gate + store transitions.
- [ ] 1.3 Add `src/lib/onboarding/ModelOnboarding.svelte`: the full-screen overlay
  rendering the model list/total, a Download primary action (reusing
  `ensureModels` + the `modelDownload` progress store), a Skip secondary action,
  and an error+retry state.
- [ ] 1.4 Wire `src/routes/+page.svelte`: after `voice.load()` resolves, initialize
  the onboarding check; render `<ModelOnboarding />` when the store says visible.
- [ ] 1.5 Run the vitest suite + svelte-check; confirm green.
