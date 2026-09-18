// The channel-aware update check (release-channels + desktop-auto-update specs).
//
// The updater plugin's own `check()` reads its endpoints from tauri.conf.json and
// uses the FIRST that responds — not the highest version — and exposes no runtime
// endpoint override in either its JS options or its plugin builder. So the check
// itself lives in Rust (`updater_check`, src-tauri/src/updates.rs), which builds
// the updater against the endpoint(s) for the selected channel and, on `beta`,
// keeps the highest-versioned candidate across both manifests.
//
// That command returns the plugin's OWN metadata shape — including a resource id
// registered in this webview's resource table — so we rebuild a real plugin
// `Update` from it here. Everything after the check (download, progress events,
// install, `close()`) therefore still runs through the plugin, unchanged.

import { invoke } from '@tauri-apps/api/core';
import { Update } from '@tauri-apps/plugin-updater';
import type { ReleaseChannel } from '$lib/settings/releaseChannel.svelte';

/** The metadata `updater_check` returns — the same fields the plugin's `check`
 *  command returns, so `new Update(meta)` accepts it verbatim. */
export interface ChannelUpdateMetadata {
  rid: number;
  currentVersion: string;
  version: string;
  date?: string;
  body?: string;
  rawJson: Record<string, unknown>;
}

/**
 * Check `channel` for an available update.
 *
 * Resolves to a plugin `Update` handle (whose `download`/`install`/`close` work
 * exactly as if the plugin's own `check()` had produced it) or `null` when the
 * channel has nothing newer than the running version. Rejects when the check
 * itself fails (offline, an unreachable manifest, or outside the Tauri runtime);
 * callers decide whether to surface that.
 */
export async function checkOnChannel(channel: ReleaseChannel): Promise<Update | null> {
  const meta = await invoke<ChannelUpdateMetadata | null>('updater_check', { channel });
  if (!meta) return null;
  return new Update(meta);
}
