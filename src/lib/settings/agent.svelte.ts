// Agent-backend preference: which agent CLI a new agent session launches
// (`agent-backends` capability). Stored as the `agent` slice of the shared
// `settings.json` blob like the other settings stores — loaded once on startup,
// saved (best-effort, merge-aware) on change so sibling slices survive.
//
// The persisted value is pushed into the pure `$lib/agent/defaultAgent` module,
// which is what the launcher actually reads — resolution stays framework-free.

import { invoke } from '@tauri-apps/api/core';
import { parseAgentKind, backendFor, type AgentKind } from '$lib/agent/backends';
import { setAgentPreference } from '$lib/agent/defaultAgent';
import { loadSettings, saveSettingsSlice } from './persist';

/** Agent preference. */
export interface AgentPrefs {
  kind: AgentKind;
}

/** Defaults for a fresh install: Claude Code. */
export const DEFAULT_AGENT_PREFS: AgentPrefs = { kind: 'claude' };

/** PURE: validate/normalize the persisted `agent` slice. Tolerates any shape —
 *  non-objects, missing fields, and unknown kinds fall back to claude. */
export function parseAgentPrefs(raw: unknown): AgentPrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_AGENT_PREFS };
  }
  return { kind: parseAgentKind((raw as Record<string, unknown>).kind) };
}

/**
 * Reactive agent settings store. Singleton, imported by the settings modal
 * (read/write) and the launcher (read). The launcher's plan builder reads the
 * resolved value from `$lib/agent/defaultAgent`, which this store keeps in sync.
 */
export class AgentStore {
  /** The live preference. */
  prefs = $state<AgentPrefs>({ ...DEFAULT_AGENT_PREFS });

  /** Whether the SELECTED backend's executable was found on the resolved PATH.
   *  `null` = unknown (probe unavailable, e.g. non-Tauri dev). */
  installed = $state<boolean | null>(null);

  /** True once `load()` has resolved. */
  loaded = $state(false);

  /** Monotonic probe generation: a stale probe result (rapid kind switches)
   *  must never overwrite the CURRENT selection's install state. */
  #probeGen = 0;

  /** Load the persisted preference and probe the selected CLI. Never throws. */
  async load(): Promise<void> {
    try {
      const settings = await loadSettings();
      this.prefs = parseAgentPrefs(settings.agent);
      setAgentPreference(this.prefs.kind);
    } catch {
      // Keep defaults — a failed read must never block startup.
    }
    await this.probeInstalled();
    this.loaded = true;
  }

  /** Set the default agent kind and persist it. */
  setKind(kind: AgentKind): void {
    this.prefs = { ...this.prefs, kind: parseAgentKind(kind) };
    setAgentPreference(this.prefs.kind);
    void this.save();
    void this.probeInstalled();
  }

  /**
   * Probe whether the selected backend's executable resolves on the login-shell
   * PATH (`program_on_path` command). Best-effort: any failure leaves
   * `installed` at `null` (no hint shown) rather than a false negative.
   */
  private async probeInstalled(): Promise<void> {
    const gen = ++this.#probeGen;
    try {
      const program = backendFor(this.prefs.kind).program;
      const found = await invoke<boolean>('program_on_path', { program });
      if (gen === this.#probeGen) this.installed = found;
    } catch {
      if (gen === this.#probeGen) this.installed = null;
    }
  }

  /** Persist the current prefs as the `agent` slice (merge-aware). */
  private async save(): Promise<void> {
    await saveSettingsSlice('agent', this.prefs);
  }
}

/** The singleton agent store. */
export const agentSettings = new AgentStore();
