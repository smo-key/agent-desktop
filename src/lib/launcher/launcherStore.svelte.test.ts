import { describe, expect, it } from 'vitest';
import { LauncherStore } from './launcherStore.svelte';

// The launcher store's PRESET is how the new-worktree-session shortcut opens the
// modal "with the worktree option checked and the filtered project preselected"
// (session-launcher: Launch A Session In A New Git Worktree). The modal's form
// seeding from these fields is DOM-bound and confirmed live; this pins the store.

describe('launcher store preset', () => {
  it('Shortcut opens the launcher with the worktree option preset', () => {
    const s = new LauncherStore();
    expect(s.open).toBe(false);
    s.show({ worktree: true, projectId: 'p1' });
    expect(s.open).toBe(true);
    expect(s.presetWorktree).toBe(true);
    expect(s.presetProjectId).toBe('p1');
    // Closing clears the preset so the next plain open starts clean.
    s.close();
    expect(s.open).toBe(false);
    expect(s.presetWorktree).toBe(false);
    expect(s.presetProjectId).toBeNull();
    // A plain show() carries no preset.
    s.show();
    expect(s.presetWorktree).toBe(false);
    expect(s.presetProjectId).toBeNull();
    // toggle() closes an open launcher and opens a closed one.
    s.toggle();
    expect(s.open).toBe(false);
    s.toggle();
    expect(s.open).toBe(true);
  });
});
