// PURE, framework-free model for PROJECTS (a project = a working folder you run
// agents in, with a human-readable name + color + icon). Mirrors the launcher's
// recents model: no Svelte/Tauri/DOM imports, so it runs under the default (node)
// Vitest environment and is unit-tested in full. The reactive `projects` runes
// store (projects.svelte.ts) is a thin wrapper that runs these helpers over
// `$state` and persists the result via the Rust `projects_load`/`projects_save`
// commands — the SAME atomic tmp+rename mechanism as `recents_load`/`recents_save`,
// against a sibling `projects.json` file.
//
// A project's identity (icon + color) becomes the agent's avatar, so the fleet
// reads by project at a glance. The binding is EXPLICIT: a pane's `projectId` is
// recorded at launch (see workspace/plan/persistence) — never inferred.

/** The on-disk schema version for the persisted projects envelope. */
export const PROJECTS_VERSION = 1 as const;

/** A project: a working folder with a human-readable identity. */
export interface Project {
  /** Stable unique id (the registry's `projectId` references this). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Absolute folder path agents launch into. */
  path: string;
  /** Icon name (a key of the vendored project-icon set). */
  icon: string;
  /** Accent color (hex, e.g. `#4C8DFF`). */
  color: string;
}

/** The top-level persisted envelope written to `projects.json`. */
export interface PersistedProjects {
  version: typeof PROJECTS_VERSION;
  projects: Project[];
}

/** Icon + color choices offered when creating a project (the create picker). */
export const PROJECT_ICON_CHOICES: ReadonlyArray<{ icon: string; color: string }> = [
  { icon: 'credit-card', color: '#4C8DFF' },
  { icon: 'shopping-bag', color: '#3CCB7F' },
  { icon: 'globe', color: '#36C2C2' },
  { icon: 'book-open', color: '#F0B341' },
  { icon: 'server', color: '#B98AE6' },
  { icon: 'box', color: '#E0739E' },
  { icon: 'cpu', color: '#7FBF4F' },
  { icon: 'rocket', color: '#5EC8E0' },
  { icon: 'database', color: '#F0844F' },
  { icon: 'compass', color: '#4CC2A8' },
  { icon: 'smartphone', color: '#E8B84B' },
  { icon: 'bot', color: '#6FA0F0' }
];

/** Fallback icon/color cycled through when a project is created without a pick. */
export const PROJECT_PALETTE = PROJECT_ICON_CHOICES;

/** The default identity for a project created with no explicit icon/color. */
export function paletteEntry(index: number): { icon: string; color: string } {
  const n = PROJECT_PALETTE.length;
  return PROJECT_PALETTE[((index % n) + n) % n];
}

/** `rgba(...)` form of a `#rrggbb` hex at alpha `a` (for tinted backgrounds). */
export function hexA(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(typeof hex === 'string' ? hex.trim() : '');
  if (!m) return `rgba(125, 132, 153, ${a})`; // fall back to a neutral grey
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/**
 * Black (`#06080c`) or white (`#ffffff`) — whichever reads more clearly as
 * text/icons drawn ON the solid color `hex`. Uses perceived sRGB luminance; an
 * unparseable hex falls back to white. Used by the footer's project chip, whose
 * background is the project's full color.
 */
export function contrastText(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(typeof hex === 'string' ? hex.trim() : '');
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 150 ? '#06080c' : '#ffffff';
}

/** Lowercase kebab slug of a name (for ids / display), or '' when empty. */
export function slugify(name: string): string {
  return (typeof name === 'string' ? name : '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The display name for a project: its name, else its folder basename, else id. */
export function projectLabel(p: Project): string {
  const name = p.name.trim();
  if (name) return name;
  const base = p.path.replace(/[/\\]+$/, '').split(/[/\\]/).pop();
  return base && base.length > 0 ? base : p.id;
}

/**
 * Add `project` to the front of `list` as the most-recent project.
 *
 *  - DEDUPE by PATH: an existing project with the same `path` is replaced (its
 *    id is kept so existing panes stay bound), moved to the head with the new
 *    name/icon/color. Re-launching a folder never creates a duplicate project.
 *  - ORDER: most-recent first.
 *
 * A blank path is ignored (list returned unchanged). Pure: never mutates inputs.
 */
export function addProject(list: ReadonlyArray<Project>, project: Project): Project[] {
  const path = typeof project.path === 'string' ? project.path.trim() : '';
  if (!path) return [...list];
  const existing = list.find((p) => p.path === path);
  const merged: Project = { ...project, path, id: existing ? existing.id : project.id };
  const rest = list.filter((p) => p.path !== path);
  return [merged, ...rest];
}

/** Remove the project with id `id` (pure; returns a new list, no-op if absent). */
export function removeProject(list: ReadonlyArray<Project>, id: string): Project[] {
  return list.filter((p) => p.id !== id);
}

/** The project with id `id`, or null. */
export function projectForId(
  list: ReadonlyArray<Project>,
  id: string | null | undefined
): Project | null {
  if (!id) return null;
  return list.find((p) => p.id === id) ?? null;
}

/** The project whose folder equals `path` (exact match), or null. */
export function projectForPath(
  list: ReadonlyArray<Project>,
  path: string | null | undefined
): Project | null {
  if (!path) return null;
  const t = path.trim();
  return list.find((p) => p.path === t) ?? null;
}

/** Whether `project` is a well-formed Project record. */
function isProject(value: unknown): value is Project {
  if (value === null || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === 'string' &&
    p.id.trim() !== '' &&
    typeof p.name === 'string' &&
    typeof p.path === 'string' &&
    p.path.trim() !== '' &&
    typeof p.icon === 'string' &&
    typeof p.color === 'string'
  );
}

/** Keep only valid Projects, dedupe by path (first wins), preserving order. */
function normalize(arr: ReadonlyArray<unknown>): Project[] {
  const out: Project[] = [];
  const seen = new Set<string>();
  for (const item of arr) {
    if (!isProject(item)) continue;
    const path = item.path.trim();
    if (seen.has(path)) continue;
    seen.add(path);
    out.push({ ...item, path });
  }
  return out;
}

/**
 * Parse the persisted projects JSON (or `null`/empty for "no file") into a clean
 * list. Accepts either a bare array or the `{ version, projects: [...] }`
 * envelope. ANY failure collapses to an empty list — NEVER throws.
 */
export function parseProjects(raw: string | null | undefined): Project[] {
  try {
    if (raw == null || raw.trim() === '') return [];
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return normalize(parsed);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as { projects?: unknown }).projects)
    ) {
      return normalize((parsed as { projects: unknown[] }).projects);
    }
    return [];
  } catch {
    return [];
  }
}

/** Serialize a project list into the persisted `{ version, projects }` envelope. */
export function serializeProjects(list: ReadonlyArray<Project>): string {
  const envelope: PersistedProjects = {
    version: PROJECTS_VERSION,
    projects: [...list]
  };
  return JSON.stringify(envelope);
}
