# session-titles Specification

## Purpose
TBD - created by syncing change switch-title-model-to-local. Update Purpose after archive.
## Requirements
### Requirement: On-device session-title generation

The overview's per-agent FOCUS title SHALL be generated on-device by the local
model sidecar (the `llama-server` instance loading the polish model), from the
user's prose messages in that agent's transcript. On-device generation is the
DEFAULT and the only path used unless the user has enabled the opt-in cloud title
fallback (see "Opt-in cloud title fallback"); absent that opt-in, the title
generation SHALL NOT call a hosted/network model.

The request SHALL be bounded to the sidecar's context window (a recent window of
the user's messages, each clipped) and SHALL constrain the output to a single
short title (at most 6 words; only the title, with no quotes, surrounding
punctuation, or preamble). Any model reasoning block that leaks into the response
SHALL be stripped before the title is returned.

A ticket or issue id SHALL appear in the title only when one actually appears in
the user's messages; the model SHALL NOT invent, guess, or copy an example id.
Any example ticket formats in the prompt SHALL be generic (e.g. `PROJ-45`, `#45`)
rather than a distinctive placeholder the model is prone to parrot.

#### Scenario: Title generated from the user's messages

- **WHEN** `session_focus` is invoked for a session whose transcript contains user
  messages and the local model is available
- **THEN** the command returns a short focus title (≤6 words, no surrounding quotes
  or trailing punctuation) produced by the local model

#### Scenario: No user messages yet

- **WHEN** `session_focus` is invoked for a session in which the user has sent no
  prose messages
- **THEN** the command returns no title (`None`) and the overview shows the pane's
  fallback name

#### Scenario: Local model unavailable and cloud fallback disabled — keep the previous title

- **WHEN** `session_focus` is invoked but the local model is absent or the local
  model call fails, and the cloud title fallback is disabled
- **THEN** the command returns an error rather than a title, and the overview keeps
  the previously displayed title, with no network call

#### Scenario: Reasoning output never corrupts the title

- **WHEN** the local model's response contains a `<think>…</think>` reasoning block
- **THEN** that block is stripped and the returned title is the bare focus title
  with no reasoning text

#### Scenario: No ticket id is invented when none is present

- **WHEN** the user's messages mention no ticket or issue id
- **THEN** the title contains no ticket id and never the prompt's example formats
  (e.g. `PROJ-45`, `#45`) — it just names the focus in plain words

### Requirement: Opt-in cloud title fallback

The system SHALL provide an opt-in setting (`titles.cloudFallback`) that defaults
to OFF and is surfaced in the Settings modal. When this setting is OFF, session
titles are generated on-device only and an on-device failure never reaches the
network.

When the setting is ON and on-device title generation is unavailable for ANY
reason (model absent, sidecar won't start, HTTP error, or timeout), the system
SHALL regenerate the title using the `claude` CLI in print mode with the Haiku
model (`claude -p --model haiku`), applying the SAME title constraints and
post-processing (≤6-word bare title, reasoning stripped, ticket-id rules) as the
on-device path. The user's messages SHALL be supplied to the CLI via stdin rather
than as command-line arguments, and the call SHALL be bounded by a timeout. The
call SHALL run with all CLI tools disabled so the untrusted transcript cannot
drive tool use, and a timed-out or abandoned CLI process SHALL be terminated
rather than left running.

This fallback SHALL apply only to session-title generation, not to voice
transcript polish. If the fallback itself fails (binary missing, non-zero exit,
timeout, or empty output), the system SHALL keep the previously displayed title.

#### Scenario: Cloud fallback regenerates the title when on-device is unavailable

- **WHEN** `session_focus` is invoked, the on-device model is unavailable or its
  call fails, and the cloud title fallback setting is enabled
- **THEN** the command regenerates the title via `claude -p --model haiku` (messages
  passed on stdin) and returns a short focus title with the same shape as an
  on-device title

#### Scenario: Cloud fallback failure keeps the previous title

- **WHEN** the cloud title fallback is enabled and used, but the `claude` call fails
  (binary missing, non-zero exit, timeout, or empty output)
- **THEN** the command returns an error rather than a title, and the overview keeps
  the previously displayed title

#### Scenario: Setting defaults to off

- **WHEN** the session-title settings have never been configured (fresh install or
  an empty/corrupt settings blob)
- **THEN** `titles.cloudFallback` is off, so titles are generated on-device only

#### Scenario: Fallback does not apply to voice polish

- **WHEN** the voice transcript polish path's on-device model is unavailable
- **THEN** voice polish degrades to the raw transcript (it does NOT call
  `claude -p`), regardless of the cloud title fallback setting

### Requirement: User can rename a session

The user SHALL be able to set a CUSTOM title for a session in two ways: by clicking
the session title in the focus-pane header (inline edit), and via a "Rename" item
in the agent card's context menu. A custom title SHALL be displayed in place of the
auto-generated title and SHALL persist across restart / resume. Once a session has
a custom title, automatic title generation SHALL STOP for that session — the custom
title is sticky and SHALL NEVER be overwritten by later messages.

#### Scenario: Rename via the header title
- **WHEN** the user clicks the session title in the focus-pane header, edits it, and commits (Enter or blur)
- **THEN** the session shows the custom title; pressing Esc instead cancels the edit and keeps the prior title

#### Scenario: Rename via the context menu
- **WHEN** the user chooses "Rename" from the agent card's context menu and commits a new title
- **THEN** the session shows the custom title

#### Scenario: Custom title persists across restart and resume
- **WHEN** a session has a custom title and the app is restarted or the session is resumed
- **THEN** the session still shows its custom title

#### Scenario: Auto-generation does not overwrite a custom title
- **WHEN** a session has a custom title and the user sends further messages
- **THEN** the title is not re-generated; the custom title remains

### Requirement: Auto-titles refresh after each user message

For sessions WITHOUT a custom (manual) title, the auto-generated title SHALL be
re-derived promptly after each new user message — gated on the transcript's
user-message hash changing — rather than only after a long throttle window. A small
floor throttle MAY be retained to avoid re-deriving mid-stream, but a new user
message SHALL trigger a fresh title.

#### Scenario: New user message refreshes the title
- **WHEN** the user sends a new message in a session that has no custom title (its user-message hash changes)
- **THEN** a fresh title is requested for that session

#### Scenario: No change means no refresh
- **WHEN** the user's messages have not changed (the user-message hash is unchanged)
- **THEN** no new title is requested

#### Scenario: A custom-titled session is not refreshed
- **WHEN** a session has a custom (manual) title and the user sends a new message
- **THEN** no automatic title is requested for that session

### Requirement: Auto-titles reflect the whole session, weighted to the original request

Auto-generated session titles SHALL be derived from the user's messages across the
WHOLE session — not just the most recent message — and SHALL give more weight to the
user's EARLIER messages, where the session's original request usually appears. The
earliest user message(s) SHALL ALWAYS be included in the model input even in a long
session (the original request SHALL NOT be dropped by recency-based truncation), and
recent messages SHALL also be included so a genuinely new later request can still be
reflected. A later message SHALL shift the title's focus only when it clearly
introduces a new top-level task, not for incidental refinements or follow-ups.

#### Scenario: The original request survives a long session
- **WHEN** a session has more user messages than fit the bounded model input
- **THEN** the earliest user message(s) carrying the original request are still included in the title input (they are not dropped by recency-based truncation)

#### Scenario: Early request outweighs an incidental recent message
- **WHEN** the early messages state the main task and the latest messages are incidental refinements or follow-ups
- **THEN** the generated title reflects the original request rather than only the most recent message

#### Scenario: A genuinely new later task can take over
- **WHEN** a later message clearly introduces a new, distinct top-level task
- **THEN** the title may reflect that new task

#### Scenario: A short session considers all its messages
- **WHEN** a session has only a few user messages (within the bound)
- **THEN** all of them are considered when generating the title

