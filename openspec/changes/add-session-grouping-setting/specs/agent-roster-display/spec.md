## ADDED Requirements

### Requirement: The roster grouping is user-selectable

The sessions panel SHALL offer a grouping preference, exposed in Settings under
"Sessions panel" as a "Group by" dropdown with the options "Status" (the
default), "Date", and "None", persisted across restarts in the `sessionGrouping`
settings slice. WHEN "Status" is selected, the live sessions SHALL be grouped into
the Needs-you / In-flight / Paused lanes exactly as before. WHEN "Date" is
selected, the live sessions SHALL be grouped by their last-activity time into
"Today", "Yesterday", "Last 7 days", and "Older" sections on local calendar days,
newest first within each section, with a session whose activity time is unknown
counted as newest (Today). WHEN "None" is selected, the live sessions SHALL render
as one flat list with no section headers, newest activity first (a bare divider,
with no title, MAY separate it from a preceding "Pinned" section). In EVERY mode,
pinned sessions SHALL render first in their own "Pinned" section and archived
sessions SHALL render last under the "Archived" header with its existing
collapse / "Show all" toggle and "Delete all" action. The roster's view order
(followed by the attention queue, auto-advance, and keyboard stepping) SHALL
match the rendered order in every mode. A malformed or missing stored preference
SHALL resolve to "Status".

#### Scenario: Status grouping is the default and matches the lanes

- **WHEN** the app loads on a fresh install with no stored grouping preference
- **THEN** the grouping is "Status" and the live sessions render in the
  Needs-you / In-flight / Paused lanes in their existing order

#### Scenario: Date grouping buckets sessions by local calendar day

- **WHEN** the grouping is "Date" and the roster holds live sessions last active
  today, yesterday, four days ago, and twenty days ago
- **THEN** they render under "Today", "Yesterday", "Last 7 days", and "Older"
  respectively, in that section order, newest first within each section

#### Scenario: A session with no activity time groups as newest

- **WHEN** the grouping is "Date" and a live session has no known last-activity
  time
- **THEN** it renders in the "Today" section ahead of the timestamped sessions

#### Scenario: None renders a flat list without headers

- **WHEN** the grouping is "None"
- **THEN** the live sessions render as a single list with no section headers,
  ordered newest activity first

#### Scenario: Pinned stay on top and archived at the bottom in every mode

- **WHEN** the roster holds pinned, live, and archived sessions in any grouping
  mode
- **THEN** the pinned sessions render first in the "Pinned" section, the archived
  sessions render last under "Archived", and neither appears in the mode's body
  sections

#### Scenario: Empty groups are omitted

- **WHEN** a grouping mode would produce a section with no sessions
- **THEN** that section (and its header) is not rendered

#### Scenario: The view order follows the rendered grouping

- **WHEN** the grouping mode changes
- **THEN** the roster's view order (used by the attention queue and keyboard
  stepping) is the concatenation of the rendered sections in display order

#### Scenario: The grouping preference persists and normalizes

- **WHEN** the user selects "Date" or "None" in Settings and relaunches the app
- **THEN** that grouping is restored, and a missing or malformed stored value
  resolves to "Status"

## MODIFIED Requirements

### Requirement: Sessions can be pinned to the top of the roster

The sessions panel SHALL let the user pin any session so it renders in a
"Pinned" group above every other section, regardless of its status and of the
selected grouping mode, in most-recently-pinned-first order. A pinned row SHALL
keep its lane accent and status dot and SHALL show a pin glyph before its title.
Every row's context menu SHALL offer "Pin to top" when the session is unpinned
and "Unpin" when it is pinned. Pinned rows SHALL lead the roster's view order, so
the attention queue and keyboard stepping visit them first. Deleting a session
for good SHALL drop it from the pinned list.

#### Scenario: Pinned sessions render above every lane in pin order

- **WHEN** the roster renders with one or more pinned sessions present
- **THEN** those sessions appear in a "Pinned" group above every other section,
  ordered most recently pinned first, and are absent from the body sections

#### Scenario: Pin and unpin from the row context menu

- **WHEN** the user right-clicks a session row
- **THEN** the menu offers "Pin to top" for an unpinned session and "Unpin" for
  a pinned one, and choosing it toggles the session's pinned state

#### Scenario: A deleted session is unpinned

- **WHEN** a pinned session is deleted for good (row Delete, Delete all
  archived, or auto-delete of an empty finished session)
- **THEN** its id is removed from the pinned list
