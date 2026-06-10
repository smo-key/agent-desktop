# Add "delete all archived agents" (with confirmation)

## Why

Archived agents accumulate in the overview's Archived lane with no way to clear
them in bulk — only one-by-one via the row context menu. A user who has archived
many sessions wants to wipe them all at once, but because deletion is permanent it
must be guarded by a confirmation.

## What changes

- Add a **"Delete all"** action to the overview's **Archived** lane header, shown
  only when at least one agent is archived.
- Activating it opens a **confirmation dialog** (a new reusable in-app modal that
  matches the Settings/Help modal style) naming how many archived agents will be
  removed and warning the action is permanent. Only on confirm are they deleted;
  cancel/Esc/backdrop leaves them untouched.
- On confirm, every agent in the Archived lane is permanently removed via the same
  path as the existing single delete (`workspace.deleteAgent`), and the selection is
  cleared if it pointed at a deleted pane.

## Spec note

This extends the `agent-overview` capability, which is still owned by the active
`add-agent-desktop` change (not yet in `openspec/specs/`). This change is therefore
kept ACTIVE (not synced/archived) so the requirement promotes into the durable
`agent-overview` spec alongside that capability rather than fragmenting it early.

## Impact

- Affected specs: `agent-overview` (new "Delete All Archived Agents" requirement)
- Affected code: `src/lib/ui/confirmStore.svelte.ts` (new, reusable confirm store),
  `src/lib/ui/ConfirmModal.svelte` (new, styled confirm modal),
  `src/routes/+page.svelte` (mount the modal),
  `src/lib/overview/roster.ts` (`archivedPaneIds` selector),
  `src/lib/overview/Inbox.svelte` (the lane-header action + handler).
