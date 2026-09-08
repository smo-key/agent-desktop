# whats-new-dialog Specification

## Purpose
The in-app "What's new" dialog: shows the running version's CHANGELOG.md section once after an update and on demand from the Settings version label.

## Requirements
### Requirement: Release notes section lookup

The app SHALL bundle `CHANGELOG.md` at build time and SHALL resolve the notes for a version as the body of its `## <version>` section (a leading `v` on the version and any trailing text on the heading line are ignored), returning nothing when no such section exists. A dev build SHALL resolve to the newest section.

#### Scenario: Section found for the running version

- **WHEN** the changelog has a `## 0.4.0 — 2026-09-10` section and the running version is `0.4.0`
- **THEN** the resolved notes are that section's body up to the next `## ` heading, trimmed

#### Scenario: No section for the running version

- **WHEN** the changelog has no `## 0.4.1` section and the running version is `0.4.1`
- **THEN** no notes are resolved

#### Scenario: Dev build resolves the newest section

- **WHEN** the app runs under a dev server
- **THEN** the resolved notes are the first `## ` section of the changelog

#### Scenario: Matches v-prefixed and legacy bracketed headings

- **WHEN** a section heading is written as `## v1.0.0 — …` or the legacy `## [0.9.0] - …`
- **THEN** lookups for `1.0.0` / `v0.9.0` resolve it, and the newest-section version carries no `v` or brackets

### Requirement: Notes parsed into structured content

The app SHALL parse a section body into headings (`### …`) each holding bullet items, where an item's text is split into plain, bold, inline-code and link runs, so the dialog renders markup without injecting HTML.

#### Scenario: Headings bullets and bold parsed

- **WHEN** a section body contains `### New` followed by `- **Auto update**: installs on restart`
- **THEN** the parsed result has one heading "New" with one item whose runs are bold "Auto update" followed by plain ": installs on restart"

#### Scenario: Bullets before any heading

- **WHEN** a section body has bullets before its first `### ` heading
- **THEN** they are grouped under an unnamed heading

#### Scenario: Keeps a wrapped bullet as one item, lazily or indented, until a blank line

- **WHEN** a bullet's text continues on following lines, indented or not
- **THEN** the continuation lines join the bullet until a blank line, and a bare `- ` yields no item

### Requirement: Dialog opens once after an update

On launch the app SHALL compare the running version with the `whatsNew.seenVersion` settings slice and, when they differ and notes exist for the running version, open the What's new dialog and record the running version as seen. A fresh install (no seen version and an empty settings object) SHALL record the version without opening the dialog. A dev build SHALL never auto-open the dialog. When no notes exist for the version, the version is recorded and nothing opens.

#### Scenario: First launch after an update

- **WHEN** the app launches at version `0.4.0`, the seen version is `0.3.2`, and the changelog has a `0.4.0` section
- **THEN** the dialog opens showing the `0.4.0` notes and `0.4.0` is saved as the seen version

#### Scenario: Already seen

- **WHEN** the app launches at version `0.4.0` and the seen version is `0.4.0`
- **THEN** the dialog does not open and nothing is saved

#### Scenario: Fresh install stays quiet

- **WHEN** the app launches with no seen version and an empty settings object
- **THEN** the dialog does not open and the running version is saved as seen

#### Scenario: Existing user upgrading into the feature

- **WHEN** the app launches with no seen version but other settings present, and notes exist for the running version
- **THEN** the dialog opens and the running version is saved as seen

#### Scenario: Dev build never auto-opens

- **WHEN** the app runs under a dev server
- **THEN** the launch check neither opens the dialog nor saves a seen version

#### Scenario: Held back while onboarding is up

- **WHEN** the launch check opens the dialog while the first-launch model gate is showing
- **THEN** the dialog is not rendered until the gate is dismissed, and then appears

#### Scenario: No notes for the new version

- **WHEN** the seen version differs from the running version and the changelog has no section for it
- **THEN** the dialog does not open and the running version is saved as seen

### Requirement: Version label reopens the dialog

The version label in Settings (the footer and the update row) SHALL be a button that opens the What's new dialog for the running version at any time, including in a dev build (which shows the newest section).

#### Scenario: Click the version number

- **WHEN** the user clicks the version label in Settings
- **THEN** the What's new dialog opens with the running version's notes

#### Scenario: Dialog owns the keyboard while open

- **WHEN** the dialog is open and the user presses an app shortcut (e.g. ⌘N) or Escape with focus anywhere
- **THEN** the shortcut does not fire beneath it and Escape closes it; if it was opened over Settings, focus returns to the Settings dialog

#### Scenario: Dialog closes

- **WHEN** the dialog is open and the user presses Escape, clicks the backdrop, or activates "Got it"
- **THEN** the dialog closes
