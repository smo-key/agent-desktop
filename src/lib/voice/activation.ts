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
import { voiceStore } from '$lib/voice/voiceStore.svelte';
import { getActivePipeline } from '$lib/voice/pipeline';

/**
 * Subscribe to the native `voice://activate` event (a solo right-⌘ tap) and TOGGLE
 * the voice panel (respecting the `enabled` setting):
 *   - closed → open and start recording;
 *   - open   → finalize ("stop & insert"): run the final pass, polish per settings,
 *     and insert into the focused/selected agent (or spawn one). (Escape still
 *     cancels/discards — handled in VoicePanel.)
 * Returns the unlisten fn for teardown.
 */
export async function initVoiceActivation(): Promise<() => void> {
  return listen('voice://activate', () => {
    if (!voice.prefs.enabled) return;
    if (voiceStore.open) {
      // Second tap while recording → stop & insert via the live pipeline.
      void getActivePipeline()?.stopAndInsert();
    } else {
      voiceStore.show();
    }
  });
}
