// Reactive runes store for the PROJECTS list. A thin wrapper over the PURE
// `projects.ts` model: it holds the list in `$state`, runs `addProject`/
// `parseProjects`/`serializeProjects` over it, and persists via the Rust
// `projects_load`/`projects_save` commands.
//
// PERSISTENCE CHOICE (documented): projects are stored in a SIBLING `projects.json`
// under the same app-data dir as `layout.json`/`recents.json`, written through
// dedicated `projects_load`/`projects_save` Tauri commands that use the SAME atomic
// tmp+rename mechanism as `recents_save` — a tiny, immediate flush on each create,
// independent of the (debounced) layout envelope. The pure model (dedupe/parse) is
// unit-tested in projects.test.ts; this file is the (headless-untestable) wiring.

import { invoke } from '@tauri-apps/api/core';
import {
  addProject,
  removeProject,
  updateProject,
  parseProjects,
  serializeProjects,
  type Project
} from './projects';

/** The reactive projects store. A single instance is exported below. */
export class ProjectsStore {
  /** Projects, most-recent first. Deep-reactive via the runes proxy. */
  list = $state<Project[]>([]);

  /** True once `load()` has resolved (so the UI can distinguish empty vs unloaded). */
  loaded = $state(false);

  /**
   * Load the persisted projects from `projects.json` and seed the store. On ANY
   * failure (no file, bad JSON, non-Tauri context) the list stays empty — this
   * never throws. Call once on mount.
   */
  async load(): Promise<void> {
    let raw: string | null = null;
    try {
      raw = await invoke<string | null>('projects_load');
    } catch (err) {
      console.error('projects_load failed', err);
      raw = null;
    }
    this.list = parseProjects(raw);
    this.loaded = true;
  }

  /**
   * Record (or update) `project` at the head of the list (dedupe by folder) and
   * persist. Called when a session is launched under a new/updated project.
   * Returns the stored project (with the id the model resolved — an existing
   * folder keeps its original id so bound panes stay valid).
   */
  async add(project: Project): Promise<Project> {
    const next = addProject(this.list, project);
    this.list = next;
    await this.save();
    return next[0] ?? project;
  }

  /**
   * Patch the project with id `id` (the edit flow) and persist. Keeps the id and
   * list position; a `logo: undefined` patch removes the logo. No-op if absent.
   */
  async update(id: string, patch: Partial<Omit<Project, 'id'>>): Promise<void> {
    this.list = updateProject(this.list, id, patch);
    await this.save();
  }

  /** Remove the project with id `id` and persist (best-effort). No-op if absent. */
  async remove(id: string): Promise<void> {
    const next = removeProject(this.list, id);
    if (next.length === this.list.length) return; // nothing removed
    this.list = next;
    await this.save();
  }

  /** Persist the current list via the Rust `projects_save` command (best-effort). */
  private async save(): Promise<void> {
    try {
      await invoke('projects_save', { json: serializeProjects(this.list) });
    } catch (err) {
      console.error('projects_save failed', err);
    }
  }
}

/** The singleton projects store, imported by the launcher + project panel. */
export const projects = new ProjectsStore();
