## 1. Backend: path resolution & open commands

- [x] 1.1 Add `resolve_path(cwd: Option<String>, token: String) -> Result<Option<String>, String>` to `src-tauri/src/lib.rs`: expand `~`/`~/...` against `$HOME`, pass absolute paths through, join all other tokens against `cwd`; canonicalize and return `Some(absolute)` only if `fs::metadata` confirms it exists, else `None`. (Used `fs::canonicalize`, which both validates existence and yields the absolute path.)
- [x] 1.2 Add `open_path(path: String, app: Option<String>) -> Result<(), String>` — `open -a <app> <path>` when an app is set, else `open <path>`; best-effort, stringified error. (Extended from default-only to honor open-with prefs.)
- [x] 1.3 Register both new commands in the `tauri::generate_handler!` invoke handler.
- [x] 1.4 Verify in a dev build: `resolve_path` resolves relative/`~`/absolute/non-existent inputs; `open_path` opens files via prefs. (Confirmed by user — exercised through the live ⌘-click flow.)

## 2. Frontend: token extraction & resolution helpers

- [x] 2.1 Create a `terminalLinks.ts` helper next to `TerminalPane.svelte` with a pure `extractToken(line: string, col: number)` that returns the contiguous non-whitespace run under `col` and a `normalizeToken(raw)` that strips surrounding quotes/backticks, one layer of `()`/`[]`/`<>`, a trailing `:line[:col]` suffix, and trailing sentence punctuation — returning the cleaned token plus its start/end offsets within the line.
- [x] 2.2 Add unit tests (`terminalLinks.test.ts`) covering: plain token, `:42:8` suffix, quoted + trailing period, bracket-wrapped, and a whitespace-only/empty position.

## 3. Frontend: terminal hover/click affordance (self-managed)

- [x] 3.1 In `TerminalPane.svelte`, track ⌘/Meta state via window `keydown`/`keyup` and reset it on window `blur`; clean up listeners in `onDestroy`.
- [x] 3.2 Self-managed hover (REWORKED from the xterm link provider, which fought PTY mouse-reporting and flickered): on ⌘+host-mousemove, hit-test the cell under the pointer (screen rect / cols×rows), read the buffer line, extract+normalize the token, `invoke('resolve_path', …)` (latest-wins via a sequence guard), and arm the path when it resolves.
- [x] 3.3 ⌘-click opens via prefs: a capture-phase `mousedown` on `host` that, when ⌘ held over an armed path, `preventDefault()` + `stopImmediatePropagation()` (so it never reaches the PTY/selection) and calls `openWith.openFile(path)`.
- [x] 3.4 Re-evaluate on ⌘ press/release without pointer movement (uses the tracked last pointer); clear on `mouseleave` and on `term.onScroll`.

## 4. Styling

- [x] 4.1 Dotted-underline overlay (`.file-link-underline`, child of `host`, positioned imperatively) + a `.xterm-screen.file-link-armed { cursor: pointer !important }` class that beats `.xterm.enable-mouse-events` and persists at rest (fixes the flickering cursor).

## 5. Settings: open-with preferences + dialog

- [x] 5.1 Backend: add `settings_load`/`settings_save` (mirror `recents_*`, `SETTINGS_FILE = "settings.json"`) and register them.
- [x] 5.2 Frontend store `src/lib/settings/openWith.svelte.ts`: prefs model (html/code/other → System or app), pure `classify`/`resolveApp`/`parsePrefs`, load (seed defaults on first run) + save, and `openFile(path)`. Unit tests in `openWith.test.ts`.
- [x] 5.3 Settings dialog: `settingsStore.svelte.ts` (open/close) + `SettingsModal.svelte` (a select per category with System Default / curated apps / Custom…), a `settings` gear icon, a title-bar gear button + `<SettingsModal />` wired in `+page.svelte`, and `openWith.load()` on mount.
- [x] 5.4 Route opens through prefs: terminal ⌘-click and transcript file links (`overview/editor.ts`) both call `openWith.openFile`.

## 6. Verification

- [x] 6.1 Type-check (`npm run check`, 0 errors), full test suite (`npm test`, all pass incl. new `terminalLinks` + `openWith`), and production build (`npm run build`) succeed. Rust `cargo check` clean.
- [x] 6.2 Manual GUI pass in a dev build (confirmed by user — "Looks good"): ⌘-hover shows the dotted underline + a STABLE pointer cursor (no flicker at rest), clears on release/leave/scroll; ⌘-click opens via prefs; non-⌘ selection/scroll unaffected; Settings gear opens the dialog; changing an app persists across restart; HTML→Brave and code/other→Cursor open correctly.

## 7. Close-out spec reconciliation

- [x] 7.1 Reconcile the `open-with-preferences` delta spec with shipped code: the implementation classifies into FOUR buckets — `html`, `markdown`, `code`, `other` (`openWith.svelte.ts` `classify()`, `SettingsModal.svelte`) — but the spec described three and put `.md` under code. Updated the requirement to four categories and added a "Markdown files classify to the Markdown category" scenario (markdown is its own bucket: `.md`/`.markdown`/`.mdx`/`.mdown`/`.mkd`), and dropped `.md` from the code-classification example. Covered by `openWith.test.ts`. (Capability is pending/non-enforced, so no coverage-gate impact.)
