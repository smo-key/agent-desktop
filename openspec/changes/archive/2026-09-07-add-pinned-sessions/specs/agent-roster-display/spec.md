## ADDED Requirements

### Requirement: Sessions can be pinned to the top of the roster

The sessions panel SHALL let the user pin any session so it renders in a
"Pinned" group above every lane, regardless of its status, in most-recently-
pinned-first order. A pinned row SHALL keep its lane accent and status dot and
SHALL show a pin glyph before its title. Every row's context menu SHALL offer
"Pin to top" when the session is unpinned and "Unpin" when it is pinned. Pinned
rows SHALL lead the roster's view order, so the attention queue and keyboard
stepping visit them first. Deleting a session for good SHALL drop it from the
pinned list.

#### Scenario: Pinned sessions render above every lane in pin order

- **WHEN** the roster renders with one or more pinned sessions present
- **THEN** those sessions appear in a "Pinned" group above the Needs-you lane,
  ordered most recently pinned first, and are absent from their status lanes

#### Scenario: Pin and unpin from the row context menu

- **WHEN** the user right-clicks a session row
- **THEN** the menu offers "Pin to top" for an unpinned session and "Unpin" for
  a pinned one, and choosing it toggles the session's pinned state

#### Scenario: A deleted session is unpinned

- **WHEN** a pinned session is deleted for good (row Delete, Delete all
  archived, or auto-delete of an empty finished session)
- **THEN** its id is removed from the pinned list
