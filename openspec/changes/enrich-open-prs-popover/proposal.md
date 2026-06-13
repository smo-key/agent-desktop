# Enrich the open-PRs popover rows

## Why

The footer's "open PRs awaiting review" popover lists each open PR as just
`#<number> · <title> · [Draft]`. To triage at a glance you currently have to open
each PR on GitHub to see who opened it, how stale it is, and where it stands in
review. Surfacing that context inline makes the popover a real triage view.

## What Changes

Each PR row in the open-PRs popover gains three pieces of context, sourced from
the same best-effort `gh pr list` call:

- **Author avatar** — the PR author's GitHub avatar (`https://github.com/<login>.png`),
  hover reveals the author's name. Falls back to the author's initial (or a bot
  glyph for bot authors) when the image can't load or the author is unknown.
- **Last updated** — a relative "2h ago" / "3d ago" timestamp, with the exact
  time on hover.
- **Review-status icon** — a per-row glyph reflecting `reviewDecision`: approved
  (check), changes requested (x), review required (clock), or a neutral glyph when
  no review has been requested yet. Always shown.

The badge/count logic on the pill is unchanged. Everything degrades gracefully:
missing author/updatedAt/avatar simply hide that bit of the row, consistent with
the existing graceful-degradation contract.

## Impact

- Affected spec: `footer-actions` → "Open PRs awaiting review button" requirement.
- Code: `src-tauri/src/pr.rs` (gh fields + `OpenPr`/`PrAuthor`), `src/lib/projects/openPrsActions.ts`
  (mirrored types + pure row helpers), a new `src/lib/usage/PrAuthorAvatar.svelte`,
  `src/lib/usage/GitInfo.svelte` (enriched rows), and one new vendored icon.
