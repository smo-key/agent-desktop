// Fetch the usage-dashboard paths (installed wrapper + snapshots dir) from the
// Rust `usage_paths` command, memoized so the many panes that mount share a
// SINGLE round-trip. The Rust side (re)installs the wrapper and ensures the dirs
// exist as a side effect, so this is the one place the frontend needs to call.
//
// On any failure we resolve to `null` (logged once) rather than throwing, so a
// `claude` pane can still spawn unwrapped instead of failing to launch — the
// pure `buildSpawnOverride` treats `null` paths as "spawn claude unchanged".

import { invoke } from '@tauri-apps/api/core';
import type { UsagePaths } from './spawn';

// A single in-flight/cached promise. Once resolved (to paths or null) it is
// reused for every subsequent pane mount.
let cached: Promise<UsagePaths | null> | undefined;

/**
 * Resolve the usage paths once and cache them. Returns `null` if the command
 * fails (e.g. running outside Tauri, or an install error) so callers can spawn
 * `claude` unwrapped rather than break.
 */
export function getUsagePaths(): Promise<UsagePaths | null> {
  if (!cached) {
    cached = invoke<UsagePaths>('usage_paths').catch((err) => {
      console.warn('usage_paths failed; claude panes spawn unwrapped:', err);
      return null;
    });
  }
  return cached;
}
