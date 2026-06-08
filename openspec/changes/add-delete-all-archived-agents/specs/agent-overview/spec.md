# agent-overview Specification (delta)

## ADDED Requirements

### Requirement: Delete All Archived Agents

The overview's Archived lane SHALL offer an action to delete ALL archived agents at
once, available only when at least one agent is archived. Activating it SHALL first
present a confirmation dialog that names how many archived agents will be removed and
warns that the deletion is permanent. The archived agents SHALL be deleted only if
the user confirms; cancelling the dialog (including via Esc or dismissing it) SHALL
leave every agent untouched.

On confirmation, every agent shown in the Archived lane SHALL be permanently removed
the same way a single archived agent is deleted — its session and pane are gone and
the deletion persists across restart — and the current selection SHALL be cleared if
it pointed at one of the removed agents. The action SHALL affect only archived
agents; agents in other lanes (live, paused, needs-you) SHALL be left untouched.

#### Scenario: Deleting all archived agents after confirming

- **WHEN** there are archived agents and the user activates "delete all archived" and
  confirms the dialog
- **THEN** every archived agent is permanently removed from the overview and the
  workspace, and the change persists

#### Scenario: Cancelling the confirmation keeps the archived agents

- **WHEN** the user activates "delete all archived" but cancels the confirmation
  dialog
- **THEN** no archived agent is deleted and the Archived lane is unchanged

#### Scenario: The action targets only archived agents

- **WHEN** the user confirms "delete all archived" while live, paused, or needs-you
  agents also exist
- **THEN** only the archived agents are removed; agents in the other lanes are left
  running and untouched

#### Scenario: The action is hidden when nothing is archived

- **WHEN** the overview has no archived agents
- **THEN** no "delete all archived" action is shown
