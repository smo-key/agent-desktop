## ADDED Requirements

### Requirement: Settings dialog uses a unified accessible dropdown

Every dropdown control in the Settings dialog SHALL be rendered by a single reusable custom dropdown component, replacing the native `<select>` elements. The component SHALL show the active option as a trigger and, when open, present its options in a dismissible popover with ARIA listbox semantics. It SHALL support keyboard navigation between options, selection with Enter or Space, dismissal on Escape or an outside click, and indication of the active option. The component SHALL optionally display a per-option icon, supplied only where relevant (the "Open files with" rows); other Settings dropdowns SHALL render the same control without icons.

#### Scenario: selecting an option updates the setting

- **WHEN** the user opens a Settings dropdown and chooses an option
- **THEN** the dropdown closes and the corresponding setting is updated to that option's value

#### Scenario: keyboard navigation moves through the options

- **WHEN** the dropdown is open and the user presses Down, Up, Home, or End
- **THEN** the highlighted option advances, retreats, or jumps to the first or last option, staying within bounds

#### Scenario: the dropdown dismisses on escape or outside click

- **WHEN** the dropdown is open and the user presses Escape or clicks outside it
- **THEN** the dropdown closes without changing the current selection

#### Scenario: the active option is indicated

- **WHEN** the dropdown is open
- **THEN** the option matching the current value is marked as active (e.g. with a checkmark)

#### Scenario: an option can show an icon

- **WHEN** a dropdown is given options that carry icons (the "Open files with" rows)
- **THEN** each option and the trigger render that option's icon beside its label

#### Scenario: every settings dropdown uses the component

- **WHEN** the Settings dialog renders its dropdown controls (Density, Transcription quality, the two Notification selects, and the four Open-files rows)
- **THEN** each is rendered by the shared dropdown component rather than a native `<select>`
