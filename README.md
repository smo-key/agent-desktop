# Agent Desktop

A desktop app to manage AI coding agents — for people who run lots of agents but only want to think about one thing at a time.

## Features

- **Project workspace** — organize working folders into named, color-coded projects with per-project terminals, tasks, and git state.
- **Agent orchestration** — launch and coordinate multiple agent sessions, with an orchestrator that manages the fleet over MCP.
- **Built-in terminals** — full xterm terminals with file links, filename insertion, and a tiling layout that persists across restarts.
- **Git integration** — push, pull, and switch branches per project from context menus and the app footer.
- **Voice dictation** — dictate into any input with a floating voice panel and on-device transcription (no cloud round-trip).
- **Usage dashboard** — track activity and agent usage at a glance.

## Getting Started

Prerequisites: [Node.js](https://nodejs.org/) and the [Rust toolchain](https://www.rust-lang.org/tools/install) (for Tauri).

```bash
# Install dependencies, git hooks, and bundled model sidecars
npm run setup

# Run the desktop app in development
npm run dev

# Build a production app bundle
npm run build
```

To run just the web frontend (without the Tauri shell), use `npm run dev:web`.

## Contributing

1. [Fork this repository](https://github.com/) and clone your fork.
2. Create a branch and make your changes.
3. Run the checks before opening a PR:
   ```bash
   npm run check:gate   # type-check, tests, and coverage
   ```
4. This project tracks behavior in [OpenSpec](openspec/) — when you change requirements or scope, update the relevant specs alongside your code.
5. Push to your fork and open a pull request against this repository.
