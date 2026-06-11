## Context

Terminal panes are rendered with **xterm.js v6** (`@xterm/xterm`) in `src/lib/TerminalPane.svelte`. The terminal is bare: only `@xterm/addon-fit` and (on the active pane) `@xterm/addon-webgl` are loaded. There is **no** link detection, hover affordance, or click handling today.

Each pane is spawned with a known working directory: `cwd` arrives as a prop and is also recorded in the workspace registry (`src/lib/layout/workspace.svelte.ts`, `PaneSession`). The PTY's *runtime* cwd (after the process `cd`s around) is not tracked.

The app already opens external apps from Rust without any Tauri plugin: `open_in_editor` in `src-tauri/src/lib.rs` shells out to `open -a Cursor <path>` via `std::process::Command`, best-effort, returning a stringified error the frontend can ignore. Opening in the *default* handler is the same call without `-a Cursor` (`open <path>`).

## Goals / Non-Goals

**Goals:**
- ⌘-hover over a terminal token that resolves to an existing path → dotted underline + pointer cursor.
- ⌘-click that token → open the path in the OS default handler application.
- cwd-aware resolution for relative / `./` / `../` / `~` / absolute paths.
- Strip `:line[:col]` suffixes and surrounding quotes/parens/trailing punctuation before resolving.
- Zero impact on no-modifier behaviour (selection, scroll, plain click).

**Non-Goals:**
- Tracking the PTY's runtime cwd (we use the pane's spawn-time cwd; see Risks).
- Opening at a specific line/column (the `:line` suffix is stripped, not honoured — that is `open_in_editor`'s job, out of scope here).
- URL / http link detection (separate concern; could reuse `@xterm/addon-web-links` later).
- Linkifying paths that don't exist on disk, or fuzzy/heuristic matching of partial paths.
- Windows/Linux openers — the existing `open`-based pattern is macOS-only, matching the rest of the app.

## Decisions

### D1: Use xterm's `registerLinkProvider`, not `addon-web-links` regex matching
xterm exposes `ITerminal.registerLinkProvider(provider)` (requires `allowProposedApi: true`, already set at `TerminalPane.svelte:261`). The provider is called with a buffer line and returns the ranges to linkify, plus `hover`/`leave`/`activate` callbacks. We choose a **custom link provider** over `@xterm/addon-web-links` because:
- We need **async, filesystem-validated** matching (only linkify tokens that actually exist), which the regex-only web-links addon can't express.
- We need the link to be **gated on the ⌘ modifier**, with the underline appearing/disappearing as the modifier is pressed/released.

*Alternative considered:* `@xterm/addon-web-links` with a custom regex + validation in the `activate` handler. Rejected: it linkifies on plain hover (no modifier gate) and styles all matches eagerly; harder to make filesystem-aware.

### D2: Modifier gating via tracked ⌘ state, re-querying links on change
xterm's link provider runs per-cell-row on hover. To gate on ⌘ we track the modifier with `keydown`/`keyup` (and `blur` → treat as released) on the window. The provider returns **no links when ⌘ is up**, and links when ⌘ is down. On modifier state change while the pointer is stationary we trigger a re-evaluation (xterm re-queries on mouse move; we additionally nudge it so the underline appears the instant ⌘ goes down without requiring a pixel of movement). The decoration is xterm's built-in link underline styling, themed to a **dotted** underline + pointer cursor.

### D3: Token extraction = whitespace split, then decoration stripping
From the hovered buffer line, take the contiguous non-whitespace run under the pointer as the candidate token. Then normalise:
1. Strip matching surrounding quotes/backticks and one layer of wrapping `()`/`[]`/`<>`.
2. Strip a trailing `:\d+(:\d+)?` (line/col) suffix.
3. Strip trailing sentence punctuation (`. , ; :` ) when not part of the path.

The link range reported back to xterm covers the **stripped** token only (so the underline hugs the path, not the punctuation).

### D4: Resolution is cwd-aware and filesystem-validated
- `~` / `~/...` → expand against `$HOME`.
- absolute (`/...`) → use as-is.
- everything else → join against the pane's `cwd`.
Then check existence. Resolution + existence check happens in a new Rust command `resolve_path(cwd, token) -> Option<String>` (returns the absolute path if it exists, else `None`), OR the frontend may pre-filter and the existence check happens implicitly when `open_path` is called. **Decision:** do the existence check in Rust as part of resolution so the link only appears for real paths — keeps the filesystem source of truth on the backend and avoids a webview FS permission. The provider calls `resolve_path` (cheap `fs::metadata`) during hover.

*Alternative considered:* resolve + `stat` in the frontend via a Tauri fs plugin. Rejected: adds a plugin + capability for a one-liner Rust already does trivially.

### D5: `open_path` mirrors `open_in_editor`
Add `#[tauri::command] fn open_path(path: String) -> Result<(), String>` running `open <path>` (no `-a`), `.spawn()`, best-effort. Register alongside `open_in_editor` in the `invoke_handler`. Directories open in Finder; files open in their registered default app — both are native `open` behaviour, no branching needed.

## Risks / Trade-offs

- **Spawn-time cwd only** → tokens relative to a directory the agent later `cd`-ed into won't resolve, so won't linkify. *Mitigation:* absolute paths (the common case in agent diffs/stack traces) always work; document the limitation; runtime-cwd tracking is a future enhancement, not a regression.
- **Per-hover Rust round-trip for existence check** could add latency / IPC chatter on fast pointer movement. *Mitigation:* `resolve_path` is a single `fs::metadata`; debounce/cache the last resolved token; xterm only queries on row change, not per pixel.
- **False negatives on exotic filenames** (spaces in paths break whitespace-split tokenisation). *Mitigation:* accepted; quoted paths recover the common spaced-name case via D3 step 1. Document as known limitation.
- **Modifier desync** (⌘ held when window loses focus) → stuck underline. *Mitigation:* clear modifier state on window `blur` and on `keyup`.
- **Accidental opens** if a token both exists and is unexpected. *Mitigation:* requires an explicit modifier + click; matches established terminal UX (iTerm2/VS Code).
