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
