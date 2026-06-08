# Tasks

## 1. Terminal-on-failure for project Push/Pull

- [x] 1.1 Add a `setGitTerminalOpener` injection to `projectGitActions.ts`; on a
  failed Push/Pull, open a terminal in the project's folder running the failed git
  command (`git push` / `git pull`), falling back to a toast when no opener (or no
  project id) is wired. Thread the project id through `pushProject`/`pullProject`.
- [x] 1.2 Update `projectGitActions.test.ts`: failure opens a terminal when an
  opener is wired (no toast); falls back to a toast otherwise.
- [x] 1.3 Pass the project id from the project pane's context-menu Push/Pull
  (`ProjectPanel.svelte`).

## 2. Bare terminal that runs an initial command

- [x] 2.1 Extend `launchBareTerminal(projectId, initialInput?)` and `BareTerminal`
  to carry an optional one-shot command (blank ⇒ plain shell).
- [x] 2.2 Pass `initialInput` through the bare entry in `RunningTasksPanel.svelte`.
- [x] 2.3 Test the new behavior in `projectTasks.svelte.test.ts`.

## 3. Wire the opener + footer buttons

- [x] 3.1 Wire `setGitTerminalOpener` in `+page.svelte` to reveal the Terminals
  panel, launch a bare terminal with the command in the project, and focus it.
- [x] 3.2 Make `GitInfo.svelte`'s ahead (↑) / behind (↓) indicators clickable
  Push / Pull buttons when `onPush` / `onPull` handlers are provided.
- [x] 3.3 Provide `onPush` / `onPull` in `AppFooter.svelte` (only when a real
  project folder backs the footer git) wired to `pushProject` / `pullProject`.

## 4. Specs + gate

- [x] 4.1 Spec deltas for `projects` and `project-tasks`.
- [x] 4.2 Add the footer scenario to the coverage gate's MANUAL set (DOM-bound).
- [x] 4.3 `npm run check`, `npm run test`, and `npm run coverage` pass.
