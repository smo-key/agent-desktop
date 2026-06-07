// PURE microphone-permission mapping helpers — no DOM, no browser APIs, fully
// unit-testable. The thin browser wrapper (`capture.ts`) and VoicePanel's
// capture-start effect call into these to turn a raw `getUserMedia` rejection
// into a user-facing outcome + guidance string.
//
// Kept separate from `capture.ts` (which holds the untestable getUserMedia /
// MediaRecorder calls) so the decision logic can be exercised headlessly.

/** The outcome of attempting to obtain the microphone. */
export type MicPermissionOutcome = 'recording' | 'denied' | 'error';

/**
 * Map a `getUserMedia` rejection to a coarse outcome by inspecting `err.name`.
 *
 * - `NotAllowedError` / `SecurityError` / `PermissionDeniedError` → `'denied'`
 *   (the user/OS blocked access — actionable via System Settings).
 * - everything else (`NotFoundError`, `NotReadableError`, `OverconstrainedError`,
 *   a non-Error value, …) → `'error'` (something is wrong with the device/stack,
 *   not a permission grant the user can simply flip).
 */
export function classifyMicError(err: unknown): 'denied' | 'error' {
  const name =
    typeof err === 'object' && err !== null && 'name' in err
      ? String((err as { name?: unknown }).name)
      : '';
  if (
    name === 'NotAllowedError' ||
    name === 'SecurityError' ||
    name === 'PermissionDeniedError'
  ) {
    return 'denied';
  }
  return 'error';
}

/** User-facing guidance shown when mic access is blocked/denied. */
export const MIC_DENIED_GUIDANCE =
  'Microphone access is blocked. Enable it in System Settings → Privacy & Security → Microphone, then try again.';

/** Generic guidance for a non-permission failure (no device, device busy, …). */
export const MIC_ERROR_GUIDANCE = "Couldn't access the microphone.";

/** Return the user-facing guidance string for a given (non-recording) outcome. */
export function micGuidanceFor(outcome: 'denied' | 'error'): string {
  return outcome === 'denied' ? MIC_DENIED_GUIDANCE : MIC_ERROR_GUIDANCE;
}
