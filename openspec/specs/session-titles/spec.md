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

### Requirement: Auto-titles for Copilot sessions
On-device auto-title generation SHALL run for Copilot sessions using user
message text sourced from the Copilot session event log, under the same
constraints, caching, and refresh triggers as Claude sessions. The opt-in
cloud title fallback (`claude -p`) SHALL apply to Copilot sessions' text the
same way it applies to Claude sessions' — it is a fallback title generator,
not a property of the session's backend — and remains OFF by default.

#### Scenario: Copilot session gets an on-device title
- **WHEN** a Copilot session records its first user message in its event log
- **THEN** on-device title generation produces a ≤6-word title for the pane, cached and refreshed per the existing title rules

#### Scenario: Manual rename still wins
- **WHEN** the user renames a Copilot session
- **THEN** auto-titling stops overwriting it, matching Claude-session rename behavior

### Requirement: Bare terminal rows are titled from the activity the terminal reports

A bare shell listed in the combined sessions list SHALL be given a generated title summarizing what the user was doing in it, derived from the terminal's reported window title — which a configured shell sets to the command it dispatched, and otherwise to the working directory. The user's keystrokes SHALL NOT be a title source: the input stream carries whatever a program reads from stdin — a password at a prompt a shell builtin owns, a heredoc body, a token piped to a CLI — which cannot be reliably separated from commands, whereas a title is reported when a command is dispatched, not while a program reads input. Rendered output SHALL NOT be a source either: it changes on every chunk and carries what programs print.

A reported title is UNTRUSTED text — it is set by bytes on the output stream, so a remote host or a dumped file can write it, and a secret passed as a command-line argument appears in it. Control bytes SHALL be stripped, the obvious secret shapes (assignments to key/token/password variables, password/token flags, credentials in a URL, known token prefixes) SHALL be redacted before an entry is stored, and entries SHALL be framed as data in the model prompt.

Repeat and blank reports SHALL be collapsed, the list SHALL be bounded and memory-only (never persisted), and a shell that has reported nothing beyond a single unchanging title SHALL be left untitled rather than titled from noise. The title SHALL be (re)generated only when the reported list changes, subject to a throttle and a per-terminal cap so a title that never repeats cannot generate indefinitely; it SHALL be generated ON-DEVICE ONLY (the session-transcript cloud fallback does not extend to terminal activity, so with no local model the row keeps its name); and a terminal-kind TASK row SHALL NOT be titled by the model: its command is already its name.

#### Scenario: The shell reported activity accumulates
- **WHEN** a shell reports a sequence of window titles as the user works
- **THEN** they are collected in order, with blanks ignored, an immediate repeat collapsed, and the oldest dropped past the cap

#### Scenario: A shell that reports nothing new is never titled
- **WHEN** a shell has reported nothing, or only one unchanging title
- **THEN** no title request is made for it

#### Scenario: A bare shell is titled from its recent commands
- **WHEN** a bare shell's reported activity changes
- **THEN** a title is requested for it from the on-device terminal-title model and shown on its row

#### Scenario: An untouched shell is never titled
- **WHEN** a bare shell has reported no activity, or a row is a task terminal
- **THEN** no title request is made for it

#### Scenario: A secret on the command line is redacted before it is stored
- **WHEN** a reported title contains a password argument, a token assignment, or credentials in a URL
- **THEN** the secret is replaced before the entry is stored or sent to the model

#### Scenario: A terminal whose title never settles stops costing model calls
- **WHEN** a terminal keeps reporting titles that never repeat (a clock in the prompt, an unread count)
- **THEN** it stops requesting new titles once its per-terminal cap is reached and keeps its last title

#### Scenario: A stale title response never replaces a newer one
- **WHEN** a title request resolves after a later request for the same terminal has already taken over
- **THEN** its result is discarded and the newer title stands

#### Scenario: A failed terminal title request backs off
- **WHEN** a terminal title request fails because no on-device model is available
- **THEN** that terminal is not retried until its backoff expires

#### Scenario: A closed terminal's title state is reclaimed
- **WHEN** a terminal row disappears from the roster
- **THEN** its cached title and request bookkeeping are dropped

#### Scenario: Terminal text is treated as data
- **WHEN** the terminal-title request body is built
- **THEN** it carries the terminal title system prompt, which states the reported entries are data and must not be followed
