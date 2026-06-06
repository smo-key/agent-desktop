# Persistent Footer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two-row `UsageBar` footer (and the title-bar `UsageMeter`) with a single persistent footer: a bright project chip + combined 5h/7d limit bars on the left, statusline-style git + a context bar on the right, with all bars colored by how full they are.

**Architecture:** All decision logic lives in pure, unit-tested `.ts` helpers (`barColor`, `contrastText`, `footerView`); thin `.svelte` components render them (consistent with this codebase, which unit-tests pure logic only and verifies components manually). Git data (`ahead`/`behind`) is produced by the existing `statusline-wrapper.cjs` and threaded through the Rust `Snapshot` struct and the TS `GitStatus` interface.

**Tech Stack:** SvelteKit (Svelte 5 runes), TypeScript, Vitest, Tauri (Rust, serde), Node (the statusline wrapper).

---

## File structure

**Create:**
- `src/lib/usage/barColor.ts` — pure pct → color-token helper + thresholds.
- `src/lib/usage/barColor.test.ts` — boundary tests.
- `src/lib/usage/footerView.ts` — pure focused-pane → footer view-model.
- `src/lib/usage/footerView.test.ts` — derivation tests.
- `src/lib/usage/StatusBar.svelte` — shared thin track+fill bar primitive.
- `src/lib/usage/LimitBars.svelte` — combined 5h/7d mini-bars.
- `src/lib/usage/GitInfo.svelte` — statusline-style git.
- `src/lib/usage/ContextBar.svelte` — context label + bar + %.
- `src/lib/usage/AppFooter.svelte` — composes the footer; reads stores.
- `src/lib/projects/ProjectChip.svelte` — bright project chip.

**Modify:**
- `src/lib/projects/projects.ts` — add `contrastText` helper.
- `src/lib/projects/projects.test.ts` — test `contrastText`.
- `src-tauri/resources/statusline-wrapper.cjs` — extend `gitStatus()` with ahead/behind.
- `src-tauri/resources/statusline-wrapper.test.ts` — assert new git keys.
- `src-tauri/src/usage.rs` — add `ahead`/`behind` to `GitStatus` + update 2 tests.
- `src/lib/usage/snapshots.svelte.ts` — add optional `ahead`/`behind` to `GitStatus`.
- `src/routes/+page.svelte` — swap footer, remove title-bar meter.

**Delete:**
- `src/lib/usage/UsageBar.svelte`
- `src/lib/usage/UsageMeter.svelte`

`rollup.ts` is kept intact (its `accountSummary` is reused by `footerView`; its `cards`/`sessionCard` stay tested even though the new footer drops the cards UI — removing them would break the scenario-coverage gate, so leave them).

---

### Task 1: `barColor` pure helper

**Files:**
- Create: `src/lib/usage/barColor.ts`
- Test: `src/lib/usage/barColor.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/usage/barColor.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { barColor, BAR_YELLOW_AT, BAR_RED_AT } from './barColor';

describe('barColor', () => {
  it('thresholds are 50 (yellow) and 80 (red)', () => {
    expect(BAR_YELLOW_AT).toBe(50);
    expect(BAR_RED_AT).toBe(80);
  });

  it('green below 50', () => {
    expect(barColor(0)).toBe('var(--nominal-500)');
    expect(barColor(49)).toBe('var(--nominal-500)');
  });

  it('yellow from 50 to 79', () => {
    expect(barColor(50)).toBe('var(--caution-500)');
    expect(barColor(79)).toBe('var(--caution-500)');
  });

  it('red from 80 up', () => {
    expect(barColor(80)).toBe('var(--abort-500)');
    expect(barColor(100)).toBe('var(--abort-500)');
  });

  it('neutral track for null / non-finite', () => {
    expect(barColor(null)).toBe('var(--space-600)');
    expect(barColor(NaN)).toBe('var(--space-600)');
    expect(barColor(Infinity)).toBe('var(--space-600)');
  });

  it('treats negative as green (below yellow)', () => {
    expect(barColor(-5)).toBe('var(--nominal-500)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/usage/barColor.test.ts`
Expected: FAIL — cannot resolve `./barColor`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/usage/barColor.ts`:

```ts
// PURE bar-color helper for the persistent footer. Maps a 0..100 "fill" percent
// to a status color token by how FULL it is: a fuller bar is closer to its limit
// and so escalates green -> yellow -> red. Framework-free (no Svelte/Tauri), so
// it is unit-tested in barColor.test.ts. Thresholds live here as the single
// tweakable source of truth, shared by the limit bars and the context bar.

/** A fill at or above this percent is YELLOW (caution). */
export const BAR_YELLOW_AT = 50;
/** A fill at or above this percent is RED (abort). */
export const BAR_RED_AT = 80;

/**
 * The CSS color (a design-token `var(...)`) for a fill percent: green below
 * `BAR_YELLOW_AT`, yellow up to `BAR_RED_AT`, red at/above it. A null or
 * non-finite percent (unknown) renders as the neutral track color.
 */
export function barColor(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return 'var(--space-600)';
  if (pct >= BAR_RED_AT) return 'var(--abort-500)';
  if (pct >= BAR_YELLOW_AT) return 'var(--caution-500)';
  return 'var(--nominal-500)';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/usage/barColor.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/usage/barColor.ts src/lib/usage/barColor.test.ts
git commit -m "feat(footer): barColor helper (green<50, yellow<80, red)"
```

---

### Task 2: `contrastText` helper

**Files:**
- Modify: `src/lib/projects/projects.ts` (add helper after `hexA`, ~line 68)
- Test: `src/lib/projects/projects.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/projects/projects.test.ts` (add `contrastText` to the existing import from `'./projects'` at the top of the file, then add this block):

```ts
describe('contrastText', () => {
  it('dark text on light backgrounds', () => {
    expect(contrastText('#ffffff')).toBe('#06080c');
    expect(contrastText('#3CCB7F')).toBe('#06080c'); // bright green
    expect(contrastText('#F0B341')).toBe('#06080c'); // amber
  });

  it('white text on dark backgrounds', () => {
    expect(contrastText('#000000')).toBe('#ffffff');
    expect(contrastText('#1e49b4')).toBe('#ffffff'); // deep blue
  });

  it('falls back to white for an unparseable hex', () => {
    expect(contrastText('not-a-color')).toBe('#ffffff');
    expect(contrastText('')).toBe('#ffffff');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/projects/projects.test.ts`
Expected: FAIL — `contrastText` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/projects/projects.ts`, add directly after the `hexA` function (after line 68):

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/projects/projects.test.ts`
Expected: PASS (existing tests + the 3 new `contrastText` tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/projects/projects.ts src/lib/projects/projects.test.ts
git commit -m "feat(footer): contrastText helper for the project chip"
```

---

### Task 3: Extend wrapper git status with ahead/behind

**Files:**
- Modify: `src-tauri/resources/statusline-wrapper.cjs:202-225` (`gitStatus`)
- Test: `src-tauri/resources/statusline-wrapper.test.ts:116-119`

- [ ] **Step 1: Update the test to require the new keys**

In `src-tauri/resources/statusline-wrapper.test.ts`, find the git shape assertion (currently lines 116-119):

```ts
    // git is always an object (branch + dirty), values may be null off-repo.
    expect(typeof snap.git).toBe('object');
    expect(snap.git).not.toBeNull();
    expect(snap.git).toHaveProperty('branch');
    expect(snap.git).toHaveProperty('dirty');
```

Replace it with:

```ts
    // git is always an object (branch + dirty + ahead + behind); values may be
    // null off-repo (the temp workspace dir is not a git repo).
    expect(typeof snap.git).toBe('object');
    expect(snap.git).not.toBeNull();
    expect(snap.git).toHaveProperty('branch');
    expect(snap.git).toHaveProperty('dirty');
    expect(snap.git).toHaveProperty('ahead');
    expect(snap.git).toHaveProperty('behind');
    expect((snap.git as Record<string, unknown>).ahead).toBeNull();
    expect((snap.git as Record<string, unknown>).behind).toBeNull();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src-tauri/resources/statusline-wrapper.test.ts`
Expected: FAIL — `snap.git` has no `ahead`/`behind` property.

- [ ] **Step 3: Implement the wrapper change**

In `src-tauri/resources/statusline-wrapper.cjs`, replace the whole `gitStatus` function body (lines 202-225) with:

```js
function gitStatus(workspaceDir) {
  const out = { branch: null, dirty: null, ahead: null, behind: null };
  try {
    const dir = str(workspaceDir);
    if (!dir) return out;
    const runGit = (args) => {
      const res = spawnSync('git', ['-C', dir, ...args], {
        timeout: 1500,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      });
      if (!res || res.status !== 0 || res.error) return null;
      return typeof res.stdout === 'string' ? res.stdout.trim() : null;
    };
    const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
    if (branch !== null) out.branch = branch.length ? branch : null;
    // `--porcelain` prints one line per change; empty stdout => clean tree.
    const porcelain = runGit(['status', '--porcelain']);
    if (porcelain !== null) out.dirty = porcelain.length > 0;
    // Commits BEHIND origin/main (matches the user's Claude statusline). Null
    // when origin/main is unavailable (no remote / not fetched).
    const behind = runGit(['rev-list', 'HEAD..origin/main', '--count', '--no-merges']);
    if (behind !== null) {
      const n = parseInt(behind, 10);
      if (Number.isFinite(n)) out.behind = n;
    }
    // Commits AHEAD of the upstream tracking branch (not yet pushed). Null when
    // there is no upstream set.
    const ahead = runGit(['rev-list', '@{upstream}..HEAD', '--count']);
    if (ahead !== null) {
      const n = parseInt(ahead, 10);
      if (Number.isFinite(n)) out.ahead = n;
    }
  } catch {
    // leave nulls
  }
  return out;
}
```

Also update the doc comment above it (lines 196-201) to mention ahead/behind:

```js
/**
 * Git branch + dirty flag + ahead/behind counts for the workspace dir, by
 * shelling out to git with short timeouts. Returns
 * { branch, dirty, ahead, behind } — always an object (never null) so the
 * snapshot has a stable shape; individual fields are null when git can't answer.
 * `behind` is vs origin/main; `ahead` is vs the upstream branch. Fully guarded.
 */
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src-tauri/resources/statusline-wrapper.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/resources/statusline-wrapper.cjs src-tauri/resources/statusline-wrapper.test.ts
git commit -m "feat(footer): wrapper emits git ahead/behind counts"
```

---

### Task 4: Thread `ahead`/`behind` through Rust + TS types

**Files:**
- Modify: `src-tauri/src/usage.rs:42-50` (struct), `:287` and `:297-303` and `:328-332` (tests)
- Modify: `src/lib/usage/snapshots.svelte.ts:15-19` (interface)

- [ ] **Step 1: Update the Rust full-shape test (failing)**

In `src-tauri/src/usage.rs`, in `read_snapshot_parses_full_shape`, change the git JSON (line 287) from:

```rust
                "cost":1.25,"git":{"branch":"main","dirty":true},"ts":1717200000
```

to:

```rust
                "cost":1.25,"git":{"branch":"main","dirty":true,"ahead":2,"behind":0},"ts":1717200000
```

and the git assertion (lines 297-303) from:

```rust
        assert_eq!(
            snap.git,
            Some(GitStatus {
                branch: Some("main".into()),
                dirty: Some(true)
            })
        );
```

to:

```rust
        assert_eq!(
            snap.git,
            Some(GitStatus {
                branch: Some("main".into()),
                dirty: Some(true),
                ahead: Some(2),
                behind: Some(0)
            })
        );
```

Then in `read_snapshot_tolerates_absent_optionals`, update the git assertion (lines 328-332+) from:

```rust
        assert_eq!(
            snap.git,
            Some(GitStatus {
                branch: None,
                dirty: None
```

to:

```rust
        assert_eq!(
            snap.git,
            Some(GitStatus {
                branch: None,
                dirty: None,
                ahead: None,
                behind: None
```

(Leave the closing `})` and the rest of that test as-is — this proves a snapshot whose git omits ahead/behind still parses, defaulting them to `None`.)

- [ ] **Step 2: Run the Rust tests to verify they fail**

Run: `cd src-tauri && cargo test usage:: 2>&1 | tail -20`
Expected: FAIL — `GitStatus` has no fields `ahead`/`behind`.

- [ ] **Step 3: Add the fields to the Rust struct**

In `src-tauri/src/usage.rs`, in the `GitStatus` struct (lines 42-50), after the `dirty` field add:

```rust
    /// Commits ahead of the upstream branch (not yet pushed), or `null`.
    #[serde(default)]
    pub ahead: Option<i64>,
    /// Commits behind `origin/main`, or `null`.
    #[serde(default)]
    pub behind: Option<i64>,
```

The struct keeps `#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]` — `Option<i64>` is `Eq`, so no derive change is needed.

- [ ] **Step 4: Run the Rust tests to verify they pass**

Run: `cd src-tauri && cargo test usage:: 2>&1 | tail -20`
Expected: PASS (`read_snapshot_parses_full_shape`, `read_snapshot_tolerates_absent_optionals`, and the rest).

- [ ] **Step 5: Update the TS `GitStatus` interface**

In `src/lib/usage/snapshots.svelte.ts`, replace the `GitStatus` interface (lines 15-19):

```ts
/** Git branch + dirty for a pane's workspace dir (stable shape; fields nullable). */
export interface GitStatus {
  branch: string | null;
  dirty: boolean | null;
}
```

with:

```ts
/**
 * Git status for a pane's workspace dir (stable shape; fields nullable). `branch`
 * + `dirty` are the original fields; `ahead` (vs upstream) and `behind` (vs
 * origin/main) are additive and OPTIONAL so a legacy snapshot without them still
 * types. The wrapper always emits all four (null off-repo).
 */
export interface GitStatus {
  branch: string | null;
  dirty: boolean | null;
  ahead?: number | null;
  behind?: number | null;
}
```

- [ ] **Step 6: Run check + the usage tests to verify nothing broke**

Run: `npx vitest run src/lib/usage/rollup.test.ts src/lib/usage/snapshots.test.ts`
Expected: PASS (the optional fields mean existing `{branch, dirty}` literals in `rollup.test.ts` still type-check and `toEqual` still matches).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/usage.rs src/lib/usage/snapshots.svelte.ts
git commit -m "feat(footer): thread git ahead/behind through Rust + TS types"
```

---

### Task 5: `footerView` pure derivation

**Files:**
- Create: `src/lib/usage/footerView.ts`
- Test: `src/lib/usage/footerView.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/usage/footerView.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { footerView } from './footerView';
import type { Snapshot, SnapshotMap } from './snapshots.svelte';
import type { Project } from '$lib/projects/projects';

function snap(over: Partial<Snapshot> & { pane_id: string }): Snapshot {
  return {
    pane_id: over.pane_id,
    session_id: null,
    model: null,
    task: null,
    context_pct: null,
    rate_limits: null,
    cost: null,
    git: null,
    ts: 0,
    ...over,
  };
}

const PROJECTS: Project[] = [
  { id: 'p1', name: 'Mission Control', path: '/code/mc', icon: 'rocket', color: '#3CCB7F' },
];

describe('footerView', () => {
  it('resolves the focused pane project, git, and context', () => {
    const map: SnapshotMap = {
      a: snap({
        pane_id: 'a',
        context_pct: 78,
        git: { branch: 'feature-x', dirty: true, ahead: 2, behind: 0 },
        rate_limits: {
          five_hour: { used_percentage: 33, resets_at: 1 },
          seven_day: { used_percentage: 21, resets_at: 2 },
        },
        ts: 100,
      }),
    };
    const view = footerView(map, 'a', 'p1', PROJECTS);
    expect(view.project?.name).toBe('Mission Control');
    expect(view.git).toEqual({ branch: 'feature-x', dirty: true, ahead: 2, behind: 0 });
    expect(view.context).toBe(78);
    expect(view.fiveHour.usedPct).toBe(33);
    expect(view.sevenDay.usedPct).toBe(21);
  });

  it('null project when projectId is null or unknown', () => {
    const view = footerView({}, null, null, PROJECTS);
    expect(view.project).toBeNull();
    expect(footerView({}, null, 'nope', PROJECTS).project).toBeNull();
  });

  it('null git/context when the focused pane has no snapshot, but limits still roll up', () => {
    const map: SnapshotMap = {
      other: snap({
        pane_id: 'other',
        rate_limits: { five_hour: { used_percentage: 5, resets_at: 1 } },
        ts: 50,
      }),
    };
    const view = footerView(map, 'missing', null, PROJECTS);
    expect(view.git).toBeNull();
    expect(view.context).toBeNull();
    expect(view.fiveHour.usedPct).toBe(5);
  });

  it('coerces a non-finite context_pct to null', () => {
    const map: SnapshotMap = { a: snap({ pane_id: 'a', context_pct: Number.NaN }) };
    expect(footerView(map, 'a', null, PROJECTS).context).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/usage/footerView.test.ts`
Expected: FAIL — cannot resolve `./footerView`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/usage/footerView.ts`:

```ts
// PURE view-model for the persistent AppFooter. Given the live pane_id ->
// snapshot map plus the focused pane id, its project id, and the projects list,
// it derives everything the footer renders: the focused pane's project, git, and
// context window usage, plus the account-wide 5h/7d rate-limit windows (reusing
// the tested `accountSummary`). Framework-free (no Svelte/Tauri imports), so it
// is unit-tested in footerView.test.ts; AppFooter is the thin reactive shell.

import { accountSummary, type RateWindow } from './rollup';
import type { GitStatus, SnapshotMap } from './snapshots.svelte';
import { projectForId, type Project } from '../projects/projects';

/** The footer's whole view-model. */
export interface FooterView {
  /** The focused pane's project (chip), or null when unassigned/unknown. */
  project: Project | null;
  /** The focused pane's git status, or null when unknown. */
  git: GitStatus | null;
  /** The focused pane's context window usage 0..100, or null when unknown. */
  context: number | null;
  /** Account-wide 5-hour rate-limit window. */
  fiveHour: RateWindow;
  /** Account-wide 7-day rate-limit window. */
  sevenDay: RateWindow;
}

/** Finite number in any range, else null (guards NaN/Infinity/strings). */
function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Build the footer view-model. `git`/`context` come from the focused pane's
 * snapshot (null when it has none); the rate-limit windows are account-global
 * (newest snapshot wins, via `accountSummary`); `project` is resolved from the
 * projects list by `projectId`. Pure: reads inputs, returns a fresh object.
 */
export function footerView(
  map: SnapshotMap,
  focusedPaneId: string | null,
  projectId: string | null,
  projects: ReadonlyArray<Project>
): FooterView {
  const focused = focusedPaneId ? map[focusedPaneId] : undefined;
  const git = focused ? (focused.git ?? null) : null;
  const context = focused ? finiteOrNull(focused.context_pct) : null;
  const account = accountSummary(map, git);
  return {
    project: projectForId(projects, projectId),
    git,
    context,
    fiveHour: account.fiveHour,
    sevenDay: account.sevenDay,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/usage/footerView.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/usage/footerView.ts src/lib/usage/footerView.test.ts
git commit -m "feat(footer): footerView pure derivation"
```

---

### Task 6: `StatusBar.svelte` shared primitive

**Files:**
- Create: `src/lib/usage/StatusBar.svelte`

Components carry no unit tests in this codebase; verification is `npm run check` (svelte-check) plus the manual run in Task 12.

- [ ] **Step 1: Create the component**

Create `src/lib/usage/StatusBar.svelte`:

```svelte
<script lang="ts">
  // A thin track + colored fill. The fill width is the clamped percent and its
  // color comes from the shared `barColor` (green/yellow/red by fullness). A null
  // percent renders an "unknown" striped track. Used by LimitBars + ContextBar.
  import { barColor } from './barColor';

  let { pct, label }: { pct: number | null; label?: string } = $props();

  const known = $derived(pct !== null && Number.isFinite(pct));
  const width = $derived(known ? Math.max(0, Math.min(100, pct as number)) : 0);
</script>

<div class="bar" class:unknown={!known} title={label}>
  {#if known}
    <div class="fill" style:width={`${width}%`} style:background={barColor(pct)}></div>
  {/if}
</div>

<style>
  .bar {
    flex: 1 1 auto;
    min-width: 48px;
    height: 5px;
    border-radius: 3px;
    background: var(--space-600);
    overflow: hidden;
  }
  .bar.unknown {
    background: repeating-linear-gradient(
      -45deg,
      var(--space-600),
      var(--space-600) 4px,
      var(--space-700) 4px,
      var(--space-700) 8px
    );
  }
  .fill {
    height: 100%;
    border-radius: 3px;
    transition:
      width var(--dur-base),
      background var(--dur-base);
  }
</style>
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run check`
Expected: 0 errors (the component compiles; it is not yet used).

- [ ] **Step 3: Commit**

```bash
git add src/lib/usage/StatusBar.svelte
git commit -m "feat(footer): StatusBar bar primitive"
```

---

### Task 7: `ProjectChip.svelte`

**Files:**
- Create: `src/lib/projects/ProjectChip.svelte`

- [ ] **Step 1: Create the component**

Create `src/lib/projects/ProjectChip.svelte`:

```svelte
<script lang="ts">
  // The footer's project chip: the focused agent's project as a BRIGHT, solid
  // colored chip (the project's full color as the background, auto-contrast text
  // + icon on top) so it reads at a glance. A neutral "No project" chip shows
  // when the focused pane has no project bound.
  import Icon from '$lib/icons/Icon.svelte';
  import { contrastText, projectLabel, type Project } from './projects';

  let { project }: { project: Project | null } = $props();
</script>

{#if project}
  {@const fg = contrastText(project.color)}
  <div class="chip" style:background={project.color} style:color={fg} title={project.path}>
    <Icon name={project.icon} size={14} color={fg} stroke={2} />
    <span class="name">{projectLabel(project)}</span>
  </div>
{:else}
  <div class="chip none" title="No project for the focused pane">
    <span class="name">No project</span>
  </div>
{/if}

<style>
  .chip {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 22px;
    padding: 0 10px;
    border-radius: var(--r-full);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.01em;
    max-width: 220px;
  }
  .chip.none {
    background: var(--space-700);
    color: var(--fg-3);
    font-weight: 500;
    box-shadow: inset 0 0 0 1px var(--line-subtle);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run check`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/projects/ProjectChip.svelte
git commit -m "feat(footer): ProjectChip bright project chip"
```

---

### Task 8: `LimitBars.svelte`

**Files:**
- Create: `src/lib/usage/LimitBars.svelte`

- [ ] **Step 1: Create the component**

Create `src/lib/usage/LimitBars.svelte`:

```svelte
<script lang="ts">
  // The combined account-wide rate-limit bars (5h + 7d) grouped as one unit. Each
  // is a label + StatusBar (colored by fullness) + percent, or a dim dash when
  // the window is unknown.
  import StatusBar from './StatusBar.svelte';
  import type { RateWindow } from './rollup';

  let { fiveHour, sevenDay }: { fiveHour: RateWindow; sevenDay: RateWindow } = $props();

  function pct(value: number | null): string {
    return value === null ? '—' : `${Math.round(value)}%`;
  }
</script>

<div class="limits" aria-label="Account rate limits">
  <div class="limit">
    <span class="label">5h</span>
    <StatusBar pct={fiveHour.usedPct} label={`5-hour limit ${pct(fiveHour.usedPct)}`} />
    <span class="val" class:dim={fiveHour.usedPct === null}>{pct(fiveHour.usedPct)}</span>
  </div>
  <div class="limit">
    <span class="label">7d</span>
    <StatusBar pct={sevenDay.usedPct} label={`7-day limit ${pct(sevenDay.usedPct)}`} />
    <span class="val" class:dim={sevenDay.usedPct === null}>{pct(sevenDay.usedPct)}</span>
  </div>
</div>

<style>
  .limits {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 14px;
    padding: 4px 10px;
    border-radius: var(--r-sm);
    background: var(--space-850);
    box-shadow: inset 0 0 0 1px var(--line-faint);
  }
  .limit {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }
  .label {
    color: var(--fg-4);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 10px;
    font-family: var(--font-mono);
  }
  .limit :global(.bar) {
    width: 64px;
    flex: 0 0 64px;
  }
  .val {
    color: var(--fg-1);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    font-family: var(--font-mono);
    min-width: 30px;
    text-align: right;
  }
  .val.dim {
    color: var(--fg-4);
  }
</style>
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run check`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/usage/LimitBars.svelte
git commit -m "feat(footer): LimitBars combined 5h/7d bars"
```

---

### Task 9: `GitInfo.svelte`

**Files:**
- Create: `src/lib/usage/GitInfo.svelte`

- [ ] **Step 1: Create the component**

Create `src/lib/usage/GitInfo.svelte`:

```svelte
<script lang="ts">
  // The focused pane's git status, styled like the user's Claude statusline:
  //   ⎇ branch  ↓behind  ↑ahead  ●dirty
  // branch dim; behind red (grey when 0); ahead yellow (hidden when 0); dirty an
  // amber dot (green ✓ when clean). Counts are hidden when null (git couldn't
  // answer — no remote / no upstream / off-repo).
  import type { GitStatus } from './snapshots.svelte';

  let { git }: { git: GitStatus | null } = $props();
</script>

<div class="git" title="Focused pane git status">
  {#if git && git.branch}
    <span class="branch">⎇ {git.branch}</span>
    {#if git.behind != null}
      <span class="behind" class:zero={git.behind === 0}>↓{git.behind}</span>
    {/if}
    {#if git.ahead != null && git.ahead > 0}
      <span class="ahead">↑{git.ahead}</span>
    {/if}
    {#if git.dirty === true}
      <span class="dirty" title="uncommitted changes">●</span>
    {:else if git.dirty === false}
      <span class="clean" title="clean">✓</span>
    {/if}
  {:else}
    <span class="branch dim">⎇ —</span>
  {/if}
</div>

<style>
  .git {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    overflow: hidden;
  }
  .branch {
    color: var(--fg-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 240px;
  }
  .branch.dim {
    color: var(--fg-4);
  }
  .behind {
    color: var(--abort-500);
  }
  .behind.zero {
    color: var(--fg-4);
  }
  .ahead {
    color: var(--caution-500);
  }
  .dirty {
    color: var(--caution-500);
    font-size: 9px;
  }
  .clean {
    color: var(--nominal-500);
    font-size: 10px;
  }
</style>
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run check`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/usage/GitInfo.svelte
git commit -m "feat(footer): GitInfo statusline-style git"
```

---

### Task 10: `ContextBar.svelte`

**Files:**
- Create: `src/lib/usage/ContextBar.svelte`

- [ ] **Step 1: Create the component**

Create `src/lib/usage/ContextBar.svelte`:

```svelte
<script lang="ts">
  // The focused pane's context window usage: a "ctx" label + a StatusBar (colored
  // by fullness) + the percent. A dim dash + striped bar when unknown.
  import StatusBar from './StatusBar.svelte';

  let { pct }: { pct: number | null } = $props();

  function fmt(value: number | null): string {
    return value === null ? '—' : `${Math.round(value)}%`;
  }
</script>

<div class="ctx" aria-label="Focused pane context window used">
  <span class="label">ctx</span>
  <StatusBar
    {pct}
    label={pct === null ? 'context unknown' : `context ${Math.round(pct)}%`}
  />
  <span class="val" class:dim={pct === null}>{fmt(pct)}</span>
</div>

<style>
  .ctx {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }
  .label {
    color: var(--fg-4);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 10px;
    font-family: var(--font-mono);
  }
  .ctx :global(.bar) {
    width: 96px;
    flex: 0 0 96px;
  }
  .val {
    color: var(--fg-1);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    font-family: var(--font-mono);
    min-width: 30px;
    text-align: right;
  }
  .val.dim {
    color: var(--fg-4);
  }
</style>
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run check`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/usage/ContextBar.svelte
git commit -m "feat(footer): ContextBar context-window bar"
```

---

### Task 11: `AppFooter.svelte`

**Files:**
- Create: `src/lib/usage/AppFooter.svelte`

- [ ] **Step 1: Create the component**

Create `src/lib/usage/AppFooter.svelte`:

```svelte
<script lang="ts">
  // The single persistent footer. LEFT (mirrors the rail + agent panes above):
  // the focused agent's project chip + the combined 5h/7d limit bars. RIGHT
  // (mirrors the terminal): the focused agent's git (statusline-style) then its
  // context bar. A divider separates the two zones. All math is in the pure,
  // tested `footerView`; this is the thin reactive shell that reads the stores.
  import { snapshots } from './snapshots.svelte';
  import { footerView } from './footerView';
  import { workspace } from '$lib/layout/workspace.svelte';
  import { projects } from '$lib/projects/projects.svelte';
  import ProjectChip from '$lib/projects/ProjectChip.svelte';
  import LimitBars from './LimitBars.svelte';
  import GitInfo from './GitInfo.svelte';
  import ContextBar from './ContextBar.svelte';

  // The focused pane id and the project bound to it (from the active workspace's
  // registry). Reading `workspace.active`/`focusedPaneId` keeps this reactive to
  // focus + workspace switches.
  const focusedPaneId = $derived(workspace.focusedPaneId);
  const projectId = $derived(
    focusedPaneId ? (workspace.active?.registry[focusedPaneId]?.projectId ?? null) : null
  );

  const view = $derived(
    footerView(snapshots.byPane, focusedPaneId, projectId, projects.list)
  );
</script>

<footer class="app-footer" aria-label="Status footer">
  <div class="zone left">
    <ProjectChip project={view.project} />
    <LimitBars fiveHour={view.fiveHour} sevenDay={view.sevenDay} />
  </div>

  <div class="zone right">
    <GitInfo git={view.git} />
    <span class="sep" aria-hidden="true"></span>
    <ContextBar pct={view.context} />
  </div>
</footer>

<style>
  .app-footer {
    flex: 0 0 auto;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    width: 100%;
    padding: 6px 14px;
    background: var(--space-900);
    border-top: 1px solid var(--line-subtle);
    user-select: none;
    -webkit-user-select: none;
    font-family: var(--font-sans);
  }
  .zone {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  /* The divider between the agents (left) and terminal (right) zones. */
  .zone.right {
    padding-left: 16px;
    border-left: 1px solid var(--line-subtle);
  }
  .sep {
    width: 1px;
    height: 14px;
    background: var(--line-subtle);
  }
</style>
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run check`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/usage/AppFooter.svelte
git commit -m "feat(footer): AppFooter composes the persistent footer"
```

---

### Task 12: Wire into the app + remove the old footer/meter

**Files:**
- Modify: `src/routes/+page.svelte:16-17` (imports), `:327` (title bar), `:363` (footer)
- Delete: `src/lib/usage/UsageBar.svelte`, `src/lib/usage/UsageMeter.svelte`

- [ ] **Step 1: Swap the imports**

In `src/routes/+page.svelte`, replace the two import lines (16-17):

```ts
  import UsageBar from '$lib/usage/UsageBar.svelte';
  import UsageMeter from '$lib/usage/UsageMeter.svelte';
```

with:

```ts
  import AppFooter from '$lib/usage/AppFooter.svelte';
```

- [ ] **Step 2: Remove the title-bar meter**

In `src/routes/+page.svelte`, in the `.tb-right` block (around line 326-331), remove the `<UsageMeter />` line so the block reads:

```svelte
    <div class="tb-right" data-tauri-drag-region>
      <!-- Opt back into pointer events (the bar is a drag region) so the button is
           clickable. Opens the same shortcuts modal as Cmd-/ and bare ?. -->
      <button class="help-btn" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (⌘/)" onclick={() => help.show()}>?</button>
    </div>
```

- [ ] **Step 3: Swap the footer**

In `src/routes/+page.svelte`, replace the footer block (around lines 361-363):

```svelte
    <!-- Two-row usage dashboard, pinned full-width at the bottom below the body.
         Reads the snapshots store + workspace focus; all rollup math is pure. -->
    <UsageBar />
```

with:

```svelte
    <!-- Persistent footer, pinned full-width below the body: project chip + 5h/7d
         limit bars (left) | git + context bar (right). All math is in the pure
         `footerView`. -->
    <AppFooter />
```

- [ ] **Step 4: Delete the old components**

```bash
git rm src/lib/usage/UsageBar.svelte src/lib/usage/UsageMeter.svelte
```

- [ ] **Step 5: Verify no dangling references**

Run: `grep -rn "UsageBar\|UsageMeter" src --include="*.svelte" --include="*.ts" | grep -v "\.test\." | grep -v "rollup"`
Expected: no output (the only remaining mentions are doc comments in `rollup.ts`/`rollup.test.ts`, which are filtered out and harmless).

- [ ] **Step 6: Run the full gate**

Run: `npm run check && npm run test && npm run coverage`
Expected: svelte-check 0 errors; all vitest suites pass; scenario coverage passes.

Run: `cd src-tauri && cargo test 2>&1 | tail -15`
Expected: all Rust tests pass.

- [ ] **Step 7: Manual visual verification**

Run the app (`npm run tauri dev`) and confirm:
- A single footer row with a bright, solid-colored project chip on the left for the focused agent (and "No project" when unassigned).
- 5h/7d bars next to it, colored green/yellow/red by fullness.
- A vertical divider, then on the right: `⎇ branch ↓N ↑N ●/✓`, then a `ctx` bar + %.
- The title bar no longer shows the usage meter.
- Switching focus between panes updates the chip, git, and context to the focused pane.

- [ ] **Step 8: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "feat(footer): mount AppFooter, drop UsageBar + title-bar UsageMeter"
```

---

## Self-review

**Spec coverage:**
- Project chip, distinct color, clear background → Task 7 (`ProjectChip`, solid color bg + `contrastText`).
- Move 5h/7d limits; remove the separate title-bar section → Tasks 8 + 12 (`LimitBars` in footer; `UsageMeter` removed).
- Differentiate left/right under the agents area; combine the first two bars → Tasks 8 + 11 (combined `LimitBars`; left/right zones + divider in `AppFooter`).
- Right side: branch first, then context as a bar → Tasks 9, 10, 11 (`GitInfo` then `ContextBar`, in that order).
- All bars colored by fullness (green/yellow/red) → Task 1 (`barColor`) used by Task 6 (`StatusBar`).
- Git info like the user's statusline → Tasks 3, 4, 9 (`ahead`/`behind` pipeline + `GitInfo` display rules).

**Placeholder scan:** none — every code step has complete content.

**Type consistency:** `GitStatus` gains optional `ahead?`/`behind?` (TS) / `Option<i64>` (Rust); `FooterView` fields (`project`, `git`, `context`, `fiveHour`, `sevenDay`) match across `footerView.ts`, its test, and `AppFooter.svelte`. `barColor(pct)`, `footerView(map, focusedPaneId, projectId, projects)`, and `contrastText(hex)` signatures are used identically wherever referenced. `RateWindow` is imported from `rollup.ts` in both `footerView.ts` and `LimitBars.svelte`.
