# session-categorization Specification (delta)

## ADDED Requirements

### Requirement: Auto-categorization is opt-in and off by default

The system SHALL provide an auto-categorization feature that is DISABLED by default.
WHEN it has never been enabled (no stored `categorization` settings, or `enabled`
is false), the sessions panel SHALL behave exactly as before — the deterministic
lanes render and NO on-device classification is performed. The feature SHALL be
toggled by a single enable control in Settings, persisted across restarts in a
`categorization` settings slice.

#### Scenario: Fresh install performs no categorization
- **WHEN** the app loads with no stored `categorization` slice
- **THEN** the feature is off, the deterministic lanes render, and no classification call is made

#### Scenario: Disabling reverts to deterministic lanes with no inference
- **WHEN** the user turns the feature off after having used it
- **THEN** the panel returns to the deterministic lane grouping and no further classification calls are made

#### Scenario: The enable state persists across restarts
- **WHEN** the user enables the feature and relaunches the app
- **THEN** the feature is still enabled and the user's categories are restored

### Requirement: Users define an ordered list of categories

A category SHALL consist of a stable internal `id`, a machine `tag` (the token the
model emits), a display `label`, a `color` chosen from a fixed on-theme palette, and
a `rule` prompt describing what responses belong in it; its position in the list is
its display order. The system SHALL let users add, edit, reorder, and delete
categories, and SHALL designate exactly one category as the `fallback`. WHEN the
feature is first enabled with no prior configuration, the system SHALL seed three
default categories — **Needs You** (orange), **Waiting** (gray), and **Done**
(green, the fallback) — each with a starter rule prompt.

#### Scenario: First enable seeds the default categories
- **WHEN** the feature is enabled for the first time with no stored categories
- **THEN** the categories are Needs You (orange), Waiting (gray), and Done (green), with Done as the fallback, each with a starter rule prompt

#### Scenario: A user adds, edits, reorders, and deletes categories
- **WHEN** the user adds a category, edits its label/tag/color/rule, drags it to a new position, or deletes it in Settings
- **THEN** the change is persisted and reflected in the panel grouping order and headers

#### Scenario: Exactly one category is the fallback
- **WHEN** the user marks a category as the fallback
- **THEN** that category becomes the sole fallback and any previously-marked fallback is unmarked

### Requirement: Category configuration is validated and self-healing

The system SHALL keep the category configuration valid: there SHALL be at least one
category; each `tag` SHALL be non-empty and unique; each `color` SHALL be one of the
fixed palette values; and the `fallbackId` SHALL reference an existing category. The
system SHALL cap the number of categories at a small maximum (8) to keep the
classification prompt small. WHEN the `fallbackId` no longer references an existing
category (e.g. that category was deleted), the system SHALL self-heal by designating
another existing category as the fallback.

#### Scenario: Duplicate or empty tags are rejected
- **WHEN** the user tries to save a category with an empty tag or a tag that duplicates another category's tag
- **THEN** the configuration is rejected with inline validation feedback and not persisted

#### Scenario: Deleting the fallback category re-designates a fallback
- **WHEN** the user deletes the category currently marked as the fallback
- **THEN** the system designates another existing category as the fallback so a valid fallback always exists

#### Scenario: The category count is capped
- **WHEN** the user has reached the maximum number of categories
- **THEN** the system prevents adding another until one is removed

### Requirement: Classification runs on the on-device model when an agent finishes responding

The system SHALL, when auto-categorization is enabled and an agent finishes
responding (a `Stop` event with no tool in flight), classify that session into
exactly one of the user's categories using the on-device model. The model input SHALL be the
agent's last assistant message PLUS deterministic signals already available to the
app: the pending-question text if any, and whether a subagent/workflow/other process
is currently in flight. The classification SHALL use constrained decoding so the
model's output is always exactly one of the configured `tag` values. The system
SHALL NOT privilege any category — even a known pending question is supplied as a
signal and the user's `rule` prompts determine the result.

#### Scenario: A finished response is classified into a category
- **WHEN** an agent emits a `Stop` (turn complete) while the feature is enabled
- **THEN** the on-device model is invoked with the last response and deterministic signals, and the session is assigned the category whose tag the model returns

#### Scenario: Deterministic signals ground the classification
- **WHEN** a finished response indicates work was handed to a subagent/workflow and the subagent-in-flight signal is true
- **THEN** that signal is included in the model input so a rule like the default Waiting rule can match

#### Scenario: A pending question is passed as a signal, not a privileged route
- **WHEN** the session has a pending question to the user at turn completion
- **THEN** the pending-question text is included in the model input and the user's category rules decide the bucket (no category is hard-coded)

#### Scenario: Classification does not run while the feature is off
- **WHEN** an agent finishes responding while auto-categorization is disabled
- **THEN** no classification call is made

### Requirement: Unknown or failed classification uses the fallback category

The system SHALL assign a session to the designated fallback category WHEN the
on-device model is unavailable, errors, times out, or returns a tag that does not
match any configured category. The session SHALL be re-classified on its next finished
response, so a transient failure self-corrects.

#### Scenario: Model error falls back
- **WHEN** the classification call fails or the model is unavailable
- **THEN** the session is assigned the fallback category

#### Scenario: An unrecognized tag falls back
- **WHEN** the model returns a tag that matches no configured category
- **THEN** the session is assigned the fallback category

#### Scenario: A later success replaces the fallback assignment
- **WHEN** a session was placed in the fallback due to a failure and the agent later finishes another response that classifies successfully
- **THEN** the session moves to the classified category

### Requirement: Classification calls are serialized and coalesced

The system SHALL serialize on-device classification calls into a single-flight queue
(the model sidecar is shared with transcript polish and session titles) and SHALL
coalesce rapid repeated `Stop` events for the same session so that only the latest
pending classification for a session is run.

#### Scenario: Concurrent finishes do not overload the sidecar
- **WHEN** several agents finish responding at nearly the same time
- **THEN** their classification calls are run one at a time rather than concurrently

#### Scenario: Rapid re-finishes coalesce
- **WHEN** a session finishes, is re-prompted, and finishes again before its first classification completes
- **THEN** only the latest classification for that session is run

### Requirement: Per-session category assignments persist

The system SHALL retain each session's current category assignment at runtime keyed
by pane and SHALL persist the last assignment keyed by session id, so that on reload
or during polling a session displays its category immediately without re-running
inference. WHEN a stored assignment references a category that no longer exists, the
system SHALL treat the session as belonging to the fallback category.

#### Scenario: Assignment is restored on reload
- **WHEN** the app reloads and a session had a previously-assigned category
- **THEN** the session displays that category immediately, without a new classification call

#### Scenario: A stale assignment maps to fallback
- **WHEN** a session's stored category id no longer matches any configured category
- **THEN** the session is shown in the fallback category
