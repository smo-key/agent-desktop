// First-launch model onboarding gate (capability `model-onboarding`). On launch
// the app checks whether the on-device models the current voice selection needs
// are present; when they are missing, a full-screen gate (ModelOnboarding.svelte)
// prompts a one-time download. The gate is shown at most ONCE PER USER: a persisted
// `seen` flag (in the `onboarding` settings slice) is set the moment the user is
// done with it (Skip, or a completed download), and once set the gate never returns
// — independent of whether the model files are actually present. A `dismissed`
// session flag additionally hides it for the current run.
//
// Only UI/decision state lives here; the actual download reuses `ensureModels` +
// the `modelDownload` progress store. The decision itself is the pure
// `shouldShowOnboarding` so it is testable apart from the runes store.

import { modelsStatus, type ModelsStatus } from '$lib/voice/models';
import { loadSettings, saveSettingsSlice } from '$lib/settings/persist';

/** Settings slice key holding the one-time onboarding flag. */
const ONBOARDING_SLICE = 'onboarding';

/** Parse the persisted `onboarding` slice into a `seen` boolean (defaults false). */
function parseSeen(slice: unknown): boolean {
  return !!(slice && typeof slice === 'object' && (slice as { seen?: unknown }).seen === true);
}

/**
 * PURE: whether to show the onboarding gate. Never show once the user has already
 * SEEN it (one-time per user, regardless of model presence). Otherwise show only
 * once status is KNOWN (non-null — avoids a flash before the first check resolves),
 * the required models are NOT ready, and the gate hasn't been dismissed this session.
 */
export function shouldShowOnboarding(
  status: ModelsStatus | null,
  dismissed: boolean,
  seen: boolean,
): boolean {
  if (seen) return false;
  if (!status) return false;
  if (status.ready) return false;
  return !dismissed;
}

/** Reactive first-launch onboarding store. */
export class OnboardingStore {
  /** Latest readiness from `voice_models_status`; null until the first check. */
  status = $state<ModelsStatus | null>(null);

  /** Session-only dismissal set by "Skip for now". Not persisted. */
  dismissedThisSession = $state(false);

  /** Persisted one-time flag: true once the user has seen the gate (Skip or a
   *  completed download). When set, the gate never shows again. Loaded by `load()`. */
  seen = $state(false);

  /** Whether the full-screen gate should be shown right now. */
  get visible(): boolean {
    return shouldShowOnboarding(this.status, this.dismissedThisSession, this.seen);
  }

  /** The missing model filenames the current check reported (empty when none/unknown). */
  get missing(): string[] {
    return this.status?.missing ?? [];
  }

  /**
   * Check model readiness for the (tier, polish) selection and record it. Reused
   * both on launch and after a download attempt to re-evaluate. Never throws —
   * `modelsStatus` degrades a transport failure to "not ready, nothing known
   * missing", which still surfaces the gate so the user can retry.
   */
  async check(tier: string, polish: boolean): Promise<void> {
    this.status = await modelsStatus(tier, polish);
  }

  /** Load the persisted one-time `seen` flag from the `onboarding` settings slice.
   *  Defaults to false on a fresh install. Never throws. Call once on mount, before
   *  `check`, so a returning user never sees a flash of the gate. */
  async load(): Promise<void> {
    const settings = await loadSettings();
    this.seen = parseSeen(settings[ONBOARDING_SLICE]);
  }

  /** Mark the gate seen for good and persist it (best-effort). The gate will not be
   *  shown again on this or any future launch. Used after a completed download. */
  markSeen(): void {
    this.seen = true;
    void saveSettingsSlice(ONBOARDING_SLICE, { seen: true });
  }

  /** Dismiss the gate ("Skip for now"). Hides it for the session AND records the
   *  persisted one-time flag so it never returns on a later launch. */
  dismiss(): void {
    this.dismissedThisSession = true;
    this.markSeen();
  }
}

/** The singleton onboarding store, imported by the route + the gate component. */
export const onboarding = new OnboardingStore();
