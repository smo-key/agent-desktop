# Tasks

- [x] 1.1 Add a pure `usage_bootstrap_config(&UsagePaths) -> SpawnConfig` building
      the hidden session's argv (`--settings` with `remoteControlAtStartup: false`
      + statusline wrapper, no hooks) and env (`AGENT_DESKTOP_PANE` =
      `usage-bootstrap`, `AGENT_DESKTOP_SNAPSHOT_DIR`), with a unit test asserting
      the statusline wiring, shell-quoting, snapshot env, and absence of event-hook
      wiring.
- [x] 1.2 Add a `shell_quote_command` helper mirroring the frontend `quoteCommand`,
      with a unit test for double-quoting + `"`/`\`/`$`/`` ` `` escaping.
- [x] 1.3 Add `start_usage_bootstrap(&AppHandle)`: resolve usage paths (best-effort),
      spawn the hidden session via `PtyManager` with a discard sink, and kill it
      after a 30s TTL on a throwaway timer thread.
- [x] 1.4 Wire `start_usage_bootstrap` into the Tauri `setup` hook after the usage
      watcher starts.
