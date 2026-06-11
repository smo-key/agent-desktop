## ADDED Requirements

### Requirement: The coordinator can be archived or deleted

The project coordinator SHALL follow the same archive/delete rules as ordinary
sessions instead of being delete-only. Its context menu SHALL offer Archive (for a
non-empty coordinator) and Delete. A non-empty coordinator (it has user messages)
SHALL be ARCHIVED — retained and restorable — when its archive action is invoked.
An EMPTY coordinator (no user messages) SHALL be DELETED outright when its archive
action is invoked, following the same empty-session rule as other sessions. An
archived coordinator SHALL be deletable.

A project SHALL have AT MOST ONE coordinator at a time. While a project's coordinator
is archived, invoking "Start coordinator" SHALL RESTORE that archived coordinator
(resuming its prior context) rather than create a SECOND coordinator. To start a
fresh coordinator, the archived one must first be deleted.

#### Scenario: Archiving a non-empty coordinator retains it
- **WHEN** the user archives a coordinator that has user messages
- **THEN** the coordinator is closed and retained in the archived lane (not deleted), and can be restored later

#### Scenario: Archiving an empty coordinator deletes it
- **WHEN** the user invokes the archive action on a coordinator with no user messages
- **THEN** the coordinator is deleted outright (nothing to resume), like any empty session

#### Scenario: Deleting an archived coordinator removes it
- **WHEN** the user deletes an archived coordinator
- **THEN** the coordinator session is removed entirely

#### Scenario: Restoring an archived coordinator makes it live again
- **WHEN** the user restores an archived coordinator
- **THEN** it resumes as the project's live coordinator and the "Start coordinator" affordance is no longer shown for that project

#### Scenario: Archiving the coordinator re-offers Start coordinator
- **WHEN** the coordinator is archived (so no live coordinator exists for the project)
- **THEN** the project again offers "Start coordinator"

#### Scenario: Starting restores the archived coordinator instead of duplicating it
- **WHEN** a project's coordinator is archived and the user invokes "Start coordinator"
- **THEN** the archived coordinator is restored as the live coordinator and no second coordinator is created (the project still has exactly one coordinator)
