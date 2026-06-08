# Tasks

## 1. Backend — cloud fallback path

- [x] 1.1 Add `src-tauri/src/claude_title.rs`: pure `claude_title_args(model)` arg
  builder (`-p --model <m> --append-system-prompt <TITLE_SYSTEM_PROMPT>`) + async
  `claude_title(messages)` runner (stdin pipe, PATH/HOME seeding, timeout,
  best-effort `Err`). Unit-test the arg builder.
- [x] 1.2 Register `pub mod claude_title;` and enable tokio `process`/`io-util`
  features in `Cargo.toml`.
- [x] 1.3 Add `cloud_fallback: bool` to `session_focus`; on on-device `Err`, fall
  back to `claude_title` when enabled, else preserve the previous `Err` behavior.

## 2. Frontend — setting + wiring

- [x] 2.1 Add `src/lib/settings/titles.svelte.ts` (`titles` slice,
  `cloudFallback` default off) with pure `parseTitlePrefs` + store; unit-test it.
- [x] 2.2 Load `titleSettings` on mount in `+page.svelte`.
- [x] 2.3 Pass `cloudFallback` from `titleSettings.prefs` to the `session_focus`
  invoke in `src/lib/overview/titles.svelte.ts`.
- [x] 2.4 Add a "Session titles" toggle row in `SettingsModal.svelte`.

## 3. Verify

- [x] 3.1 `cargo test --lib` (new tests pass; pre-existing `events` socket tests
  unaffected), `npm run check`, `npm run test` all green.
