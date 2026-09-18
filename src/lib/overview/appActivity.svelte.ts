// Whether the app is on screen, and when the machine last woke from sleep — the
// two signals the route's background pollers gate on (policy in pollGate.ts).
// `resumes` bumps whenever work that was deferred should run NOW: the window
// became visible again, or a wake was detected. Singleton; the route calls
// `start()` from an `$effect` and runs the returned cleanup on teardown.

import { isWakeGap } from './pollGate';

const HEARTBEAT_MS = 1000;

function documentVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

export class AppActivityStore {
  /** Bumps on hidden -> visible and on every detected wake. */
  resumes = $state(0);
  /** Epoch ms of the last detected wake (null until one happens). Not reactive:
   *  read inside interval callbacks, never to drive an effect. */
  lastWakeMs: number | null = null;

  /** Live visibility, read imperatively by interval callbacks (non-reactive so a
   *  poller's `$effect` never re-subscribes when the window hides). */
  get visible(): boolean {
    return documentVisible();
  }

  /** Test seam: feed a heartbeat observation. Returns whether it was a wake. */
  beat(prevMs: number, nowMs: number): boolean {
    if (!isWakeGap(prevMs, nowMs, HEARTBEAT_MS)) return false;
    this.lastWakeMs = nowMs;
    this.resumes++;
    return true;
  }

  start(): () => void {
    if (typeof window === 'undefined') return () => {};
    let prev = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      this.beat(prev, now);
      prev = now;
    }, HEARTBEAT_MS);
    const onVisibility = () => {
      if (documentVisible()) this.resumes++;
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }
}

export const appActivity = new AppActivityStore();
