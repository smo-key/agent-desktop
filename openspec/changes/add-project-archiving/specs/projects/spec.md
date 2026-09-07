## ADDED Requirements

### Requirement: Archive And Unarchive A Project

A project SHALL carry an optional `archived` boolean, persisted with the project list in `projects.json`; a missing or non-boolean value SHALL be treated as `false` (active). The user SHALL be able to archive an active project from its row's right-click context menu (**Archive project**) and to unarchive an archived project from its row's context menu (**Unarchive**). Both flip only the flag: the project keeps its id, position, name, icon, color, logo, and folder, so agents bound to it stay bound. Archiving is reversible and SHALL NOT require confirmation. If the archived project is the current project filter, the filter SHALL fall back to "All agents".

#### Scenario: Archiving a project marks it archived and persists
- **WHEN** the user picks **Archive project** on an active project
- **THEN** that project's record gains `archived: true` in the same list position, and the list is persisted

#### Scenario: Unarchiving a project restores it in place
- **WHEN** the user picks **Unarchive** on an archived project
- **THEN** the project's `archived` flag is cleared, it keeps its id and list position, and the list is persisted

#### Scenario: A missing archived flag parses as active
- **WHEN** a persisted `projects.json` record has no `archived` field (or a non-boolean one)
- **THEN** the project loads as active, and serializing it again writes no `archived: true`

#### Scenario: Archiving the selected project resets the filter to All agents
- **WHEN** the project being archived is the currently selected project filter
- **THEN** the selection becomes "All agents"; archiving any other project leaves the selection unchanged

### Requirement: Archived Projects Are Hidden From Active Surfaces

Archived projects SHALL be omitted from the project pane's project rows and collapsed icon rail, from the launcher's project picker, from the ⌘⇧↑/↓ project-filter cycle, and from the project git status poll and background remote fetch. Agents bound to an archived project SHALL keep their project id, avatar, and count under "All agents", and SHALL NOT be counted in the "No project" bucket. The expanded project pane SHALL render a **Show archived (N)** button directly below **New project** whenever at least one project is archived; toggling it reveals an "Archived" section listing the archived projects (in list order, visually muted), and the button reads **Hide archived** while shown. An archived row can still be selected as the filter. Its context menu offers **Unarchive** and **Delete project** only.

#### Scenario: Archived projects are omitted from the active list
- **WHEN** the project list holds active and archived projects
- **THEN** the active-projects view contains only the projects whose `archived` flag is not `true`, in their original order

#### Scenario: Keyboard cycling skips archived projects
- **WHEN** the ⌘⇧↑/↓ filter order is built from a list containing archived projects
- **THEN** the order is "All agents", the active projects in list order, then the "No project" bucket when applicable — with no archived project id

#### Scenario: Agents bound to an archived project stay bound and counted
- **WHEN** an agent's registry entry names a project that is archived
- **THEN** the agent still counts toward "All agents" and toward that project's own count, and does not count toward the "No project" bucket

#### Scenario: Show archived reveals archived projects below New project
- **WHEN** at least one project is archived and the user clicks **Show archived (N)** below **New project**
- **THEN** an "Archived" section lists the archived projects, the button reads **Hide archived**, and no button is rendered at all when nothing is archived

#### Scenario: Archived projects are absent from the launcher picker
- **WHEN** the launcher's project picker opens while some projects are archived
- **THEN** only active projects are listed

#### Scenario: Git polling skips archived project folders
- **WHEN** the project git status poll or background fetch runs
- **THEN** only active projects' folders are probed or fetched
