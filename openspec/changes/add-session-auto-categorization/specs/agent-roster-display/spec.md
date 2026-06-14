# agent-roster-display Specification (delta)

## ADDED Requirements

### Requirement: Categories replace the panel grouping when enabled

WHEN auto-categorization is enabled, the sessions panel's top-level grouping SHALL
be, in order: a system **Working** group (every agent currently deterministically
`working` / streaming), then the user's **categories in their configured order**
(each holding the idle / done-responding agents assigned to it), then the system
**Paused** and **Archived** groups. An agent that has not yet been classified SHALL
appear under the fallback category. Each category group's header SHALL show that
category's `label` and its row indicator (dot) SHALL use that category's `color`. An
agent that is deterministically `working` SHALL render in Working regardless of any
stored category (live status takes precedence), and SHALL move into a category only
after it next finishes responding. A paused or archived agent SHALL render in Paused
or Archived regardless of any stored category. WHEN auto-categorization is disabled,
the deterministic lanes (Needs you / In flight / Paused / Archived) SHALL render
unchanged.

#### Scenario: Enabled panel groups by Working, categories, Paused, Archived
- **WHEN** the feature is enabled and the roster contains streaming, idle/done, paused, and archived agents
- **THEN** the panel shows Working first, then each user category in order, then Paused, then Archived

#### Scenario: Category headers and dots use the user's label and color
- **WHEN** a category group renders
- **THEN** its header shows the category's label and its rows' status dots use the category's color

#### Scenario: A streaming agent stays in Working regardless of its stored category
- **WHEN** an agent that was assigned a category begins streaming again (deterministically `working`)
- **THEN** it renders under Working until it next finishes responding, then moves into a category

#### Scenario: An unclassified agent shows under the fallback category
- **WHEN** an idle/done agent has no category assignment yet
- **THEN** it renders under the fallback category

#### Scenario: Disabled grouping is unchanged
- **WHEN** the feature is disabled
- **THEN** the panel renders the deterministic Needs you / In flight / Paused / Archived lanes exactly as before

### Requirement: Sessions can be dragged between lanes

WHEN auto-categorization is enabled, the user SHALL be able to drag a session row
onto a different group at any time. Dropping a row onto a **category** SHALL assign
that category as a **one-time manual override** that holds until the session's next
finished response, at which point the on-device model re-categorizes it. Dropping a
row onto **Paused** SHALL perform the existing pause action, and dropping onto
**Archived** SHALL perform the existing archive (close) action; dragging a paused or
archived row onto a category SHALL restore the session (resume / un-archive) and
apply the one-time category assignment. The system **Working** group SHALL NOT be a
drop target — a session SHALL NOT be draggable INTO Working (Working is
system-derived); a session MAY be dragged OUT of Working onto Paused or Archived.

#### Scenario: Dropping on a category is a one-time manual override
- **WHEN** the user drags a session onto a category
- **THEN** the session is assigned that category until its next finished response, when the model re-categorizes it

#### Scenario: Dropping on Paused or Archived performs that action
- **WHEN** the user drags a session onto the Paused group or the Archived group
- **THEN** the session is paused or archived respectively, using the existing actions

#### Scenario: Dragging a parked session onto a category restores it
- **WHEN** the user drags a paused or archived session onto a category
- **THEN** the session is resumed / un-archived and assigned that category as a one-time override

#### Scenario: Working is not a drop target
- **WHEN** the user attempts to drag a session into the Working group
- **THEN** the drop is rejected and no assignment is made

#### Scenario: A working session can still be dragged out to Paused or Archived
- **WHEN** the user drags a currently-working session onto Paused or Archived
- **THEN** the pause or archive action is performed
