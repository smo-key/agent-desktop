# dialog-autofocus delta

## ADDED Requirements

### Requirement: Dialogs autofocus their first control on open

Every dialog SHALL move keyboard focus to its first input or button at the moment
it opens, so the user can type or act without first clicking or tabbing into it.
The focus target SHALL be a meaningful control: a dismiss-only header close (×)
button SHALL be skipped in favor of a primary control when one exists. For a
destructive confirmation, the SAFE (non-destructive) action SHALL be focused so a
stray Enter dismisses rather than confirms. The floating VoicePanel overlay is
NOT a dialog for this purpose and is EXCLUDED.

#### Scenario: A form dialog focuses its first input

- **WHEN** a dialog whose primary control is a text input opens (the session
  Launcher, the Task, Project, or Specialist dialogs)
- **THEN** that first input receives focus, so typing begins immediately

#### Scenario: A destructive confirmation focuses the safe action

- **WHEN** the confirmation dialog (`ConfirmModal`) opens
- **THEN** the Cancel button receives focus — not the header × and not the danger
  button — so pressing Enter dismisses rather than runs the destructive action

#### Scenario: The settings dialog focuses its first setting, not the close button

- **WHEN** the Settings dialog opens
- **THEN** the first setting control (the first `<select>`) receives focus, not the
  header × close button

#### Scenario: A read-only dialog focuses its only control

- **WHEN** the Help dialog opens (read-only; its only control is the close ×)
- **THEN** the close button receives focus

#### Scenario: The worktrees dialog focuses its close button

- **WHEN** the Worktrees dialog opens
- **THEN** the close × receives focus, because the per-row Open/Prune actions
  (Prune being destructive) are too consequential to be the default Enter target

#### Scenario: The onboarding gate focuses its primary action

- **WHEN** the model-onboarding gate opens with its actions visible
- **THEN** the primary "Download models" button receives focus, so Enter starts
  the download

#### Scenario: A footer popover focuses its first focusable control

- **WHEN** a footer popover opens
- **THEN** the first focusable control inside the panel receives focus — the first
  list row when the body has rows, otherwise the pinned action button — and when
  the body has no focusable content, focus is NOT trapped on the non-interactive
  panel container

### Requirement: Shared autofocus action

The app SHALL provide a single Svelte action, `use:autofocus`
(`src/lib/ui/autofocus.ts`), as the mechanism for the focus-on-open behavior.
Because dialogs are `{#if open}`-mounted, the action focuses on mount. It SHALL
support:

- default — focus the node it is attached to;
- `{ within: true }` — focus the first focusable DESCENDANT (for containers whose
  controls are provided by snippets/children), and focus NOTHING when no
  descendant is focusable (it MUST NOT trap focus on the container);
- `{ enabled: false }` — be inert, so a caller can focus exactly one element of a
  rendered list (e.g. `use:autofocus={{ enabled: i === 0 }}`).

"Focusable" SHALL exclude disabled controls and `tabindex="-1"` elements, and
SHALL include `role`/`tabindex`-based controls (e.g. a `role="button"
tabindex="0"` list row).

#### Scenario: Default focuses the attached node

- **WHEN** `use:autofocus` is applied to a button and the button mounts
- **THEN** that button becomes the active element

#### Scenario: `within` focuses the first focusable descendant, skipping disabled

- **WHEN** `use:autofocus={{ within: true }}` is applied to a container whose first
  child control is disabled
- **THEN** the first ENABLED focusable descendant (including a `role="button"
  tabindex="0"` row) receives focus

#### Scenario: `within` with no focusable descendant traps nothing

- **WHEN** `use:autofocus={{ within: true }}` is applied to a container with no
  focusable descendant
- **THEN** focus is not moved to the container, and no error is thrown

#### Scenario: `enabled: false` is inert

- **WHEN** `use:autofocus={{ enabled: false }}` is applied to an element
- **THEN** focus is not changed, leaving the previously focused element active
