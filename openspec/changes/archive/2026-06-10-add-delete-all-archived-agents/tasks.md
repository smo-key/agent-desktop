# Tasks

## 1. Reusable confirmation modal

- [x] 1.1 Add `src/lib/ui/confirmStore.svelte.ts` (generic `confirmModal` singleton:
  `show({title,message,confirmLabel?,onConfirm})`, `confirm()`, `close()`); unit-test it.
- [x] 1.2 Add `src/lib/ui/ConfirmModal.svelte` (styled modal matching Settings/Help:
  Cancel + danger confirm, Esc/backdrop/× cancel); mount it in `+page.svelte`.

## 2. Delete-all action

- [x] 2.1 Add pure `archivedPaneIds(rows)` to `roster.ts` (done-lane paneIds);
  unit-test it.
- [x] 2.2 Add a "Delete all" action to the Archived lane header in `Inbox.svelte`
  (shown only for that lane) wired to `deleteAllArchived()`, which opens the confirm
  modal and, on confirm, deletes each archived pane and clears a stale selection.

## 3. Verify

- [x] 3.1 `npm run check` and `npm run test` green (new confirm-store + roster tests
  pass).

## 4. Spec promotion (deferred)

- [x] 4.1 When the `agent-overview` capability is promoted to `openspec/specs/`
  (i.e. when `add-agent-desktop` archives), fold this change's delta into the durable
  spec and archive this change. Kept active until then to avoid fragmenting the
  in-flight capability. — done at close-out: `add-agent-desktop` archived 2026-06-10,
  so this change's "Delete All Archived Agents" requirement folds cleanly into the
  durable `agent-overview` spec on archive.
