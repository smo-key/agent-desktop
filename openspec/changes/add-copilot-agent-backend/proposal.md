## Why

Agent Desktop can only launch and supervise Claude Code sessions — the `claude`
program is hard-coded into the launcher, and every observability feature (status
roster, usage footer, titles, activity timeline) is wired to Claude-private
surfaces. Operators who run GitHub Copilot CLI agents cannot use the control
room at all. Separately, the coordinator feature (an agent that orchestrates
other agents) has not earned its complexity and is being removed.

## What Changes

- Introduce an **agent backend abstraction**: a per-backend descriptor (binary,
  launch/resume args, MCP config style, model-label formatting, startup timing,
  busy markers, capability flags) behind a widened `AgentKind = 'claude' | 'copilot'`.
  All `program === 'claude'` predicates become backend/capability lookups.
- Add a **global "Agent" setting** (Claude Code / GitHub Copilot) with install
  detection, plus a **per-session override** in the launcher.
- **Launch, resume, archive/restore, and preview** work for Copilot panes using
  the same app-minted session UUID contract (`copilot --session-id <uuid>` /
  `--resume <id>` — verified against Copilot CLI 1.0.80).
- Add a **Copilot observability adapter**: a Rust tailer over
  `~/.copilot/session-state/<session-id>/events.jsonl` feeding the existing
  app-owned pipelines — busy/idle status, pending-question alerts, usage footer
  (model + tokens; no context %), local title generation, activity timeline,
  and subagent rows. Declared degradation where Copilot exposes nothing
  (context %, tasks dir).
- **Specialists run on Copilot** by on-the-fly translation to a Copilot custom
  agent (`--agent`), with declared Claude-only degradation if the custom-agent
  surface proves unusable.
- **BREAKING**: **Remove the coordinator feature** (coordinator launch UI,
  pin, inbox rows, needs-input mirror, system prompt, lifecycle). The
  orchestration runtime (control socket, executor, MCP toolkit) and
  specialists remain. The unarchived `add-project-coordinator` and
  `coordinator-agent-titles` changes are superseded and deleted.

## Capabilities

### New Capabilities
- `agent-backends`: the backend descriptor contract — which agent CLIs exist,
  what each declares (program, args, capabilities), how the app resolves the
  backend for a launch (settings default + launcher override), and install
  detection.
- `copilot-observability`: deriving status, questions, usage, titles, and
  subagent rows for Copilot panes from `~/.copilot/session-state` events.

### Modified Capabilities
- `session-launcher`: launch plan carries an agent kind resolved from
  settings/override instead of always `claude`; readiness timing is
  per-backend.
- `agent-status-derivation`: status inputs become per-backend (Claude
  hooks/transcript vs Copilot events); busy markers per backend.
- `activity-events`: event sources are per-backend; Copilot events map into the
  same event vocabulary.
- `usage-dashboard`: footer/usage snapshots must render without Claude-only
  fields (context %) for backends that do not report them; model labels are
  backend-formatted.
- `session-titles`: title generation sources transcript text per backend.
- `task-detection`: the `~/.claude/tasks` + context-bridge fallback becomes a
  Claude-backend-specific requirement; Copilot panes show no task badge.
- `agent-specialists`: specialists gain a Copilot launch mapping (custom agent
  translation) with declared degradation.
- `agent-coordinator-workflows`: **removed**.
- `coordinator-lifecycle`: **removed**.

## Impact

- Frontend: `src/lib/launcher/**`, `src/lib/layout/**`, `src/lib/usage/**`,
  `src/lib/overview/**`, `src/lib/settings/**` (new `agent` slice + Settings UI),
  `src/lib/orchestration/**` (coordinator removal), `src/lib/specialists/**`,
  new `src/lib/agent/**`.
- Rust: new Copilot events tailer module; `shell_path.rs` safety-net dirs;
  `lib.rs` command surface. `pty.rs`, `orchestration.rs`, `usage.rs` snapshot
  watcher unchanged (already generic).
- Dependencies: GitHub Copilot CLI (`@github/copilot`, user-installed; app
  detects absence).
- OpenSpec: deletes two superseded unarchived changes; removes two specs on
  archive.
