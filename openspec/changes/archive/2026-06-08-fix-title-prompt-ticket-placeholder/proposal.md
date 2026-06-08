## Why

The on-device session-title model (the small Qwen3 polish model) was parroting the
literal example ticket id from its system prompt: titles like "SKIPA-45: …" showed
up on sessions that had no ticket at all, because `SKIPA-45` was a distinctive
few-shot example the small model copied verbatim.

## What Changes

- The `TITLE_SYSTEM_PROMPT` now instructs the model to include a ticket/issue id
  **only when one actually appears in the user's messages**, and to never invent,
  guess, or copy one.
- The example ticket id is changed from the distinctive `SKIPA-45` to generic
  formats (`PROJ-45`, and `#45` for GitHub-style issues), framed explicitly as
  formats rather than a placeholder to emit.

## Impact

- **Backend** — `src-tauri/src/polish.rs`: reword `TITLE_SYSTEM_PROMPT`; update the
  prompt-constraints unit test and add one locking in the no-invented-ticket rule.
- No API, dependency, or behavior change beyond the generated title text.
