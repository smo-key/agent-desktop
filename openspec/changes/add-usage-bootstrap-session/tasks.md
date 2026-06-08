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
- [x] 1.5 Add the `bootstrap_session_excluded_from_the_overview` Rust test mapping
      the headless-testable spec scenario.
- [x] 1.6 Register the three genuinely-live scenarios (rate-limits-populated,
      killed-after-TTL, best-effort-startup) as headless-exempt MANUAL in
      `tools/check-scenario-coverage.mjs` (they need a real `claude` spawn, a 30s
      wall-clock TTL, and the Tauri setup/AppHandle path — confirmed in-app).
- [x] 1.7 Adversarial-review fixes: delete a prior launch's stale
      `usage-bootstrap.json` before spawning (no expired window on cold start), and
      kill the probe immediately if the TTL timer thread fails to spawn (no leaked
      hidden session).
