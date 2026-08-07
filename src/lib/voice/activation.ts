// Native right-Command tap activation bridge. The Rust backend
// (`src-tauri/src/voice_activation.rs`) installs an NSEvent monitor that emits a
// `voice://activate` Tauri event on a solo tap of the RIGHT Command key (pressed
// and released with no other key — so it never fires on right-⌘ shortcuts). Here
// we listen for it and open the voice panel — but only when voice input is enabled
// in settings (mirroring the on-screen mic button's gate).
//
// If the native monitor fails to install (e.g. no Accessibility permission), this
// listener simply never fires; the on-screen mic button remains the always-works
// fallback entry point.

import { listen } from '@tauri-apps/api/event';
import { voice } from '$lib/settings/voice.svelte';
import { voiceStore, type VoiceState } from '$lib/voice/voiceStore.svelte';
import { getActivePipeline } from '$lib/voice/pipeline';

/** What a right-⌘ tap should do, given the current settings + panel phase. */
export type ActivationAction = 'ignore' | 'open' | 'retry' | 'finalize';

/**
 * PURE: decide what a solo right-⌘ tap does. Kept separate from the Tauri
 * `listen` wiring below so every phase is unit-testable headlessly.
 *
 *  - voice input disabled → `ignore` (mirrors the on-screen mic button's gate).
 *  - panel closed → `open` (start a dictation session).
 *  - panel in a FAILURE phase (`error` / `denied`) → `retry`. Routing these to
 *    `finalize` is what made the gesture inert after a failed dictation: the
 *    pipeline is already `#finished`, so `stopAndInsert()` bails on its
 *    `state !== 'recording'` guard and the error just sits there.
 *  - otherwise → `finalize` ("stop & insert"). Harmless mid-request/transcribe:
 *    the pipeline's own guard makes it a no-op in those phases.
 */
export function activationAction(
  enabled: boolean,
  open: boolean,
  state: VoiceState
): ActivationAction {
  if (!enabled) return 'ignore';
  if (!open) return 'open';
  if (state === 'error' || state === 'denied') return 'retry';
  return 'finalize';
}

/**
 * Subscribe to the native `voice://activate` event (a solo right-⌘ tap) and TOGGLE
 * the voice panel (respecting the `enabled` setting):
 *   - closed → open and start recording;
 *   - errored/denied → retry: clear the failure and start a fresh capture, so the
 *     gesture is never a dead end;
 *   - open   → finalize ("stop & insert"): run the final pass, polish per settings,
 *     and insert into the focused/selected agent (or spawn one). (Escape still
 *     cancels/discards — handled in VoicePanel.)
 * Returns the unlisten fn for teardown.
 */
export async function initVoiceActivation(): Promise<() => void> {
  return listen('voice://activate', () => {
    switch (activationAction(voice.prefs.enabled, voiceStore.open, voiceStore.state)) {
      case 'open':
        voiceStore.show();
        break;
      case 'retry':
        voiceStore.retry();
        break;
      case 'finalize':
        // Second tap while recording → stop & insert via the live pipeline.
        void getActivePipeline()?.stopAndInsert();
        break;
      case 'ignore':
        break;
    }
  });
}
