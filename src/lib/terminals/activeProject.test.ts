import { describe, expect, it } from 'vitest';
import { activeProjectId, activeProject, type FocusContext } from './activeProject';
import type { Project } from '../projects/projects';

// Tests for the PURE active-project resolver (terminals-panel capability). The
// `it(...)` titles match the panel's project-scoping `#### Scenario:` names where a
// scenario is headless-testable.

function ctx(over: Partial<FocusContext> = {}): FocusContext {
  return {
    focusedId: 'pane-1',
    projectIdOf: () => 'web-app',
    ...over
  };
}

const PROJECTS: Project[] = [
  { id: 'web-app', name: 'Web App', path: '/web', icon: 'globe', color: '#000' },
  { id: 'api', name: 'API', path: '/api', icon: 'server', color: '#111' }
];

describe('terminals-panel — project scoping', () => {
  it('Panel shows the focused projects terminals', () => {
    expect(activeProjectId(ctx({ projectIdOf: () => 'web-app' }))).toBe('web-app');
  });

  it('Changing focus swaps the visible collection', () => {
    // The resolver reflects whatever the focused pane resolves to.
    const focusWeb = ctx({ focusedId: 'a', projectIdOf: (id) => (id === 'a' ? 'web-app' : 'api') });
    const focusApi = ctx({ focusedId: 'b', projectIdOf: (id) => (id === 'a' ? 'web-app' : 'api') });
    expect(activeProjectId(focusWeb)).toBe('web-app');
    expect(activeProjectId(focusApi)).toBe('api');
  });

  it('No project shows an empty state', () => {
    // No pane focused and nothing selected → null.
    expect(activeProjectId(ctx({ focusedId: '' }))).toBeNull();
    // Focused pane with no project binding and nothing selected → null.
    expect(activeProjectId(ctx({ projectIdOf: () => undefined }))).toBeNull();
  });

  it('Selected project is respected without a focused agent', () => {
    // A concrete filter selection drives the panel even with no agent focused.
    expect(activeProjectId(ctx({ focusedId: '', selectedProjectId: 'api' }))).toBe('api');
    // And even when the focused pane has no project of its own.
    expect(
      activeProjectId(ctx({ projectIdOf: () => undefined, selectedProjectId: 'api' }))
    ).toBe('api');
  });

  it('Selected project takes precedence over the focused agents project', () => {
    expect(
      activeProjectId(ctx({ projectIdOf: () => 'web-app', selectedProjectId: 'api' }))
    ).toBe('api');
  });

  it('falls back to focus when no concrete project is selected', () => {
    // null selection (All / Unassigned) → follow focus.
    expect(activeProjectId(ctx({ projectIdOf: () => 'web-app', selectedProjectId: null }))).toBe(
      'web-app'
    );
  });

  it('resolves the active project object from the list', () => {
    expect(activeProject(PROJECTS, ctx({ projectIdOf: () => 'api' }))?.name).toBe('API');
    expect(activeProject(PROJECTS, ctx({ focusedId: '' }))).toBeNull();
  });
});
