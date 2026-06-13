// Reactive shell for the needs-input alerts (capability `needs-input-alerts`). Holds
// the previous-attention baseline, delegates the WHICH/WHETHER decisions to the pure
// core (`notify.ts`), and performs the side effects: a synthesized two-tone chime
// (WebAudio) and a native OS desktop notification (Tauri notification plugin). The
// always-mounted route (`+page.svelte`) drives it: while the app is still settling at
// startup it calls `prime(rows)` (track the baseline, fire nothing) and once settled
// `process(rows, ctx)`. Side effects are LIVE/MANUAL (no headless coverage of the
// chime / notification / OS permission).

import {
  attentionIds,
  newlyNeedsAttention,
  channelsToAlert,
  notificationTitle,
  notificationBody,
  type AlertContext
} from './notify';
import type { AgentRow } from './roster';
import { notifications } from '$lib/settings/notifications.svelte';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification
} from '@tauri-apps/plugin-notification';
import { invoke } from '@tauri-apps/api/core';

/** Whether we're running on macOS, where clicks are delivered via the custom
 *  `notify_agent` Rust path (capability `alert-click-focus`) rather than the
 *  plugin (which discards desktop clicks). Cheap, dependency-free webview check. */
function isMacOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac/i.test(navigator.userAgent ?? navigator.platform ?? '');
}

// --- Sound channel: a short synthesized two-tone "ding" -----------------------

let audioCtx: AudioContext | null = null;

/** Lazily construct (and reuse) the AudioContext; null outside the browser or when
 *  WebAudio is unavailable. Resumed on use since browsers start it suspended. */
function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) {
    try {
      audioCtx = new Ctor();
    } catch {
      return null;
    }
  }
  return audioCtx;
}

/** Play a brief rising two-tone chime. No-op when WebAudio is unavailable. When the
 *  context is suspended (autoplay policy), the tones are scheduled only AFTER
 *  `resume()` resolves so the very first chime isn't clipped. */
export function playChime(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  const schedule = () => {
    try {
      const now = ctx.currentTime;
      // Two short sine notes (A5 → D6), each with a quick attack + decay envelope.
      for (const [freq, at] of [
        [880, 0],
        [1174.66, 0.12]
      ] as const) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const t0 = now + at;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.2);
      }
    } catch {
      /* audio glitch — never let an alert throw */
    }
  };
  if (ctx.state === 'suspended') {
    void ctx.resume().then(schedule).catch(() => {});
  } else {
    schedule();
  }
}

// --- Desktop channel: native OS notification via the Tauri plugin -------------

/** Whether we have already prompted for permission this session (so we ask at most
 *  once). The LIVE grant state is always re-queried from the OS, so granting in
 *  System Settings after a denial recovers without an app restart. */
let permissionRequested = false;

/**
 * Ensure OS notification permission, requesting it once if needed. Returns whether
 * notifications may be shown. Re-queries the live OS grant on every call (so a user
 * who enables permission in System Settings recovers without restarting) and prompts
 * at most once. Swallows errors (e.g. running in the web preview, no Tauri shell) and
 * reports not-granted. Safe to call eagerly (when the user enables the desktop
 * channel) or lazily (before sending).
 */
export async function ensureDesktopPermission(): Promise<boolean> {
  try {
    if (await isPermissionGranted()) return true;
    if (permissionRequested) return false;
    permissionRequested = true;
    return (await requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

/** Show a desktop notification for `row`. No-op when permission is denied or the
 *  notification API is unavailable (web preview); never throws.
 *
 *  On macOS we route through the custom `notify_agent` Rust command so a body
 *  click can focus the agent (the plugin discards desktop clicks). Elsewhere we
 *  send via the plugin (no click handling). Both share the title/body builders. */
async function desktopNotify(row: AgentRow): Promise<void> {
  try {
    if (!(await ensureDesktopPermission())) return;
    const title = notificationTitle(row);
    const body = notificationBody(row);
    if (isMacOS()) {
      await invoke('notify_agent', { paneId: row.paneId, title, body });
    } else {
      sendNotification({ title, body });
    }
  } catch {
    /* non-Tauri / unavailable — swallow */
  }
}

// --- The controller ------------------------------------------------------------

/**
 * Drives the alerts off the live roster. The always-mounted route calls `prime(rows)`
 * while the app is still settling at startup (track the baseline, fire nothing) and
 * `process(rows, ctx)` once settled — fires each channel for agents that JUST entered
 * "Needs input", per that channel's mode.
 */
export class AlertController {
  /** The paneIds in "Needs input" as of the last call; null until first primed. */
  private prev: ReadonlySet<string> | null = null;

  /** Track the current attention set as the baseline WITHOUT firing — used while the
   *  app is still settling at startup so agents that surface as waiting during restore
   *  (e.g. a resumed session re-deriving its prompt) are folded into the baseline and
   *  never alert. Idempotent. */
  prime(rows: AgentRow[]): void {
    this.prev = attentionIds(rows);
  }

  /** React to a fresh roster: alert the channels for newly-attention agents. */
  process(rows: AgentRow[], ctx: AlertContext): void {
    const fresh = newlyNeedsAttention(this.prev, rows);
    this.prev = attentionIds(rows);
    if (fresh.length === 0) return;
    const prefs = notifications.prefs;
    for (const row of fresh) {
      const ch = channelsToAlert(prefs, row, ctx);
      if (ch.sound) playChime();
      if (ch.desktop) void desktopNotify(row);
    }
  }
}

/** The singleton alert controller, driven by the always-mounted route. */
export const alerts = new AlertController();
