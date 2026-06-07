// Native double-tap-right-Command activation bridge. The Rust backend
// (`src-tauri/src/voice_activation.rs`) installs an NSEvent monitor that emits a
// `voice://activate` Tauri event on a completed double-tap of the RIGHT Command
// key. Here we listen for it and open the voice panel — but only when voice input
// is enabled in settings (mirroring the on-screen mic button's gate).
//
// If the native monitor fails to install (e.g. no Accessibility permission), this
// listener simply never fires; the on-screen mic button remains the always-works
// fallback entry point.

import { listen } from '@tauri-apps/api/event';
import { voice } from '$lib/settings/voice.svelte';
import { voiceStore } from '$lib/voice/voiceStore.svelte';

/**
 * Subscribe to the native `voice://activate` event and open the voice panel on
 * each emission (respecting the `enabled` setting). Returns the unlisten fn for
 * teardown.
 */
export async function initVoiceActivation(): Promise<() => void> {
  return listen('voice://activate', () => {
    if (voice.prefs.enabled) voiceStore.show();
  });
}
