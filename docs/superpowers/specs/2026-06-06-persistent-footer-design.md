# Persistent Footer — Design

Date: 2026-06-06
Status: approved (design)

## Goal

A single persistent footer across the whole app that shows, in one row mirroring
the columns above it:

- **Left zone** (under the session rail + agent panes): the focused agent's
  project as a bold, clearly-colored chip, followed by the account-wide rate
  limits (5h / 7d) as a combined pair of mini-bars.
- **Right zone** (under the terminal): the focused agent's git status in the
  style of the user's Claude statusline, followed by the focused agent's context
  window usage as a bar.

All bars are colored by how full they are (green → yellow → red). The compact
`UsageMeter` is removed from the title bar (limits now live only in the footer),
and the current two-row `UsageBar` (per-session cards + account summary) is
replaced.

## Decisions (resolved during brainstorming)

- **Footer shape:** one row, left/right zones separated by a vertical divider.
- **Limits placement:** footer only; remove `UsageMeter` from the title bar.
- **Combined limits:** 5h and 7d render as two labeled mini-bars grouped inside
  one container (separate fills, shared group).
- **Git info richness:** branch + commits-behind-`origin/main` + commits-ahead-of-upstream
  + dirty. **No PR number** (avoids the per-render `gh` call).
- **Per-session cards:** dropped. Per-pane task already surfaces as a `TaskBadge`
  on each pane; per-focused-pane context now surfaces in the footer.
- **Bar color thresholds:** `0–49%` green, `50–79%` yellow, `80–100%` red.
  Higher fill = closer to the limit = worse.
- **Divider alignment:** logical grouping only. The divider is NOT pixel-aligned
  to the dynamic pane split (panes resize freely); left content is left-anchored,
  right content is right-anchored.

## Components

New components under `src/lib/usage/` (and a small shared primitive):

- **`AppFooter.svelte`** — single flex row. Owns the focused-pane-derived view
  (project, git, context) and the account-wide limits. Slots into `.grid-view`
  in `src/routes/+page.svelte` exactly where `UsageBar` is today.
- **`ProjectChip.svelte`** — icon + name. Solid, saturated project-color
  background with auto-contrast (black/white) text + icon, so it reads as a
  bright, distinct chip. Neutral "No project" fallback when the focused pane has
  no `projectId`.
- **`LimitBars.svelte`** — the combined 5h / 7d grouped mini-bars (label + bar +
  `%`). Renders `—` when a window's value is unknown.
- **`GitInfo.svelte`** — statusline-style: `⎇ branch  ↓behind  ↑ahead  ●dirty`.
- **`ContextBar.svelte`** — `ctx` label + bar + `%` for the focused pane.
- **`StatusBar.svelte`** — shared thin track+fill primitive (a `pct` and a color)
  used by both `LimitBars` and `ContextBar`. Supports an "unknown/striped" state
  when `pct` is null.
- **`barColor.ts`** — pure helper: `barColor(pct: number | null) => token`.

The old `UsageBar.svelte` and `UsageMeter.svelte` are removed (their imports in
`src/routes/+page.svelte` removed).

## Layout

```
┌─ AppFooter (one row) ───────────────────────────────────────────────────────┐
│ ▌🚀 my-project▐   5h ▓▓▓░░ 33%   7d ▓▓░░░ 21%  ║  ⎇ main ↓0 ↑2   ctx ▓▓▓▓░ 78% │
│  project chip      └──── combined limit bars ────┘ div └ git status ┘ └ ctx ─┘ │
│  ◀──────────── under rail + agents ─────────────╜◀──────── under terminal ───▶ │
└───────────────────────────────────────────────────────────────────────────────┘
```

Footer is a flex row: `[ProjectChip] [LimitBars] [spacer/divider] [GitInfo] [ContextBar]`.
Background uses `--space-900` (matching rails/footer convention). Fixed height,
`flex: 0 0 auto`, full width.

## Data sources

All "focused" data keys off `workspace.focusedPaneId`.

- **Project chip** ← `focusedPaneId` → `registry[paneId].projectId` →
  `projects` store lookup for `{ name, icon, color }`. Fallback chip when no
  project is assigned.
- **Limits** ← `accountSummary(snapshots.byPane, null)` →
  `fiveHour.usedPct`, `sevenDay.usedPct` (already account-global).
- **Git + context** ← focused pane's snapshot: extended
  `git { branch, dirty, ahead, behind }` and `context_pct`.

To keep the footer testable, the focused-pane → view derivation is a **pure
function** (e.g. `footerView(snapshots, focusedPaneId, registry, projects, now)`)
returning `{ project, git, context, limits }`. `AppFooter.svelte` just renders it.

## Git data pipeline extension

The git fields are produced by `src-tauri/resources/statusline-wrapper.cjs`
(`gitStatus(workspaceDir)`), which already runs `git` per render. Extend it to
add, matching the user's statusline semantics exactly:

- `behind` ← `git -C <dir> rev-list HEAD..origin/main --count --no-merges`
  (integer; `null` when origin/main is unavailable).
- `ahead` ← `git -C <dir> rev-list @{upstream}..HEAD --count`
  (integer; `null` when no upstream).

Each runs through the existing `runGit()` helper with its timeout guard and
silent-fail behavior. `pr_number` is intentionally NOT added.

Thread the new fields through the type definitions:

- Rust `GitStatus` struct in `src-tauri/src/usage.rs`: add
  `ahead: Option<i64>`, `behind: Option<i64>` (with `#[serde(default)]`).
- TS `GitStatus` interface in `src/lib/usage/snapshots.svelte.ts`: add
  `ahead: number | null`, `behind: number | null`.

Existing snapshots without the new fields must continue to parse (serde
`default` / optional TS fields). The `rollup`/`accountSummary` path passes the
focused pane's full `git` object through unchanged; `GitInfo.svelte` reads the
new fields.

### Display rules (match statusline)

- `branch` — dim text, prefixed with `⎇`.
- `↓N` (behind origin/main) — red when `N > 0`, grey `↓0` when `N === 0`,
  hidden when `null`.
- `↑N` (ahead of upstream) — yellow when `N > 0`, hidden when `0` or `null`.
- `●` dirty — amber when `dirty === true`; `✓` green when `dirty === false`;
  nothing when `null`.

## Bar coloring (requirement #5)

`barColor(pct)` (pure, in `barColor.ts`):

- `pct === null` → neutral/striped "unknown" treatment.
- `0 ≤ pct < 50` → `--nominal-500` (green)
- `50 ≤ pct < 80` → `--caution-500` (yellow)
- `80 ≤ pct ≤ 100` → `--abort-500` (red)

Thresholds live as named constants so they're tweakable in one place. Applies to
both limit bars and the context bar.

## Testing (TDD)

- **`barColor.test.ts`** — boundary values: 0, 49, 50, 79, 80, 100, null.
- **`statusline-wrapper.test.ts`** — `gitStatus` returns `ahead`/`behind` parsed
  from the new git commands; nulls when the commands fail / no upstream.
- **Rust `usage.rs` tests** — a snapshot JSON with `ahead`/`behind` parses; a
  legacy snapshot without them still parses (defaults to `None`).
- **`footerView` unit test** — given snapshots + focusedPaneId + registry +
  projects, returns the expected `{ project, git, context, limits }`, including
  the no-project fallback and unknown-value cases.
- Update existing `rollup`/`snapshots` data-shape tests for the new git fields.

Component `.svelte` files themselves are not unit-tested (consistent with the
existing codebase, which tests pure `.ts` logic); all branching logic lives in
the pure helpers above so it is covered.

## Out of scope

- Pixel-aligning the divider to the live pane split.
- PR number display.
- Restoring the per-session cards strip elsewhere.
