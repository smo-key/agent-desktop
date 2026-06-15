## ADDED Requirements

### Requirement: Dropped files never replace the app

The app SHALL intercept OS file drops anywhere over its window so that the
WebView never navigates to a dropped file's `file://` URL. Under no circumstance
SHALL dropping a file replace the app content with the file.

#### Scenario: Dropping an image no longer hijacks the app

- **WHEN** the user drags an image file from the OS and drops it anywhere over the
  app window
- **THEN** the app remains rendered (no navigation to the file) — at worst nothing
  happens, at best the file is handed to a session per the rules below

#### Scenario: Dropping over non-session chrome does nothing

- **WHEN** the user drops a file over app chrome that is not a live session pane
  (e.g. the sidebar, footer, launcher, or empty area)
- **THEN** the app does not navigate and no file content is inserted anywhere

### Requirement: A dropped file targets the session under the cursor

On a file drop, the system SHALL resolve the live session pane located under the
drop position and act only on that pane. The drop position SHALL be mapped from
the native event's physical coordinates to CSS coordinates and resolved to the
nearest enclosing pane (its `data-pane-id`). When no live session pane is under
the cursor, the drop SHALL be a no-op.

#### Scenario: Drop lands on the pane under the pointer

- **WHEN** two sessions are visible and the user drops a file over the second one
- **THEN** the file is handed to the second session, not the first and not the
  focused session if different

#### Scenario: Drop with no session under the cursor

- **WHEN** the user drops a file where no live session pane is under the pointer
- **THEN** nothing is inserted into any session

### Requirement: Image files are handed over as inline image attachments

When the dropped paths include image files, for each image the system SHALL place
the image on the OS clipboard and send the `Ctrl+V` byte (`0x16`) to the target
session's PTY, so the agent ingests it as an inline image attachment rather than
as path text. Non-PNG images SHALL be re-encoded to PNG before being placed on
the clipboard. When multiple images are dropped together, they SHALL be pasted
sequentially (one clipboard image consumed per `Ctrl+V`).

#### Scenario: Dropping a PNG pastes it as an image

- **WHEN** the user drops a `.png` file onto a live session
- **THEN** the image is placed on the clipboard and `0x16` is written to that
  session's PTY, so the agent shows it as an inline image attachment (not a path)

#### Scenario: A non-PNG image is re-encoded before paste

- **WHEN** the user drops a `.jpg`/`.gif`/`.webp` image onto a live session
- **THEN** the image is re-encoded to PNG and placed on the clipboard before
  `0x16` is sent

#### Scenario: Multiple images are pasted one at a time

- **WHEN** the user drops several image files onto a live session at once
- **THEN** each image is placed on the clipboard and pasted via `0x16` in turn,
  not all at once

### Requirement: Non-image files are inserted as quoted absolute paths

When the dropped paths include non-image files, the system SHALL insert each
file's absolute path — wrapped in double quotes with shell-special characters
escaped — into the target session's terminal at the cursor, using the same
quoting and PTY-write path as the Insert Filename action. Multiple non-image
paths in one drop SHALL be inserted separated by single spaces. No trailing space
SHALL be appended.

#### Scenario: A dropped text file inserts its quoted path

- **WHEN** the user drops `/Users/me/notes.txt` onto a live session
- **THEN** the text `"/Users/me/notes.txt"` is written to that session's terminal
  at the cursor

#### Scenario: Shell metacharacters in a dropped path are neutralized

- **WHEN** a dropped non-image path contains `\`, `"`, `$`, or `` ` ``
- **THEN** each such character is backslash-escaped inside the surrounding quotes
  so the inserted text is a single inert shell token

#### Scenario: A mixed drop handles each kind appropriately

- **WHEN** the user drops a mix of image and non-image files onto a live session
- **THEN** the image files are pasted as image attachments and the non-image files
  are inserted as quoted paths

### Requirement: Drop-target affordance during drag-over

While a file is dragged over a live session pane, the system SHALL visually
indicate that pane as the drop target, and SHALL clear the indication when the
drag leaves it, is dropped, or moves to non-session chrome.

#### Scenario: Hovering a session during a drag highlights it

- **WHEN** the user drags a file over a live session pane without releasing
- **THEN** that pane shows a drop-target affordance

#### Scenario: Affordance clears when the drag leaves or ends

- **WHEN** the dragged file moves off the session pane, is dropped, or the drag
  ends
- **THEN** the drop-target affordance is removed

### Requirement: Existing drag-to-reorder is preserved

Enabling native drag-drop SHALL NOT remove the ability to reorder projects and
tasks by dragging one row onto another. The reorder interactions SHALL continue
to function with their existing behavior.

#### Scenario: Projects can still be reordered by dragging

- **WHEN** the user drags one project row onto another
- **THEN** the project list is reordered and persisted as before

#### Scenario: Tasks can still be reordered by dragging

- **WHEN** the user drags one task row onto another
- **THEN** the active project's task list is reordered and persisted as before
