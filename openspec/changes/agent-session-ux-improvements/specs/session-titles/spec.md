## ADDED Requirements

### Requirement: User can rename a session

The user SHALL be able to set a CUSTOM title for a session in two ways: by clicking
the session title in the focus-pane header (inline edit), and via a "Rename" item
in the agent card's context menu. A custom title SHALL be displayed in place of the
auto-generated title and SHALL persist across restart / resume. Once a session has
a custom title, automatic title generation SHALL STOP for that session — the custom
title is sticky and SHALL NEVER be overwritten by later messages.

#### Scenario: Rename via the header title
- **WHEN** the user clicks the session title in the focus-pane header, edits it, and commits (Enter or blur)
- **THEN** the session shows the custom title; pressing Esc instead cancels the edit and keeps the prior title

#### Scenario: Rename via the context menu
- **WHEN** the user chooses "Rename" from the agent card's context menu and commits a new title
- **THEN** the session shows the custom title

#### Scenario: Custom title persists across restart and resume
- **WHEN** a session has a custom title and the app is restarted or the session is resumed
- **THEN** the session still shows its custom title

#### Scenario: Auto-generation does not overwrite a custom title
- **WHEN** a session has a custom title and the user sends further messages
- **THEN** the title is not re-generated; the custom title remains

### Requirement: Auto-titles refresh after each user message

For sessions WITHOUT a custom (manual) title, the auto-generated title SHALL be
re-derived promptly after each new user message — gated on the transcript's
user-message hash changing — rather than only after a long throttle window. A small
floor throttle MAY be retained to avoid re-deriving mid-stream, but a new user
message SHALL trigger a fresh title.

#### Scenario: New user message refreshes the title
- **WHEN** the user sends a new message in a session that has no custom title (its user-message hash changes)
- **THEN** a fresh title is requested for that session

#### Scenario: No change means no refresh
- **WHEN** the user's messages have not changed (the user-message hash is unchanged)
- **THEN** no new title is requested

#### Scenario: A custom-titled session is not refreshed
- **WHEN** a session has a custom (manual) title and the user sends a new message
- **THEN** no automatic title is requested for that session

### Requirement: Auto-titles reflect the whole session, weighted to the original request

Auto-generated session titles SHALL be derived from the user's messages across the
WHOLE session — not just the most recent message — and SHALL give more weight to the
user's EARLIER messages, where the session's original request usually appears. The
earliest user message(s) SHALL ALWAYS be included in the model input even in a long
session (the original request SHALL NOT be dropped by recency-based truncation), and
recent messages SHALL also be included so a genuinely new later request can still be
reflected. A later message SHALL shift the title's focus only when it clearly
introduces a new top-level task, not for incidental refinements or follow-ups.

#### Scenario: The original request survives a long session
- **WHEN** a session has more user messages than fit the bounded model input
- **THEN** the earliest user message(s) carrying the original request are still included in the title input (they are not dropped by recency-based truncation)

#### Scenario: Early request outweighs an incidental recent message
- **WHEN** the early messages state the main task and the latest messages are incidental refinements or follow-ups
- **THEN** the generated title reflects the original request rather than only the most recent message

#### Scenario: A genuinely new later task can take over
- **WHEN** a later message clearly introduces a new, distinct top-level task
- **THEN** the title may reflect that new task

#### Scenario: A short session considers all its messages
- **WHEN** a session has only a few user messages (within the bound)
- **THEN** all of them are considered when generating the title
