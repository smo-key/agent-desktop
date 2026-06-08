# Tasks

- [x] 1.1 Extract a shared `chat_complete(app, state, body)` core from
  `voice_polish` in `polish.rs`; refactor `voice_polish` to use it.
- [x] 1.2 Add `TITLE_SYSTEM_PROMPT` + `build_title_body` (low temperature,
  non-streaming, `enable_thinking: false`) to `polish.rs`, with unit tests.
- [x] 1.3 Rewrite `session_focus` in `lib.rs` as an async command that builds the
  title body, runs it through `polish::chat_complete`, and cleans the result.
- [x] 1.4 Add pure `clean_title` / `strip_think_blocks` post-processing helpers in
  `lib.rs` (first non-empty line, strip `<think>…</think>`, strip wrapping
  quotes/periods, clip to 60), with unit tests.
- [x] 1.5 Update stale "Haiku" comments in the overview titles store and callers to
  be model-agnostic.
- [x] 1.6 Run `cargo test --lib` and the overview vitest suite; confirm green
  (pre-existing unrelated socket-path test failures aside).
