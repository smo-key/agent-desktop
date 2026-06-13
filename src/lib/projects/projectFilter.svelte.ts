// A tiny reactive latch for the project-panel SELECTION, shared by both overviews
// (the card Overview and the terminal-windows view) so switching surfaces keeps
// the same filter. Mirrors `view`/`launcher` singletons. The pure filtering math
// lives in `projectRollup.ts` (`filterRowsByProject`); this just holds the choice.

import { ALL, type ProjectFilter } from './projectRollup';
import { uiPrefs } from '../settings/uiPrefs.svelte';

// The last selection is remembered across app restarts via the durable `ui`
// settings slice (NOT localStorage, which WKWebView drops on an abrupt restart),
// so the window reopens on the project you were last looking at. This store is a
// thin façade over `uiPrefs.data.projectFilter`.

/** The reactive project-filter store. A single instance is exported below. */
export class ProjectFilterStore {
  /** The current selection: ALL, UNASSIGNED, or a concrete project id. Read from
   *  the durable prefs so the window reopens on the last-used project. */
  get selected(): ProjectFilter {
    return (uiPrefs.data.projectFilter as ProjectFilter) ?? ALL;
  }

  /** Select a project filter (the panel rows call this); persists the choice. */
  select(value: ProjectFilter): void {
    uiPrefs.setProjectFilter(value);
  }
}

/** The singleton project-filter store, shared by both overviews + the panel. */
export const projectFilter = new ProjectFilterStore();
