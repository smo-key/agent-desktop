# Tasks

- [x] 1.1 Add `src/lib/settings/sessionGrouping.svelte.ts` (`GROUPING_MODES`,
      `parseSessionGroupingPrefs`, `SessionGroupingStore` with `load`/`setMode`,
      merge-aware save) plus `sessionGrouping.test.ts`; load it on mount in
      `+page.svelte`.
- [x] 1.2 Add the pure `src/lib/overview/grouping.ts` (`dateBucketFor`,
      `buildRosterGroups`) plus `grouping.test.ts` covering every spec scenario.
- [x] 1.3 Add the "Group by" dropdown (Status / Date / None) to the Sessions
      panel section of `SettingsModal.svelte`.
- [x] 1.4 Rewire `Inbox.svelte` to render from `buildRosterGroups` (pinned first,
      archived last with preview/Show-all/Delete-all intact, headerless flat
      body for None) and derive `viewRows` from the groups.
- [x] 1.5 `yarn check`, `yarn test`, and `yarn coverage` green; commit.
