# agent-roster-display Specification

## Purpose
TBD - created by archiving change agent-session-ux-improvements. Update Purpose after archive.
## Requirements
### Requirement: The status line always shows the last message or question

The agent-card status sub-line SHALL show, in priority order: the agent's pending
question (the structured question text when present, else the compact question),
else the agent's last assistant message, else a short generic status word. This
SHALL apply to ALL lanes, INCLUDING archived (closed) agents — an archived row
SHALL show its last message or question rather than a generic archived hint.
Restore and delete actions remain available via the row's context menu.

#### Scenario: A pending question is shown
- **WHEN** an agent needs input and has a pending question
- **THEN** the status line shows the question text (not the generic "Needs input")

#### Scenario: The last message is shown when there is no pending question
- **WHEN** an agent needs input, has no pending question, and has a last assistant message
- **THEN** the status line shows that last assistant message

#### Scenario: Archived agents show their last message or question
- **WHEN** an archived (closed) agent is rendered in the archived lane
- **THEN** its status line shows its last message or pending question, not a generic "Archived" hint

#### Scenario: Generic fallback only when nothing is available
- **WHEN** an agent has neither a pending question nor any last assistant message yet
- **THEN** the status line falls back to a short generic word appropriate to its state

### Requirement: The agent card shows the model, not the cost

An agent card SHALL display the agent's MODEL — a human-readable, versioned label
such as "Opus 4.6", derived from the latest snapshot's model id and falling back to
the snapshot's model display name — in place of a dollar cost. The card SHALL NOT show
the per-agent dollar amount (cost remains tracked and surfaced in the aggregate total).

#### Scenario: Card shows the versioned model label
- **WHEN** an agent card renders for an agent whose latest snapshot has a model
- **THEN** the card shows the versioned model label (e.g. "Opus 4.6") and not a dollar amount

#### Scenario: Falls back to the display name
- **WHEN** the snapshot's model id cannot be parsed into a versioned label
- **THEN** the card shows the snapshot's model display name

#### Scenario: No per-agent cost on the card
- **WHEN** an agent card renders
- **THEN** no per-agent dollar cost is shown on the card

### Requirement: The agent card hides context until a size is known

An agent card SHALL show the context-window measure (the mini-bar and percent) ONLY
when a context size is actually known for that agent. WHEN the agent has no context
percentage yet (the value is unknown/null — e.g. a just-spawned agent whose first
snapshot has not landed), the card SHALL OMIT the context bar and percent entirely
rather than render a placeholder dash or an empty/striped bar. Archived, previewed,
and paused agents continue to omit the context measure as before.

#### Scenario: Context shown once known
- **WHEN** an agent card renders for a live agent whose context percentage is known
- **THEN** the card shows the context mini-bar and percent

#### Scenario: Context hidden when unknown
- **WHEN** an agent card renders for an agent that has no context percentage yet (unknown/null)
- **THEN** the card shows neither the context bar nor a percent (no placeholder dash or empty bar)

### Requirement: Buckets default to most-recently-added-first and are reorderable
Each roster bucket (Needs you, In flight, Paused, Archived) SHALL list its agents
with the most recently added to THAT bucket first: an agent that newly enters a
bucket SHALL appear at the TOP of it. A user-arranged (dragged) order SHALL be kept
for the agents already in the bucket; a new arrival SHALL still land on top without
disturbing the order below it, and an agent that leaves a bucket SHALL drop out
while the rest keep their order. A bucket that is momentarily empty (e.g. while the
layout restore is still loading) SHALL retain its remembered order rather than
discard it.

The Needs-you and Paused buckets SHALL be manually reorderable by dragging a row
onto another row in the SAME bucket, moving the dragged agent to the drop target's
slot. The manual order for these two buckets SHALL persist across restarts (keyed
by pane id); the In-flight and Archived buckets are most-recently-added-first only
(not hand-reorderable).

As a consequence, the Needs-you queue is ordered newest-first; the auto-advance and
queue-step behavior is unchanged (it follows the queue order — top is "next").

#### Scenario: Default order is most recently added to the column first
- **WHEN** a bucket's display order is reconciled against the agents currently in it
- **THEN** an agent newly in the bucket is placed at the top, above the existing order, and the order otherwise reflects most-recently-added-first

#### Scenario: A manual order is preserved as agents enter and leave the column
- **WHEN** the user has dragged a bucket into a custom order and the roster recomputes
- **THEN** the custom order of the still-present agents is preserved, a newly-arrived agent jumps to the top without disturbing it, and an agent that left the bucket is dropped

#### Scenario: An empty column keeps its remembered order (restart-safe, never wiped)
- **WHEN** a bucket has no current members (e.g. the roster is briefly empty while the layout restore is in flight)
- **THEN** the bucket's remembered order is retained (not cleared or persisted as empty), so the saved arrangement is restored when its agents reappear

#### Scenario: Dragging an agent moves it to the drop target within its bucket
- **WHEN** an agent in the Needs-you or Paused bucket is dragged and dropped onto another agent in the same bucket
- **THEN** the dragged agent is moved to the drop target's position within that bucket and the new order is persisted
- **AND** a drop onto itself, or onto an agent in a different bucket, makes no change

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

### Requirement: Compact mode hides the roster row's meta line

The sessions panel SHALL offer a density preference, exposed in Settings as a
"Default" / "Compact" / "Minimal" dropdown shown as the FIRST setting, and
persisted across restarts. The preference SHALL default to "Default". WHEN
"Compact" is selected, every roster row SHALL omit its third content line — the
meta line carrying the context-window measure, the model label, and the time
since last activity — leaving the title and status sub-line. WHEN "Minimal" is
selected, every roster row SHALL keep only its title beside a smaller project
icon, omitting both the status sub-line and the meta line. WHEN "Default" is
selected (the default), rows SHALL render all three lines as before. A legacy
persisted `{ enabled: true }` compact-mode slice SHALL be read as "Compact".

#### Scenario: Compact mode hides the meta line

- **WHEN** a roster row renders while compact mode is enabled
- **THEN** the row shows its title and status sub-line but not the
  context/model/time meta line

#### Scenario: Minimal density keeps only the title and a smaller icon

- **WHEN** a roster row renders while the density is "Minimal"
- **THEN** the row shows its title beside a project icon smaller than the
  Default/Compact icon, and neither the status sub-line nor the meta line

#### Scenario: Full rows by default

- **WHEN** a roster row renders while compact mode is disabled (the default)
- **THEN** the row shows the context/model/time meta line as its third line

#### Scenario: The preference persists and defaults to Default

- **WHEN** the app loads on a fresh install with no stored density preference
- **THEN** the density is "Default" and rows render all three lines, and a user's
  later "Compact" or "Minimal" selection is restored on the next launch

#### Scenario: A legacy boolean compact-mode slice reads as Compact

- **WHEN** the persisted `compactMode` slice is the pre-density `{ enabled: true }`
  shape with no `density` field
- **THEN** the density resolves to "Compact", and `{ enabled: false }` or an
  unknown `density` value resolves to "Default"

### Requirement: Keyboard navigation reveals the selected session

When keyboard navigation changes the selected session, the system SHALL scroll the selected row into view within the session list when it is not already fully visible, so the selection never moves out of sight. A selection that is already fully visible SHALL NOT be scrolled. The reveal SHALL apply to the selected row in any lane.

#### Scenario: Stepping to an off-screen session scrolls it into view
- **WHEN** the user steps the session selection with the keyboard to an agent whose row is below or above the visible portion of the list
- **THEN** the list scrolls so the newly-selected row is brought into view

#### Scenario: An already-visible selection is not scrolled
- **WHEN** keyboard navigation selects a session whose row is already fully visible in the list
- **THEN** the list scroll position is left unchanged

### Requirement: Navigating to a hidden archived session expands the Archived lane

When keyboard navigation selects an archived session hidden beyond the Archived lane's collapsed preview, the system SHALL expand the Archived lane (equivalent to "Show all") so the selected row is rendered and can be revealed. The expansion SHALL be one-way (the lane is not auto-collapsed afterward), and SHALL occur only while the lane is collapsed and the selected archived row sits beyond the preview. The auto-expansion SHALL fire only on a change of selection, so that the user can still manually collapse the lane afterward without it immediately re-expanding while the same archived row remains selected.

#### Scenario: Selecting a hidden archived session shows all archived rows
- **WHEN** the Archived lane is collapsed to its preview and keyboard navigation selects an archived session beyond that preview
- **THEN** the Archived lane expands to show all archived rows and the selected row is then revealed in the list

#### Scenario: Selecting a previewed archived session does not change expansion
- **WHEN** keyboard navigation selects an archived session that is already within the collapsed preview
- **THEN** the Archived lane's expansion state is unchanged

#### Scenario: Navigating away does not re-collapse the lane
- **WHEN** the Archived lane was auto-expanded by navigation and the selection then moves to a non-archived session
- **THEN** the Archived lane stays expanded (the reveal is one-way)

#### Scenario: Manually collapsing after an auto-expand stays collapsed
- **WHEN** the Archived lane was auto-expanded because a hidden archived session is selected, and the user then manually collapses the lane without changing the selection
- **THEN** the Archived lane stays collapsed (the auto-expansion does not re-fire for the still-selected row)

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
