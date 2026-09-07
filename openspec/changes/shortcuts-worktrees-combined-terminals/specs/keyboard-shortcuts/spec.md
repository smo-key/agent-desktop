## ADDED Requirements

### Requirement: Keyboard shortcuts are user-customizable

The application SHALL let the user rebind every app-level action shortcut — new session, new worktree session, create task, toggle Terminals panel, new terminal, cycle focus, show shortcuts, insert file path, next/previous agent, next/previous project filter, archive session, pause/resume session — from a `Keyboard shortcuts` section in Settings. A binding is a single key chord (one non-modifier key plus at least one of ⌘/⌃/⌥, or a function key); the shift modifier is part of the chord. Custom bindings SHALL persist in the `shortcuts` slice of `settings.json` and SHALL be applied by the live key handlers, so the recorded chord is what triggers the action. A chord already bound to another shortcut SHALL be refused with a hint naming the conflicting shortcut. Each shortcut SHALL be resettable to its default individually, and all at once. Fixed keys (Esc, bare `?`, the launcher's ⌘Enter, the in-terminal line-edit keys, the voice tap) are not rebindable.

#### Scenario: Default bindings apply with no customization
- **WHEN** no custom binding has been recorded
- **THEN** every shortcut resolves to its default chord (e.g. new session is ⌘N)

#### Scenario: Rebinding a shortcut changes what triggers it
- **WHEN** the user records ⌘⇧K for "new session"
- **THEN** ⌘⇧K matches the new-session shortcut and ⌘N no longer does

#### Scenario: A binding already used by another shortcut is refused
- **WHEN** the user records a chord that another shortcut currently uses
- **THEN** the binding is not changed and the conflicting shortcut is named

#### Scenario: Resetting a shortcut restores its default
- **WHEN** the user resets a customized shortcut
- **THEN** its default chord applies again and the override is dropped from the slice

#### Scenario: Custom bindings persist in the settings slice
- **WHEN** a binding is recorded
- **THEN** the `shortcuts` slice of `settings.json` is written with the override, and it is applied on the next launch

#### Scenario: Invalid persisted bindings are ignored
- **WHEN** the `shortcuts` slice holds a malformed override (missing key, unknown shortcut id, non-object)
- **THEN** that entry is ignored and the shortcut resolves to its default

#### Scenario: A chord without a modifier is not recordable
- **WHEN** the user presses a bare letter while recording
- **THEN** no binding is recorded

#### Scenario: Shortcut hints follow the custom binding
- **WHEN** a shortcut has been rebound
- **THEN** its tooltip / help-modal / menu hint shows the new chord (e.g. ⌘⇧K), not the default

## MODIFIED Requirements

### Requirement: Help modal lists every functional keyboard shortcut

The keyboard-shortcuts help modal SHALL render a registry that documents every
keyboard shortcut a user can actually trigger, showing each rebindable
shortcut's CURRENT chord (default or customized). The modal is opened via the
show-shortcuts shortcut (default `⌘/`), the bare `?` key when not typing into a
field, or the title-bar `?` button. Whenever a key binding is added, changed,
or removed in a handler, the registry SHALL be updated to match. Bindings whose
handler is permanently inert (e.g. gated behind a view state that never
activates) SHALL NOT be listed, since they cannot be triggered.

The insert-file-path binding SHALL default to `⌘O` (it opens the native file
picker and pastes the chosen path into the focused terminal). `⌘I` SHALL NOT
be bound to insert-file-path by default.

#### Scenario: Global shortcuts are listed
- **WHEN** the user opens the help modal
- **THEN** the Global section lists `⌘N` (new session), `⌘⇧N` (new session in a worktree), `⌘T` (create task), `⌘J` (toggle Terminals panel), `⌘Y` (new terminal), `⌘Tab` (cycle focus), `⌘/` and bare `?` (show shortcuts), and `Esc` (close dialog)

#### Scenario: Inbox shortcuts are listed
- **WHEN** the user opens the help modal
- **THEN** the Inbox section lists `⌘↓`/`⌘↑` (next/previous agent) and `⌘⇧↓`/`⌘⇧↑` (next/previous project filter)

#### Scenario: Session and launcher shortcuts are listed
- **WHEN** the user opens the help modal
- **THEN** the Session section lists `⌘W` (archive), `⌘.` (pause/resume), and `⌘O` (insert file path), and the Launcher section lists `⌘Enter` (confirm) and `Esc` (cancel)

#### Scenario: Inert grid-only bindings are not listed
- **WHEN** the user opens the help modal
- **THEN** the never-triggerable grid-only bindings (`⌘[`, `⌘]`, `Alt`+Arrow) do not appear

#### Scenario: Help modal reflects a custom binding
- **WHEN** the user has rebound new session to ⌘⇧K and opens the help modal
- **THEN** the new-session row shows ⌘⇧K
