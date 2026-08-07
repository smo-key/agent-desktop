// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MicCapture } from './capture';

// `capture.ts` is the deliberately-thin browser wrapper, so it is normally left
// untested. The ONE thing worth pinning here is its teardown-during-start race:
// `stop()` releases resources by inspecting `#stream` / `#recorder` / `#audioCtx`,
// all of which are still null while `getUserMedia` is pending. Without an explicit
// "stop requested" flag that call is a total no-op, and the stream acquired moments
// later is never released — the OS mic indicator stays lit with the panel closed.
//
// Only `getUserMedia` + `MediaRecorder` are stubbed; the AudioContext path is left
// absent so `start()` takes its own best-effort catch (jsdom has no AudioContext),
// which is exactly the shape we want to assert the stream teardown against.

/** A fake MediaStreamTrack that records whether it was stopped. */
function fakeTrack() {
  return { stop: vi.fn(), kind: 'audio' };
}

/** Resolve/reject `getUserMedia` by hand so we can act DURING the pending window. */
function deferredMedia() {
  let resolve!: (s: unknown) => void;
  const promise = new Promise((r) => (resolve = r));
  const track = fakeTrack();
  const stream = { getTracks: () => [track] };
  return { promise, resolve: () => resolve(stream), track };
}

beforeEach(() => {
  // A MediaRecorder stub that satisfies the wrapper's usage (start/stop/state).
  (globalThis as Record<string, unknown>).MediaRecorder = class {
    state = 'inactive';
    mimeType = 'audio/webm';
    ondataavailable: unknown = null;
    onstop: unknown = null;
    start() {
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
    }
  };
});

describe('MicCapture teardown during a pending mic request', () => {
  it('releases a stream that arrives after stop() was called', async () => {
    const media = deferredMedia();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: () => media.promise }
    });

    const cap = new MicCapture();
    const started = cap.start();

    // The user dismisses/retries while the OS permission prompt is still up: at
    // this point the wrapper holds NO stream yet, so stop() has nothing to release.
    cap.stop();
    expect(media.track.stop).not.toHaveBeenCalled();

    // ...then they hit "Allow" and getUserMedia finally resolves.
    media.resolve();
    await started;

    // The stream MUST be released anyway — otherwise the mic stays on forever.
    expect(media.track.stop).toHaveBeenCalled();
  });

  it('still starts normally when stop() was never called', async () => {
    const media = deferredMedia();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: () => media.promise }
    });

    const cap = new MicCapture();
    const started = cap.start();
    media.resolve();
    await started;

    expect(media.track.stop).not.toHaveBeenCalled();
    cap.stop();
    expect(media.track.stop).toHaveBeenCalled();
  });
});
