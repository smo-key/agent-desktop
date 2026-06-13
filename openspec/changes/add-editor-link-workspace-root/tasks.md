# Tasks

## 1. Backend — workspace-aware open

- [x] 1.1 Extend `open_path` in `src-tauri/src/lib.rs` with an optional `workspace: Option<String>`; when `app` is set AND `workspace` is a non-empty (trimmed) string, run `open -a <app> <workspace> <file>`, otherwise preserve current behavior (`open -a <app> <file>`, or `open <file>` with no app). Update the doc comment. (Arg construction extracted to a pure `open_args` helper.)
- [x] 1.2 Drop a `workspace` that does not contain the file: a `path_within` helper canonicalizes both the workspace and the file (resolving symlinks) and checks the prefix, so the workspace is only forwarded when it actually contains the file (an absolute path clicked outside the project, or a non-file target such as a URL, falls back to file-only). The containment check lives in the backend because the file path is canonicalized while the pane `cwd` is not, so a TS prefix test would give false negatives.

## 2. Frontend — thread the workspace root through

- [x] 2.1 In `src/lib/settings/openWith.svelte.ts`, add a `PROJECT_AWARE_EDITORS` set (`Cursor`, `Visual Studio Code`, `Zed`, `Sublime Text`) and a pure `isProjectAwareEditor()` helper to decide whether a resolved app is project-aware.
- [x] 2.2 Change `openFile(path: string, workspace?: string)` to forward `workspace` to the `open_path` invoke ONLY when a workspace is provided AND `resolveApp()` returns a project-aware editor; otherwise invoke with no workspace (file-only), as today.
- [x] 2.3 In `src/lib/overview/editor.ts`, update `openInEditor(cwd, file)` to forward `cwd` as the workspace (`openFile(resolveFile(cwd, file), cwd)`) instead of dropping it.
- [x] 2.4 In `src/lib/TerminalPane.svelte`, change the ⌘-click handler to pass the pane `cwd`: `openWith.openFile(armedPath, cwd)`.
- [x] 2.5 Confirm `src/lib/usage/GitInfo.svelte` flows the commit project path through (it already calls `openInEditor(commitProject?.path, file)`) — no change expected, just verify.

## 3. Tests

- [x] 3.1 Unit-test the project-aware-editor gating helper (Cursor/VS Code/Zed/Sublime → true; TextEdit/Finder/custom/System Default → false).
- [x] 3.2 Unit-test `openFile`: workspace forwarded for a project-aware editor with a workspace; omitted for System Default, for a non-project-aware app, and when no workspace is given (mock the `invoke` and assert the `workspace` argument).
- [x] 3.3 Unit-test `openInEditor` forwards `cwd` as the workspace and still resolves the file to an absolute path.
- [x] 3.4 Unit-test the backend: `open_args` builds the right argv for each app/workspace combination, and `path_within` reports containment correctly (nested file true, root itself true, sibling false, missing path false).

## 4. Verify

- [x] 4.1 Run the frontend test suite and `cargo build` for the Tauri change; ensure all green. (1120 vitest tests pass; `svelte-check` 0 errors; `cargo build` ok; new Rust tests pass.)
- [ ] 4.2 Manual check in the app: ⌘-click a relative path in a terminal pane and a transcript file link with the code category set to Cursor — the project opens as the workspace with the file revealed; with System Default it still opens file-only.
