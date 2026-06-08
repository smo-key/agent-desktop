# session-titles Specification

## Purpose
TBD - created by syncing change switch-title-model-to-local. Update Purpose after archive.
## Requirements
### Requirement: On-device session-title generation

The overview's per-agent FOCUS title SHALL be generated on-device by the local
model sidecar (the `llama-server` instance loading the polish model), from the
user's prose messages in that agent's transcript. The title generation SHALL NOT
call a hosted/network model.

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

#### Scenario: Local model unavailable — keep the previous title

- **WHEN** `session_focus` is invoked but the local model is absent or the local
  model call fails
- **THEN** the command returns an error rather than a title, and the overview keeps
  the previously displayed title

#### Scenario: Reasoning output never corrupts the title

- **WHEN** the local model's response contains a `<think>…</think>` reasoning block
- **THEN** that block is stripped and the returned title is the bare focus title
  with no reasoning text

#### Scenario: No ticket id is invented when none is present

- **WHEN** the user's messages mention no ticket or issue id
- **THEN** the title contains no ticket id and never the prompt's example formats
  (e.g. `PROJ-45`, `#45`) — it just names the focus in plain words
