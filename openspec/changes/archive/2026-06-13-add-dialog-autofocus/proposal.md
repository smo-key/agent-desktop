# Autofocus the first control when a dialog opens

## Why

Opening a dialog with the mouse (or a keyboard shortcut) and then having to
click or Tab into it before you can type or press Enter is friction the app
imposes on every modal interaction. Some dialogs already focus their first text
input (the Launcher, Task, Project, and Specialist forms), but the
button/control-only dialogs (Confirm, Settings, Help, Worktrees, model
onboarding) and the footer popovers open with focus left outside, so the
keyboard can't drive them until the user reaches in manually. Focus on open
should be a guarantee across every dialog, not a per-dialog accident.

## What Changes

- **Every dialog focuses its first input or button when it opens.** This is now
  a guarantee, not a per-dialog choice.
- **A shared `use:autofocus` Svelte action** (`src/lib/ui/autofocus.ts`) is the
  one mechanism: it focuses on mount (and our dialogs are `{#if open}`-mounted,
  so mount == open). `{ within: true }` focuses the first focusable descendant
  for containers whose controls come from snippets/children; `{ enabled }` gates
  it so only one element of a rendered list takes focus. Preferred over the
  native `autofocus` attribute — no `a11y_autofocus` lint, and it supports the
  descendant/gated modes the attribute can't.
- **Per-dialog focus targets** are chosen for safety, not just DOM order:
  - **ConfirmModal** → the **Cancel** button, so a stray Enter dismisses rather
    than runs the destructive action (Cancel is focused even though the header
    × precedes it in the DOM).
  - **SettingsModal** → the first setting control (the first `<select>`), not the
    header × close button.
  - **HelpModal** → the close × (its only control; the modal is read-only).
  - **WorktreeDialog** → the close × (per-row Open/Prune are too consequential —
    Prune is destructive — to be the default Enter target).
  - **ModelOnboarding** → the primary "Download models" CTA.
  - **FooterPopover** → the first focusable row in the popover BODY, via
    `{ within: true }` on the body. The pinned action button (Commit now /
    Push now) is deliberately NOT a target, so a stray Enter can't fire a
    consequential commit/push; an empty/loading body leaves focus on the trigger.
- **Out of scope:** the VoicePanel floating overlay (no meaningful first control;
  excluded by request). Form dialogs that already focus their first text input
  keep their existing behavior — they already satisfy the guarantee.

## Impact

- Affected specs: new capability `dialog-autofocus`.
- Affected code: `src/lib/ui/autofocus.ts` (new action + tests), and the wiring
  in `ConfirmModal`, `HelpModal`, `SettingsModal`, `WorktreeDialog`,
  `ModelOnboarding`, and `FooterPopover`.
