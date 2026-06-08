// First-launch model onboarding gate (capability `model-onboarding`). On launch
// the app checks whether the on-device models the current voice selection needs
// are present; when they are missing, a full-screen gate (ModelOnboarding.svelte)
// prompts a one-time download. Detection is PRESENCE-based (driven by the Rust
// `voice_models_status` via `modelsStatus`), so the gate disappears for good once
// the files are on disk. "Skip for now" sets a SESSION-only dismissal: it won't
// nag again this run, but reappears next launch while models remain missing.
//
// Only UI/decision state lives here; the actual download reuses `ensureModels` +
// the `modelDownload` progress store. The decision itself is the pure
// `shouldShowOnboarding` so it is testable apart from the runes store.

import { modelsStatus, type ModelsStatus } from '$lib/voice/models';

/**
 * PURE: whether to show the onboarding gate. Show only once status is KNOWN
 * (non-null — avoids a flash before the first check resolves), the required models
 * are NOT ready, and the user hasn't dismissed the gate for this session.
 */
export function shouldShowOnboarding(status: ModelsStatus | null, dismissed: boolean): boolean {
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

  /** Whether the full-screen gate should be shown right now. */
  get visible(): boolean {
    return shouldShowOnboarding(this.status, this.dismissedThisSession);
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

  /** Dismiss the gate for the current session only (next launch re-evaluates). */
  dismiss(): void {
    this.dismissedThisSession = true;
  }
}

/** The singleton onboarding store, imported by the route + the gate component. */
export const onboarding = new OnboardingStore();
