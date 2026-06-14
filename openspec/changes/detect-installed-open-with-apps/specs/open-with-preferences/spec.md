## MODIFIED Requirements

### Requirement: Preferences are editable in a Settings dialog

The app SHALL provide a Settings dialog, opened from a gear button in the top-right of the title bar, that lets the user choose the application for each category. Each category SHALL offer "System Default", the applications from a curated list that are **detected as installed** on the system, the category's currently-configured application (even if it is no longer detected as installed), and a custom application name. Each offered application — and the "System Default" and custom-name entries — SHALL display an accompanying icon. Changes SHALL take effect for subsequent opens without restarting the app.

#### Scenario: Opening the dialog

- **WHEN** the user clicks the title-bar settings (gear) button
- **THEN** the Settings dialog opens showing the current per-category preferences

#### Scenario: Choosing an application

- **WHEN** the user selects an application (or "System Default", or a custom name) for a category and closes the dialog
- **THEN** subsequent opens of files in that category use the new preference

#### Scenario: Dismissing the dialog

- **WHEN** the user presses Escape, clicks the backdrop, or clicks the close button
- **THEN** the dialog closes

#### Scenario: Only installed applications are offered

- **WHEN** a category's dropdown is opened and only some curated applications are detected as installed
- **THEN** the dropdown lists "System Default", only the installed applications (each with an icon) in their curated order, and "Custom…" — applications that are not detected are absent

## ADDED Requirements

### Requirement: Installed-application detection

The app SHALL detect which curated candidate applications are installed and use that to filter each category's offered applications. Detection probes the standard macOS application directories for each candidate's `<name>.app` bundle; on a non-macOS or non-Tauri context detection yields no applications. The filtered list SHALL preserve the curated order, SHALL always retain a category's currently-configured application even when it is not detected (so a saved preference is never silently dropped), and SHALL treat an empty detection result as "no curated applications offered" (only "System Default", the saved app if any, and "Custom…" remain).

#### Scenario: installed application is offered

- **WHEN** filtering a category's curated list and an application is in the detected-installed set
- **THEN** that application is included in the offered list

#### Scenario: uninstalled application is hidden

- **WHEN** filtering a category's curated list and an application is not in the detected-installed set and is not the currently-configured application
- **THEN** that application is omitted from the offered list

#### Scenario: the saved application is kept even when not installed

- **WHEN** a category is configured to an application that is not in the detected-installed set
- **THEN** that application is still included in the offered list so the saved preference is not lost

#### Scenario: choices preserve their curated order

- **WHEN** filtering a curated list to the detected-installed subset
- **THEN** the offered applications appear in the same relative order as the curated list

#### Scenario: no detection yields only the always-present entries

- **WHEN** the detected-installed set is empty (e.g. a non-macOS or non-Tauri context)
- **THEN** the offered list contains no curated applications (only "System Default", any currently-configured application, and "Custom…" remain)

#### Scenario: an app in a standard directory is detected

- **WHEN** a candidate application's `<name>.app` exists in a standard macOS application directory
- **THEN** the detection reports that application as installed

#### Scenario: an absent app is not detected

- **WHEN** a candidate application has no `<name>.app` in any standard macOS application directory
- **THEN** the detection does not report that application as installed

#### Scenario: finder is detected under core services

- **WHEN** detecting Finder, whose bundle lives under `/System/Library/CoreServices`
- **THEN** the candidate paths include that location so Finder is detected as installed

### Requirement: Each application choice shows an icon

Each application offered in the Settings dialog SHALL display an icon resolved from the application's name. A known application SHALL show its vendored brand glyph; an unrecognized or custom application name SHALL fall back to a generic application glyph; an application without a brand glyph SHALL fall back to a category glyph (an editor glyph, a browser glyph, or a Finder/folder glyph). The "System Default" entry SHALL show a system glyph and the custom-name entry SHALL show a custom glyph.

#### Scenario: a known application shows its brand icon

- **WHEN** resolving the icon for a known application (e.g. a recognized editor or browser)
- **THEN** that application's vendored brand glyph is returned

#### Scenario: an unknown or custom application shows a generic icon

- **WHEN** resolving the icon for an unrecognized or custom application name
- **THEN** a generic application glyph is returned

#### Scenario: apps without a brand mark fall back by category

- **WHEN** resolving the icon for an application that has no brand glyph but a known category (e.g. Finder)
- **THEN** the category glyph (e.g. a folder glyph) is returned

#### Scenario: system default and custom show their own icons

- **WHEN** resolving the icon for the "System Default" entry or the custom-name entry
- **THEN** a system glyph and a custom glyph are returned, respectively
