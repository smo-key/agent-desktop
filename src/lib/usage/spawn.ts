// PURE helper: build the per-pane PTY spawn parameters so a `claude` pane is
// launched THROUGH the app-managed statusline wrapper, while every other
// program (the login shell) spawns completely unchanged.
//
// Kept framework-free (no Svelte/Tauri imports) so it is trivially unit-tested.
// `TerminalPane.svelte` calls `buildSpawnOverride(...)` right before `pty_spawn`
// to obtain the final `{ args, env }` it forwards to the backend.
//
// Why an inline `--settings` override (design D3 / usage-dashboard spec): it
// merges per-key over the user's `~/.claude/settings.json` for THIS session
// only — overriding just `statusLine.command` — and NEVER reads, writes, or
// relocates the global config. The wrapper then (a) delegates to the user's real
// `~/.claude/hooks/statusline.js` for an unchanged in-pane bar and (b) writes a
// per-pane snapshot the dashboard watches. The two env vars
// (`AGENT_DESKTOP_PANE`, `AGENT_DESKTOP_SNAPSHOT_DIR`) reach the
// `statusLine.command` (verified, appendix A.1) so the wrapper knows which
// snapshot file to write and where.

/** Absolute paths resolved once from the `usage_paths` Tauri command. */
export interface UsagePaths {
  /** Absolute path to the installed `statusline-wrapper.js`. */
  wrapperPath: string;
  /** Absolute path to the snapshots dir. */
  snapshotDir: string;
}

/** Inputs for building a pane's spawn override. */
export interface SpawnOverrideInput {
  /** The program the pane will run (`claude` is the only one we wrap). */
  program: string;
  /** The pane's existing args (preserved verbatim after any injected ones). */
  args: string[];
  /** The stable frontend pane id; becomes `AGENT_DESKTOP_PANE` + the snapshot filename key. */
  paneId: string;
  /**
   * Resolved usage paths, or `null` if they could not be fetched. When null we
   * spawn `claude` UNCHANGED rather than half-wired — a missing wrapper must
   * never break launching a session.
   */
  usagePaths: UsagePaths | null;
}

/**
 * The spawn parameters forwarded to `pty_spawn`. `env` is the optional extra
 * environment merged (caller-wins) on top of the backend's seeded base. For a
 * shell pane (or `claude` with no resolved usage paths) `env` is `undefined`
 * and `args` is unchanged, so those panes spawn exactly as before.
 */
export interface SpawnOverride {
  args: string[];
  env?: Array<[string, string]>;
}

/** The settings key we override for the per-session statusline. */
const STATUS_LINE_TYPE = 'command';

/**
 * Build the spawn args/env for a pane.
 *
 *  - `program === 'claude'` AND usage paths resolved →
 *      args = ['--settings', JSON.stringify({ statusLine: { type: 'command',
 *              command: <wrapperPath> } }), ...existingArgs]
 *      env  = [['AGENT_DESKTOP_PANE', paneId],
 *              ['AGENT_DESKTOP_SNAPSHOT_DIR', snapshotDir]]
 *  - anything else (shell panes, or `claude` with `usagePaths === null`) →
 *      args = existingArgs unchanged, env = undefined (no `--settings`, no env).
 *
 * Pure: never mutates the input `args` array.
 */
export function buildSpawnOverride(input: SpawnOverrideInput): SpawnOverride {
  const { program, args, paneId, usagePaths } = input;

  // Only `claude` panes are wrapped; everything else spawns verbatim. If we
  // could not resolve the wrapper path, spawn `claude` unchanged too — better a
  // plain session than a broken launch.
  if (program !== 'claude' || !usagePaths) {
    return { args: [...args] };
  }

  const settings = {
    statusLine: {
      type: STATUS_LINE_TYPE,
      command: usagePaths.wrapperPath
    }
  };

  return {
    args: ['--settings', JSON.stringify(settings), ...args],
    env: [
      ['AGENT_DESKTOP_PANE', paneId],
      ['AGENT_DESKTOP_SNAPSHOT_DIR', usagePaths.snapshotDir]
    ]
  };
}
