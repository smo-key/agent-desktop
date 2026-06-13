## MODIFIED Requirements

### Requirement: Help modal lists every functional keyboard shortcut

The keyboard-shortcuts help modal SHALL render a registry that documents every
keyboard shortcut a user can actually trigger. The modal is opened via `⌘/`, the
bare `?` key when not typing into a field, or the title-bar `?` button. Whenever a
key binding is added, changed, or removed in a handler, the registry SHALL be
updated to match. Bindings whose handler is permanently inert (e.g. gated behind a
view state that never activates) SHALL NOT be listed, since they cannot be
triggered.

The insert-file-path binding SHALL be `⌘O` (it opens the native file picker and
pastes the chosen path into the focused terminal). `⌘I` SHALL NOT be bound to
insert-file-path.

#### Scenario: Global shortcuts are listed
- **WHEN** the user opens the help modal
- **THEN** the Global section lists `⌘N` (new session), `⌘P` (open Search), `⌘T` (create task), `⌘J` (toggle Terminals panel), `⌘Y` (new terminal), `⌘Tab` (cycle focus), `⌘/` and bare `?` (show shortcuts), and `Esc` (close dialog)

#### Scenario: Inbox shortcuts are listed
- **WHEN** the user opens the help modal
- **THEN** the Inbox section lists `⌘↓`/`⌘↑` (next/previous agent) and `⌘⇧↓`/`⌘⇧↑` (next/previous project filter)

#### Scenario: Session and launcher shortcuts are listed
- **WHEN** the user opens the help modal
- **THEN** the Session section lists `⌘W` (archive), `⌘.` (pause/resume), and `⌘O` (insert file path), and the Launcher section lists `⌘Enter` (confirm) and `Esc` (cancel)

#### Scenario: Inert grid-only bindings are not listed
- **WHEN** the user opens the help modal
- **THEN** the never-triggerable grid-only bindings (`⌘[`, `⌘]`, `Alt`+Arrow) do not appear
