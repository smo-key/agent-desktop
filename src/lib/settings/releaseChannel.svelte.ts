// Which release train the app follows (release-channels spec).
//
//   - `stable` — the default. Only non-prerelease GitHub Releases are considered,
//     which is what `releases/latest` resolves to.
//   - `beta`   — earlier, less-tested builds. BOTH manifests are considered and
//     the highest semantic version wins, so a stable hotfix that outranks the
//     current beta still reaches beta users.
//
// Stored as the `releaseChannel` slice of the shared `settings.json` blob, like
// the other settings stores: loaded once on startup, saved best-effort with a
// merge so sibling slices are never clobbered. DEFAULTS TO `stable` — a fresh
// install, an absent slice, a malformed slice and an unknown value all resolve
// there, so nobody is opted into prereleases by accident or by data corruption.

import { loadSettings, saveSettingsSlice } from './persist';

/** The release channels, in the order the Settings selector lists them. */
export const RELEASE_CHANNELS = ['stable', 'beta'] as const;
export type ReleaseChannel = (typeof RELEASE_CHANNELS)[number];

/** Release-channel preference. */
export interface ReleaseChannelPrefs {
  channel: ReleaseChannel;
}

/** Defaults for a fresh install: the stable train. */
export const DEFAULT_RELEASE_CHANNEL_PREFS: ReleaseChannelPrefs = {
  channel: 'stable'
};

/** Human-facing labels for the selector. */
export const RELEASE_CHANNEL_LABELS: Record<ReleaseChannel, string> = {
  stable: 'Stable',
  beta: 'Beta'
};

function isReleaseChannel(v: unknown): v is ReleaseChannel {
  return typeof v === 'string' && (RELEASE_CHANNELS as readonly string[]).includes(v);
}

/** PURE: validate/normalize the persisted `releaseChannel` slice into a fully-
 *  defaulted `ReleaseChannelPrefs`. Tolerates any shape — non-objects, arrays,
 *  missing fields and unknown channel names all fall back to `stable`, because
 *  the failure mode of guessing wrong here is shipping prereleases to someone who
 *  never asked for them. */
export function parseReleaseChannelPrefs(raw: unknown): ReleaseChannelPrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_RELEASE_CHANNEL_PREFS };
  }
  const obj = raw as Record<string, unknown>;
  if (isReleaseChannel(obj.channel)) return { channel: obj.channel };
  return { ...DEFAULT_RELEASE_CHANNEL_PREFS };
}

/**
 * Reactive release-channel store. Singleton, read by the update check (which
 * consults it on every check rather than taking a channel parameter, so the
 * launch check, the hourly poll, the retry seam and the manual Settings check all
 * follow the preference) and read/written by the Settings modal.
 */
export class ReleaseChannelStore {
  /** The live preferences (deep-reactive via the runes proxy). */
  prefs = $state<ReleaseChannelPrefs>({ ...DEFAULT_RELEASE_CHANNEL_PREFS });

  /** True once `load()` has resolved. */
  loaded = $state(false);

  /** True once the user has chosen a channel in this session. Guards against a
   *  slow `load()` landing AFTER the choice and reverting it in memory while the
   *  save has already written the new value to disk — which would leave the
   *  dropdown, the checks and the file disagreeing until the next restart. */
  private userSet = false;

  /** The effective channel. Reads before `load()` resolves see `stable`, which is
   *  the safe default for a check that races startup. */
  get channel(): ReleaseChannel {
    return this.prefs.channel;
  }

  /** Load persisted prefs from the shared settings blob's `releaseChannel` slice.
   *  On a fresh install `DEFAULT_RELEASE_CHANNEL_PREFS` apply. Never throws.
   *  Call once on mount. */
  async load(): Promise<void> {
    const settings = await loadSettings();
    // A choice made while this was in flight wins: it is what the user asked for
    // AND what `setChannel` has already persisted.
    if (!this.userSet) this.prefs = parseReleaseChannelPrefs(settings.releaseChannel);
    this.loaded = true;
  }

  /** Set the channel and persist (best-effort). Unknown values are ignored.
   *  Returns true when the channel actually changed, so the caller can kick off
   *  an immediate re-check rather than waiting for the hourly poll. */
  setChannel(channel: ReleaseChannel): boolean {
    if (!isReleaseChannel(channel) || channel === this.prefs.channel) return false;
    this.userSet = true;
    this.prefs = { ...this.prefs, channel };
    void this.save();
    return true;
  }

  /** Persist the current prefs as the `releaseChannel` slice, merging into the
   *  shared settings blob so sibling slices are preserved. */
  private async save(): Promise<void> {
    await saveSettingsSlice('releaseChannel', this.prefs);
  }
}

/** The singleton release-channel store. */
export const releaseChannel = new ReleaseChannelStore();
