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
  /** Present inside the distro? The statusline is invoked as `node <path>`, so
   *  its retention under WSL depends on this. */
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

  /** Whether `node` exists where the agent runs. Gates the statusline (design D5). */
  nodeAvailable = $state(true);

  /** True once `load()` has resolved. */
  loaded = $state(false);

  /** The shell the current detection was performed against. */
  private detectedForShell: string | null = null;

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
    this.detectedForShell = shell;
    const wsl = isWslShell(shell);
    try {
      // The heuristic lives in ONE place (the tested `$lib/shell/wsl` module);
      // Rust just executes the probe it is told to.
      const found = await invoke<DetectResult>('detect_agent_executables', {
        wsl,
        distro: wsl ? distroFor(shell, null) : null
      });
      this.detected = { claude: found.claude, copilot: found.copilot };
      // Outside WSL the app's own node is the one that runs hooks, and that has
      // always been assumed present; only the in-distro case is conditional.
      this.nodeAvailable = wsl ? Boolean(found.node) : true;
    } catch {
      // Non-Tauri/dev context or command failure. Detection is ADVISORY: an
      // empty result falls through to the bare backend program at spawn time.
      this.detected = {};
      this.nodeAvailable = !wsl;
    }
  }

  /** The shell the current detection reflects (`null` before the first probe). */
  shellDetectedFor(): string | null {
    return this.detectedForShell;
  }

  /** The executable that would be spawned for `kind` right now. */
  executableFor(kind: AgentKind): string {
    return resolveAgentExecutable(kind, this.prefs, this.detected);
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
