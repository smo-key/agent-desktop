# Add cloud title fallback (claude -p Haiku)

## Why

Session titles are generated entirely on-device by the `llama-server` polish
model. When that model is unavailable — not downloaded, the sidecar won't start,
or a call errors/times out — the overview silently keeps the previous (often
generic "Session N") title. Users who are fine sending a few message lines to the
cloud want titles to still work in that case.

## What changes

- Add an **opt-in** setting `titles.cloudFallback` (default **off**), surfaced in
  the Settings modal under a new "Session titles" group.
- When the on-device title path fails **for any reason** and the setting is on,
  regenerate the title with the `claude` CLI in print mode
  (`claude -p --model haiku`), reusing the same title prompt and post-processing
  so the output shape is identical.
- The user's messages are piped to the CLI via **stdin** (not argv) so a message
  starting with `-` is never parsed as a flag and data stays separate from the
  instruction prompt. A hard timeout bounds the call.
- The fallback applies to **session titles only**, not voice transcript polish.
- With the setting off, behavior is unchanged: an on-device failure keeps the
  previous title and never touches the network.

This **modifies** the `session-titles` capability, whose prior requirement was
on-device-only (SHALL NOT call a hosted/network model). The network path is now
permitted strictly behind the opt-in.

## Impact

- Affected specs: `session-titles`
- Affected code: `src-tauri/src/claude_title.rs` (new), `src-tauri/src/lib.rs`
  (`session_focus` gains `cloud_fallback`), `src-tauri/Cargo.toml` (tokio
  `process`/`io-util`), `src/lib/settings/titles.svelte.ts` (new slice),
  `src/lib/overview/titles.svelte.ts` (passes `cloudFallback`),
  `src/lib/ui/SettingsModal.svelte` (toggle), `src/routes/+page.svelte` (load).
