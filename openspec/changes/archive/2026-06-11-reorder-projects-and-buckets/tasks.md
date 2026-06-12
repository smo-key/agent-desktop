# Tasks

## 1. Pure models (TDD)

- [x] 1.1 Add `reorderProjects(list, fromId, toId)` to `projects.ts` (standard
      array-move keyed by id; no-op copy for unknown/same id) + unit test.
- [x] 1.2 Add `reorderLane(prev, present)` to `roster.ts` — newest-to-top,
      preserving the established/manual order and dropping departed ids + unit test.
- [x] 1.3 Add `moveId(order, fromId, toId)` (lane drag-move) and
      `orderRowsByLane(rows, laneOrder)` (lane-group + within-lane order) to
      `roster.ts` + unit tests.

## 2. Project drag-reorder

- [x] 2.1 Add `projects.reorder(fromId, toId)` store method (reorderProjects +
      persist, no-op when unchanged).
- [x] 2.2 Make the expanded project rows draggable in `ProjectPanel.svelte`
      (dragstart/over/drop/end) with a drop-target highlight; call `projects.reorder`.

## 3. Bucket ordering + drag-reorder

- [x] 3.1 Replace the `queueOrder` append-earliest mechanism in `Inbox.svelte` with
      a per-lane `laneOrder` map maintained via `reorderLane` over the unfiltered
      roster; drive `viewRows` via `orderRowsByLane` and drop the manual `done`
      reverse.
- [x] 3.2 Persist the Needs-you (attn) + Paused manual orders to localStorage;
      re-derive In-flight / Archived newest-first each session.
- [x] 3.3 Make the Needs-you / Paused rows draggable (same-lane only, never the
      pinned coordinator); on drop, `moveId` the lane order and persist.

## 4. Verify

- [x] 4.1 `npm run check` (svelte-check) and `npm test` green.
- [ ] 4.2 Manual: drag a project; drag a Needs-you and a Paused agent; confirm the
      order survives restart, and that a newly-waiting agent appears at the top.
