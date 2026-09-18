// Agent-executable preferences (`wsl-agent-launch`). Stored as the `agentPaths`
// slice of the shared `settings.json` blob, like every other settings store —
// loaded once on startup, saved merge-aware so sibling slices survive.
//
// An EMPTY value means "use the detected executable", which the backend resolves
// by probing where the configured shell implies: inside the WSL distro when the
// shell is a distro launcher, else the host PATH. The resolution order itself
// lives in the pure `./agentPaths` module so it is testable without a backend.
//
// Why this store watches the SHELL: the shell preference is the only signal for
// where the agent CLIs live. Changing it invalidates every detected path, so
// `redetect()` must run on that change — otherwise the settings placeholder
// keeps showing a Linux path after the user switches back to `pwsh`.

import { invoke } from '@tauri-apps/api/core';
import { distroFor, isWslShell } from '$lib/shell/wsl';
import {
  defaultAgentPaths,
  parseAgentPaths,
  resolveAgentExecutable,
  type AgentPaths,
  type DetectedAgentPaths
} from './agentPaths';
import { loadSettings, saveSettingsSlice } from './persist';
import type { AgentKind } from '$lib/agent/backends';

/** Shape returned by the `detect_agent_executables` command. */
interface DetectResult {
  claude: string | null;
  copilot: string | null;
  /** Present inside the distro? Reported by the probe and currently UNUSED: the
   *  statusline is omitted under WSL regardless, because its env never crosses
   *  the boundary (no WSLENV). Kept because restoring that pipeline would need
   *  exactly this signal. */
  node: string | null;
}

/**
 * Reactive agent-executable store. Singleton, imported by the settings modal
 * (read/write) and by the spawn path (read).
 */
export class AgentPathsStore {
  /** The live preferences (deep-reactive via the runes proxy). */
  prefs = $state<AgentPaths>(defaultAgentPaths());

  /** What detection found, shown as each input's placeholder. */
  detected = $state<DetectedAgentPaths>({});

  /** True once `load()` has resolved. */
  loaded = $state(false);

  /** The shell the current detection was performed against. */
  private detectedForShell: string | null = null;

  /** The distro the current detection was performed against (`null` off WSL). */
  private detectedForDistro: string | null = null;

  /** Monotonic probe id. A slow probe that resolves AFTER a newer one must not
   *  overwrite it — a cold distro takes seconds while a host probe is instant,
   *  so out-of-order completion is the normal case, not a rare race. */
  private generation = 0;

  /**
   * Probe for the agent executables against `shell`, then load the persisted
   * preferences. NEVER rejects: the layout restore in `+page.svelte` is chained
   * onto the settings load, so a rejection here would leave the user with no
   * restored panes at all. Call once on mount.
   */
  async load(shell: string): Promise<void> {
    await this.redetect(shell);
    try {
      const settings = await loadSettings();
      this.prefs = parseAgentPaths(settings.agentPaths);
    } catch {
      // Keep the defaults — an unreadable slice must not break startup.
    }
    this.loaded = true;
  }

  /**
   * Re-probe against `shell`. Called on mount and whenever the shell preference
   * changes. A failed probe clears the detected values rather than leaving stale
   * ones on display — showing a path detected under a different shell would be
   * worse than showing none.
   */
  async redetect(shell: string): Promise<void> {
    const gen = ++this.generation;
    const wsl = isWslShell(shell);
    const distro = wsl ? distroFor(shell, null) : null;
    // Cleared UP FRONT, not just on failure. A probe of a cold distro blocks for
    // seconds, and during that window `executableFor` would otherwise still hand
    // out the PREVIOUS shell's path — e.g. a Windows `claude.cmd` fed to a distro
    // as its in-distro executable, which dies with "No such file or directory".
    this.detected = {};
    this.detectedForShell = shell;
    this.detectedForDistro = distro;
    try {
      // The heuristic lives in ONE place (the tested `$lib/shell/wsl` module);
      // Rust just executes the probe it is told to.
      const found = await invoke<DetectResult>('detect_agent_executables', {
        wsl,
        distro
      });
      if (gen !== this.generation) return; // superseded by a newer probe
      this.detected = { claude: found.claude, copilot: found.copilot };
    } catch {
      // Non-Tauri/dev context or command failure. Detection is ADVISORY: an
      // empty result falls through to the bare backend program at spawn time.
      if (gen !== this.generation) return;
      this.detected = {};
    }
  }

  /** The shell the current detection reflects (`null` before the first probe). */
  shellDetectedFor(): string | null {
    return this.detectedForShell;
  }

  /**
   * The executable that would be spawned for `kind` right now.
   *
   * `launchDistro` guards a real mismatch: detection probes the distro the SHELL
   * names, but a launch targets the distro the CWD names, and the cwd wins by
   * design. With shell `ubuntu.exe` and a project under `\\wsl.localhost\Debian\…`
   * we would otherwise hand Debian an absolute path that only exists in Ubuntu.
   * When they disagree, the DETECTED path is dropped and the bare backend name
   * is used, which the login shell resolves inside whichever distro is targeted.
   * An explicit user preference always wins — it is not a guess.
   */
  executableFor(kind: AgentKind, launchDistro?: string | null): string {
    const sameDistro =
      launchDistro === undefined || (launchDistro ?? null) === this.detectedForDistro;
    return resolveAgentExecutable(kind, this.prefs, sameDistro ? this.detected : {});
  }

  /** Set an agent's executable (empty clears back to the detected value). */
  setPath(kind: AgentKind, value: string): void {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    this.prefs = { ...this.prefs, [kind]: trimmed };
    void this.save();
  }

  /** Persist the current prefs as the `agentPaths` slice, merging into the
   *  shared settings blob so sibling slices are preserved. */
  private async save(): Promise<void> {
    await saveSettingsSlice('agentPaths', this.prefs);
  }
}

/** The singleton agent-paths store. */
export const agentPathsSettings = new AgentPathsStore();
