// A tiny reactive latch for the project-panel SELECTION, shared by both overviews
// (the card Overview and the terminal-windows view) so switching surfaces keeps
// the same filter. Mirrors `view`/`launcher` singletons. The pure filtering math
// lives in `projectRollup.ts` (`filterRowsByProject`); this just holds the choice.

import { ALL, type ProjectFilter } from './projectRollup';

// The last selection is remembered across app restarts via localStorage so the
// window reopens on the project you were last looking at.
const STORAGE_KEY = 'agent-desktop:project-filter';

function loadSelected(): ProjectFilter {
  if (typeof localStorage === 'undefined') return ALL;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return (v as ProjectFilter | null) ?? ALL;
  } catch {
    return ALL;
  }
}

/** The reactive project-filter store. A single instance is exported below. */
export class ProjectFilterStore {
  /** The current selection: ALL, UNASSIGNED, or a concrete project id. Seeded from
   *  the persisted choice so the window reopens on the last-used project. */
  selected = $state<ProjectFilter>(loadSelected());

  /** Select a project filter (the panel rows call this); persists the choice. */
  select(value: ProjectFilter): void {
    this.selected = value;
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, value);
      } catch {
        /* ignore quota / disabled storage */
      }
    }
  }
}

/** The singleton project-filter store, shared by both overviews + the panel. */
export const projectFilter = new ProjectFilterStore();
