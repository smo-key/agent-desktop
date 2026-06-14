## 1. Test harness & fixtures

- [ ] 1.1 Add a shell test harness under `docs/tests/` (plain `sh` assertion
  runner, no external deps) wired into the repo so it can be run locally and in
  CI; add a `yarn`/script entry to invoke it.
- [ ] 1.2 Record a `releases/latest` JSON fixture (trimmed to the relevant
  assets + `digest` fields) for tests to parse offline.

## 2. install.sh — pure logic (TDD)

- [ ] 2.1 Test + implement platform detection: map `uname -s`/`uname -m` to a
  platform key (macos-arm64, linux-x64, linux-arm64) and reject everything else.
- [ ] 2.2 Test + implement asset-name pattern selection per platform key
  (`*_aarch64.dmg`, `*_amd64.AppImage`, `*_aarch64.AppImage`).
- [ ] 2.3 Test + implement jq-free extraction of `browser_download_url` and
  `digest` for the matched asset from the fixture JSON.
- [ ] 2.4 Test + implement sha256 verification helper (compare computed hash to
  the `sha256:`-prefixed digest, case-insensitive; success and mismatch paths).
- [ ] 2.5 Test + implement TTY detection + prompt helper that reads from
  `/dev/tty` when present and is a no-op (default safe answer) when absent.

## 3. install.sh — side-effecting flows

- [ ] 3.1 Implement the download step (HTTPS via `curl`, to a temp dir, cleaned
  up on exit/trap) wired to verification from 2.4.
- [ ] 3.2 Implement the macOS install flow: mount dmg, copy `Agent Desktop.app`
  to `/Applications` with `~/Applications` fallback (no sudo), best-effort
  `xattr -dr com.apple.quarantine`, unmount, optional launch.
- [ ] 3.3 Implement the Linux install flow: place AppImage in `~/.local/bin`,
  `chmod +x`, write `.desktop` launcher entry, optional launch.
- [ ] 3.4 Implement the unsupported-platform exit (message + releases link +
  non-zero) and the no-matching-asset exit.
- [ ] 3.5 Add `set -eu`, a top-of-file header comment (what it does + how to read
  it before piping), and friendly progress output.

## 4. Hosting & docs

- [ ] 4.1 Place the finished script at `docs/install.sh` and add a minimal
  `docs/index.html` placeholder page.
- [ ] 4.2 Enable GitHub Pages (source: `main` `/docs`) and confirm the script is
  served at `https://smo-key.github.io/agent-desktop/install.sh`.
- [ ] 4.3 Add an `## Install` section to `README.md` with the one-liner and a
  manual-download fallback link, noting Windows/Intel-Mac are coming soon.

## 5. Verification

- [ ] 5.1 Run the shell test suite green.
- [ ] 5.2 Manually run the one-liner end-to-end on macOS arm64 (or document the
  manual smoke check performed) — installs, clears quarantine, launches.
- [ ] 5.3 File the follow-up item: Windows build fix + `install.ps1`, Intel-Mac
  build leg, and the `publish-release`-skipped investigation.
