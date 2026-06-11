// Shared projection of the live workspace store into the framework-free inputs the
// agent roster + navigation need. Used by BOTH overviews (the card Overview and the
// terminal-windows Windows) so they stay consistent — one place maps a workspace's
// panes (and each pane's registry entry: cwd, program, projectId) into RosterPanes,
// and another maps workspaces to NavWorkspaces for click-to-navigate.

import { leavesInOrder } from '../layout/tree';
import type { WorkspaceEntry } from '../layout/workspace.svelte';
import type { RosterWorkspace } from './roster';
import type { NavWorkspace } from './navigate';

/** One RosterWorkspace per entry; each pane tagged with cwd / isApp / projectId. */
export function toRosterWorkspaces(entries: ReadonlyArray<WorkspaceEntry>): RosterWorkspace[] {
  return entries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    panes: leavesInOrder(entry.ws.root).map((leaf) => ({
      paneId: leaf.paneId,
      cwd: entry.registry[leaf.paneId]?.cwd ?? null,
      isApp: entry.registry[leaf.paneId]?.program === 'claude',
      projectId: entry.registry[leaf.paneId]?.projectId ?? null,
      specialist: entry.registry[leaf.paneId]?.specialist ?? null,
      role: entry.registry[leaf.paneId]?.role ?? null,
      coordinatorPaneId: entry.registry[leaf.paneId]?.coordinatorPaneId ?? null,
      closed: entry.registry[leaf.paneId]?.closed ?? false,
      paused: entry.registry[leaf.paneId]?.paused ?? false,
      pausedCount: entry.registry[leaf.paneId]?.pausedCount ?? null,
      preview: entry.registry[leaf.paneId]?.preview ?? false,
      previewCount: entry.registry[leaf.paneId]?.previewCount ?? null
    }))
  }));
}

/** One NavWorkspace per entry (id + root tree) for click-to-navigate. */
export function toNavWorkspaces(entries: ReadonlyArray<WorkspaceEntry>): NavWorkspace[] {
  return entries.map((entry) => ({ id: entry.id, root: entry.ws.root }));
}
