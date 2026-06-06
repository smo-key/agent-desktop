# Project selector: keyboard nav, collapsed tooltips, logos & edit

**Date:** 2026-06-06
**Status:** Approved design — ready for implementation plan
**Area:** `src/lib/projects/*`, `src/lib/icons/*`, `src/lib/overview/Inbox.svelte`

## Summary

Four enhancements to the left **ProjectPanel** (the project filter shared by the
overviews — expanded list + collapsed icon rail):

1. **Keyboard nav** — `⌘⇧↑` / `⌘⇧↓` cycle the project filter up/down.
2. **Collapsed-rail tooltips** — an instant, styled flyout label per rail icon.
3. **Logos** — give a project a logo image instead of a generic glyph; the
   project's accent color is auto-extracted from the logo (still overridable).
4. **Edit a project** — right-click a project row to edit it (name, folder,
   icon, color, logo), in addition to deleting it.

The launcher dropdown (`ProjectSelect.svelte`) already has arrow-key nav and is
**out of scope** here; its create box stays glyph-only for now.

## 1. Data model — `projects.ts`

Add one optional field to `Project`:

```ts
export interface Project {
  id: string;
  name: string;
  path: string;
  icon: string;
  color: string;
  logo?: string; // a downscaled PNG data URL; renders instead of the icon glyph
}
```

- `icon` + `color` remain **required** — a project always has a glyph fallback,
  and `color` is the accent even when a logo is present. `logo` is additive and
  optional.
- `isProject` accepts an optional `logo` that is either absent or a `string`.
  Old `projects.json` files (no `logo`) stay valid. `normalize` carries `logo`
  through. **No `PROJECTS_VERSION` bump** — additive optional field.
- New pure helper, mirroring `addProject` / `removeProject`:

  ```ts
  /** Patch the project with id `id` (keeps its id; no-op if absent). Pure. */
  export function updateProject(
    list: ReadonlyArray<Project>,
    id: string,
    patch: Partial<Omit<Project, 'id'>>
  ): Project[];
  ```

  Patching `logo` to `undefined` removes the logo. Identity stays keyed by `id`
  (unlike `addProject`, which dedupes by path) so an edit never reshuffles or
  re-buckets bound panes — even when the `path` is edited.

- Store wrapper (`projects.svelte.ts`) gains:

  ```ts
  async update(id: string, patch: Partial<Omit<Project, 'id'>>): Promise<void>;
  ```

  Runs `updateProject`, assigns `this.list`, and `save()`s (best-effort, same as
  `add`/`remove`).

## 2. Logo + color extraction — `logo.ts` (new)

Split a **pure, unit-tested** color core from a thin DOM wrapper.

```ts
/** Dominant accent color of an RGBA image as `#rrggbb`. PURE + tested. */
export function dominantColor(
  data: Uint8ClampedArray, // RGBA, length = width*height*4
  width: number,
  height: number
): string;

/** Downscale a picked image file to a PNG data URL + extract its accent color.
 *  DOM/canvas wrapper (untested — exercised by running the app). */
export function processLogoFile(
  file: File | Blob
): Promise<{ dataUrl: string; color: string }>;
```

**`dominantColor` algorithm:**

- For each pixel: skip if `alpha < 125` (transparent). Convert to HSL; skip
  near-grays (`saturation < 0.15`) and extremes (`lightness < 0.1` or
  `> 0.95`) — these are backgrounds, outlines, and white/black fills.
- Quantize survivors into RGB buckets (5 bits/channel:
  `key = (r>>3)<<10 | (g>>3)<<5 | (b>>3)`), accumulating count + summed r/g/b.
- Return the most-populous bucket's **average** color, rounded, as `#rrggbb`.
- **Fallback:** if no pixel qualifies (logo is all gray/transparent), return the
  neutral `#7B8499` (the same grey used elsewhere for "no project").

**`processLogoFile`:** `createImageBitmap(file)` → draw onto an offscreen
`<canvas>` downscaled so the **longest side is 64px** (aspect preserved,
centered on a transparent canvas) → `canvas.toDataURL('image/png')` for
`dataUrl`, and `ctx.getImageData(...)` → `dominantColor` for `color`. ~64px PNG
keeps the data URL to a few KB and stays crisp at 2× on a ~34px avatar.

**File picking:** a hidden `<input type="file" accept="image/*">` triggered by
the "Add logo" button — it yields a `File` directly (no path, no Rust command,
no Tauri asset-protocol config), and we only need pixels + a data URL.

## 3. Rendering the logo — `icons/`

Wherever a project's mark is drawn, render the logo `<img>` when `logo` is set,
else the existing tinted glyph:

- `ProjectIcon.svelte` (the tinted **tile** — used by the collapsed rail and
  agent avatars) gains an optional `logo` prop. When set, it renders an
  `<img>` filling the tile (`object-fit: cover`, inheriting the tile radius)
  instead of the `<Icon>` glyph; the tinted background/border stays.
- For the **bare inline glyph** spots (expanded panel rows), render the same
  logo-or-glyph choice inline at the row's icon size (a small `<img>` at the
  glyph's dimensions when `logo` is set, else `<Icon>`), so a logo'd project
  reads consistently in the list and the rail.

## 4. Project form — create & edit — `ProjectForm.svelte` (new)

Extract ProjectPanel's inline create box into a reusable `ProjectForm` so create
and edit share one UI and one set of fields:

```ts
let { mode, initial, onSave, onCancel }: {
  mode: 'create' | 'edit';
  initial?: Project;            // prefilled fields in edit mode
  onSave: (draft: ProjectDraft) => void;  // { name, path, icon, color, logo? }
  onCancel: () => void;
} = $props();
```

The form holds `name`, `folder` (path), `icon`/`color` (the swatch picker), and
`logo` state, plus:

- **Browse folder** (existing `pickFolder`).
- **Icon/color picker** (existing `PROJECT_ICON_CHOICES`).
- **Add logo** button → hidden file input → `processLogoFile` → sets `logo` and
  auto-sets `color` to the extracted color. The icon/color swatch picker stays
  visible so the color is **auto-set but overridable**. When a logo is set, the
  form shows a small thumbnail + a **Remove logo** control (clears `logo`,
  leaves the current color and icon as-is).
- **Save** is enabled when name + folder are both non-empty (same rule in create
  and edit). Enter saves, Escape cancels.

ProjectPanel uses `ProjectForm` in two places:

- **Create:** at the bottom, in place of today's create box (`mode="create"`,
  `onSave` → `projects.add(...)` then select).
- **Edit:** rendered in place of the project's row when that row is being edited
  (`mode="edit"`, `initial` = the project, `onSave` → `projects.update(id, ...)`).

## 5. Context menu — `ProjectPanel.svelte`

The right-click menu on a project row gains an **Edit project…** item above
**Delete project**:

```
Edit project…
Delete project        (danger)
```

- **Edit project…** sets `editingId = project.id`; that row renders as a
  `ProjectForm` (`mode="edit"`). Saving calls `projects.update` and clears
  `editingId`; cancel just clears it.
- **Delete project** is unchanged (confirm, `projects.remove`, reset filter to
  `ALL` if the deleted project was selected).

## 6. Keyboard nav — `Inbox.svelte`

A sibling to the existing `onNavKey` (agent nav, `⌘↑`/`⌘↓`), on the same
`<svelte:window onkeydown>`:

```
function onProjectNavKey(e):
  if launcher.open: return
  if not (e.metaKey && e.shiftKey) or e.altKey or e.ctrlKey: return
  if e.key not in (ArrowUp, ArrowDown): return
  preventDefault
  cycle projectFilter through the ordered filter list
```

The ordered filter list is a small **pure** helper so it's testable and matches
the panel's render order:

```ts
/** The panel's filter options, top-to-bottom: ALL, each project, then
 *  UNASSIGNED iff any agent is unassigned. PURE. */
export function filterOrder(
  projects: ReadonlyArray<Project>,
  hasUnassigned: boolean
): ProjectFilter[];
```

Nav finds the current `projectFilter.selected` in `filterOrder(...)`, steps by
±1 **clamped to the ends** (no wrap, matching agent nav), and calls
`projectFilter.select(next)`. Works whether the panel is expanded or collapsed.
The existing `⌘↑`/`⌘↓` agent nav is untouched (it ignores Shift).

## 7. Collapsed-rail tooltips — `ProjectPanel.svelte`

Replace the native `title=` tooltips on the collapsed rail icons (slow ~1s OS
delay, unstyled) with an **instant, styled flyout**:

- Each `.pp-rail-ic` (All agents, each project, No project) gets a child label
  element with the filter's name, shown on `:hover` / `:focus-visible` via CSS,
  positioned to the **right** of the rail.
- Styled to the design system: `var(--space-700)` background, `var(--shadow-pop)`,
  1px `var(--line-default)` border, small sans text, `var(--r-sm)` radius, a
  comfortable `white-space: nowrap` pill. No appearance delay.
- `title` attributes are dropped from the rail buttons to avoid a double tooltip.

## Testing

**Pure / unit (Vitest, node env):**

- `projects.test.ts` — `updateProject`: patches fields & keeps id; removes a
  logo via `logo: undefined`; no-op on a missing id; doesn't mutate input.
  `isProject`/`normalize`/`parseProjects` accept a project with a `logo` and one
  without; reject a non-string `logo`.
- `logo.test.ts` (new) — `dominantColor`: picks a vibrant color over a gray
  background; skips fully-transparent pixels; returns the `#7B8499` fallback for
  an all-gray/all-transparent image; averages within the winning bucket.
- `filterOrder` (in the rollup tests) — order is `ALL, …projects` then
  `UNASSIGNED` only when `hasUnassigned`; nav stepping clamps at both ends.

**Verified by running the app (DOM/canvas/Svelte — not headless-testable):**

- `processLogoFile` downscale + data URL + extracted color.
- ProjectForm create & edit, logo add/remove, color auto-set + override.
- `ProjectIcon`/inline logo rendering in rail, rows, and avatars.
- `⌘⇧↑`/`⌘⇧↓` cycling (expanded & collapsed) without disturbing `⌘↑`/`⌘↓`.
- Instant rail tooltips on hover and keyboard focus.

## Out of scope

- The launcher dropdown `ProjectSelect.svelte` (already has arrow nav; create box
  stays glyph-only). Sharing `ProjectForm` there is a possible follow-up.
- Any Rust changes — logos live as data URLs inside the existing `projects.json`.
- `PROJECTS_VERSION` bump / migration — the `logo` field is additive.
