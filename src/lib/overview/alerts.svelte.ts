// Reactive shell for the needs-input alerts (capability `needs-input-alerts`). Holds
// the previous-attention baseline, reads the live channel prefs + focus context,
// delegates the WHICH/WHETHER decisions to the pure core (`notify.ts`), and performs
// the side effects: a synthesized two-tone chime (WebAudio) and a native OS desktop
// notification (Tauri notification plugin). The Inbox calls `process(rows, ctx)` from
// an `$effect`; the baseline primes on the first call so launch-time waiters never
// alert. Side effects are LIVE/MANUAL (no headless coverage of the chime/notification).

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

// --- Sound channel: a short synthesized two-tone "ding" -----------------------

let audioCtx: AudioContext | null = null;

/** Lazily construct (and reuse) the AudioContext; null outside the browser or when
 *  WebAudio is unavailable. Resumed on use since browsers start it suspended. */
function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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

/** Play a brief rising two-tone chime. No-op when WebAudio is unavailable. */
export function playChime(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') void ctx.resume();
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
}

// --- Desktop channel: native OS notification via the Tauri plugin -------------

/** Cached permission so we don't re-prompt on every alert. */
let desktopPermission: 'granted' | 'denied' | 'default' | null = null;

/**
 * Ensure OS notification permission, requesting it once if needed. Returns whether
 * notifications may be shown. Swallows errors (e.g. running in the web preview, no
 * Tauri shell) and reports not-granted. Safe to call eagerly (when the user enables
 * the desktop channel) or lazily (before sending).
 */
export async function ensureDesktopPermission(): Promise<boolean> {
  try {
    if (desktopPermission === 'granted') return true;
    if (desktopPermission === 'denied') return false;
    let granted = await isPermissionGranted();
    if (!granted) {
      const result = await requestPermission();
      desktopPermission = result;
      granted = result === 'granted';
    } else {
      desktopPermission = 'granted';
    }
    return granted;
  } catch {
    return false;
  }
}

/** Show a desktop notification for `row`. No-op when permission is denied or the
 *  notification API is unavailable (web preview); never throws. */
async function desktopNotify(row: AgentRow): Promise<void> {
  try {
    if (!(await ensureDesktopPermission())) return;
    sendNotification({ title: notificationTitle(), body: notificationBody(row) });
  } catch {
    /* non-Tauri / unavailable — swallow */
  }
}

// --- The controller ------------------------------------------------------------

/**
 * Drives the alerts off the live roster. `process(rows, ctx)` is called whenever the
 * roster or focus context changes; it fires each channel for agents that JUST entered
 * "Needs input", per that channel's mode. Primes on the first call (fires nothing).
 */
export class AlertController {
  /** The paneIds in "Needs input" as of the last call; null until primed. */
  private prev: ReadonlySet<string> | null = null;

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

  /** Drop the baseline so the next `process` re-primes (e.g. on inbox unmount). */
  reset(): void {
    this.prev = null;
  }
}

/** The singleton alert controller, driven by the Inbox. */
export const alerts = new AlertController();
