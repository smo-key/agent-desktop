# Tasks — add-dialog-autofocus

## 1. Shared action (`src/lib/ui/autofocus.ts`)
- [x] 1.1 Failing tests first (`autofocus.test.ts`, jsdom): default focuses the
  node; `within` focuses the first focusable descendant; `within` skips disabled
  and treats `role="button" tabindex="0"` rows as focusable; `within` with no
  focusable descendant traps nothing and does not throw; `enabled: false` is inert.
- [x] 1.2 Implement the `autofocus` action: default focuses the node, `within`
  focuses the first focusable descendant, `enabled: false` is inert; no-op destroy.

## 2. Wire button/control-only dialogs
- [x] 2.1 ConfirmModal → `use:autofocus` on the Cancel button (safe action).
- [x] 2.2 HelpModal → `use:autofocus` on the close × (its only control).
- [x] 2.3 SettingsModal → `use:autofocus={{ enabled: i === 0 }}` on the first `<select>`.
- [x] 2.4 WorktreeDialog → `use:autofocus` on the close × (Open/Prune too consequential).
- [x] 2.5 ModelOnboarding → `use:autofocus` on the primary "Download models" CTA.

## 3. Wire the footer popover
- [x] 3.1 FooterPopover → `use:autofocus={{ within: true }}` on the panel; update the
  stale "panel is never focused" comment.

## 4. Verify
- [x] 4.1 `npm run check` (svelte-check) clean — 0 errors, 0 warnings.
- [x] 4.2 `npx vitest run` — full suite green.
