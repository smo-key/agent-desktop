## ADDED Requirements

### Requirement: Project Git State Is Shown In The Footer

A project's git state SHALL be surfaced in the app footer's left zone, before the
usage-limit bars, as a single always-visible indicator showing the current
branch, commits ahead/behind its upstream, and the count of modified files (each
shown even at zero). The indicator SHALL reflect the FOLDER git
of the focused pane's project; when no pane is focused (e.g. in the overview) it
SHALL fall back to the project currently selected in the project pane, and show
no project git when that selection is a non-project bucket (All agents / no
project). The git state SHALL NOT be rendered on the individual project-pane rows,
which carry only the project's icon, name, attention dot, and agent count.

#### Scenario: Footer shows the focused pane's project git
- **WHEN** a pane whose project folder is on branch `main`, 2 commits ahead with 3
  modified files, is focused
- **THEN** the footer's left zone shows that branch, ahead/behind, and modified
  count before the usage-limit bars.

#### Scenario: Footer falls back to the panel selection in the overview
- **WHEN** no pane is focused and the project pane has a concrete project selected
- **THEN** the footer shows that selected project's folder git.

#### Scenario: No project git for a non-project selection
- **WHEN** no pane is focused and the project pane's selection is the "All agents"
  or "no project" bucket
- **THEN** the footer shows no project git indicator content for a project.

#### Scenario: Project rows carry no git line
- **WHEN** the project pane renders its project rows
- **THEN** each row shows only the project icon, name, an attention dot when
  applicable, and the agent count — and no git status line.
