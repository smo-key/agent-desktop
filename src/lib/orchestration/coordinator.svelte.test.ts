import { describe, expect, it, vi, beforeEach } from 'vitest';

// `startCoordinator` runtime-wiring tests (coordinator-lifecycle). Named
// `*.svelte.test.ts` so vitest compiles the runes the workspace singleton touches.
// We drive the SINGLETONS the wiring imports (`workspace`, `projects`, `getUsagePaths`)
// through mocks: a REAL `WorkspaceStore` backs `workspace` (so `allCoordinatorPanes`
// enumerates real tree/registry panes) with its mutating methods spied, while
// `getUsagePaths` THROWS if ever reached — proving the archived-restore branch
// short-circuits BEFORE any toolkit-path resolution (no toolkit mocks needed).

// `getUsagePaths` must never run on the restore path — make it explode if it does.
const getUsagePaths = vi.fn(async () => {
  throw new Error('getUsagePaths must NOT be reached on the archived-restore path');
});
// `projects.update` is a spy so we can assert the back-reference is repointed.
const projectsUpdate = vi.fn(async (_id: string, _patch: Record<string, unknown>) => {});

// The `workspace` singleton is a REAL WorkspaceStore (built from the unmocked class via
// importOriginal) so the pure helpers enumerate real tree/registry panes; its mutating
// methods are spied per-test. We expose the instance so the test seeds/asserts the same one.
vi.mock('../layout/workspace.svelte', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../layout/workspace.svelte')>();
  return { workspace: new actual.WorkspaceStore() };
});
vi.mock('../usage/paths', () => ({ getUsagePaths: () => getUsagePaths() }));
vi.mock('../projects/projects.svelte', () => ({
  projects: {
    update: (id: string, patch: Record<string, unknown>) => projectsUpdate(id, patch)
  }
}));
vi.mock('../ui/toastStore.svelte', () => ({ toast: { show: vi.fn() } }));

import { workspace } from '../layout/workspace.svelte';
import { leavesInOrder } from '../layout/tree';
import { startCoordinator } from './coordinator.svelte';
import type { Project } from '../projects/projects';

/** A minimal Project the wiring reads (id + path). */
function project(id = 'proj-A'): Project {
  return { id, name: id, path: '/proj' } as Project;
}

/** Seed a LIVE coordinator pane for `projectId` into the store; returns its id. */
function seedCoordinator(projectId = 'proj-A'): string {
  const wsId = workspace.newWorkspace(
    'claude',
    '/proj',
    undefined,
    projectId,
    undefined,
    undefined,
    'coordinator'
  );
  const entry = workspace.workspaces.find((w) => w.id === wsId)!;
  return leavesInOrder(entry.ws.root)[0].paneId;
}

describe('startCoordinator — restores an archived coordinator instead of spawning', () => {
  beforeEach(() => {
    // Fresh state each test: empty the singleton store + reset spies.
    workspace.workspaces = [];
    workspace.activeWorkspaceId = '';
    getUsagePaths.mockClear();
    projectsUpdate.mockClear();
    vi.restoreAllMocks();
  });

  it('RESTORES the archived coordinator (no new pane, no toolkit resolution)', async () => {
    const archivedId = seedCoordinator('proj-A');
    workspace.closeAgent(archivedId); // archive it (closed:true, retained)

    const restoreSpy = vi.spyOn(workspace, 'restoreAgent');
    const focusSpy = vi.spyOn(workspace, 'focusPane');
    const launchSpy = vi.spyOn(workspace, 'launch');

    const result = await startCoordinator(project('proj-A'));

    // It returned the ARCHIVED pane's id — Start reused it, never spawned a new one.
    expect(result).toBe(archivedId);
    // Restored + focused the archived coordinator.
    expect(restoreSpy).toHaveBeenCalledWith(archivedId);
    expect(focusSpy).toHaveBeenCalledWith(archivedId);
    // NO new pane launched → at most one coordinator for the project.
    expect(launchSpy).not.toHaveBeenCalled();
    // Short-circuited BEFORE toolkit-path resolution (the throwing mock never ran).
    expect(getUsagePaths).not.toHaveBeenCalled();
    // Back-reference repointed to the restored coordinator.
    expect(projectsUpdate).toHaveBeenCalledWith('proj-A', { coordinatorPaneId: archivedId });
    // The restored pane is now LIVE (closed cleared, resume set).
    expect(workspace.session(archivedId).closed).toBe(false);
    expect(workspace.session(archivedId).resume).toBe(true);
  });

  it('reuses a LIVE coordinator before considering the archived one', async () => {
    const liveId = seedCoordinator('proj-A');

    const restoreSpy = vi.spyOn(workspace, 'restoreAgent');
    const focusSpy = vi.spyOn(workspace, 'focusPane');
    const launchSpy = vi.spyOn(workspace, 'launch');

    const result = await startCoordinator(project('proj-A'));

    // The live gate wins; nothing is restored or launched.
    expect(result).toBe(liveId);
    expect(focusSpy).toHaveBeenCalledWith(liveId);
    expect(restoreSpy).not.toHaveBeenCalled();
    expect(launchSpy).not.toHaveBeenCalled();
    expect(getUsagePaths).not.toHaveBeenCalled();
  });
});
