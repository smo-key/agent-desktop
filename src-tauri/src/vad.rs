//! Pure voice-activity-detection (VAD) helpers used to gate whisper.cpp so it is
//! never asked to transcribe silence (the dominant source of whisper
//! hallucinations — a silent buffer makes the model invent text). All functions
//! here are PURE (no I/O, no audio device) and fully unit-tested; the live
//! capture/streaming layers feed them `f32` PCM samples in `[-1.0, 1.0]`.
//!
//! Frames are simple fixed-length, non-overlapping windows over the sample slice
//! (the trailing remainder shorter than `frame_len` is treated as its own frame).
//! Energy is plain RMS; "speech" is RMS above a caller-supplied threshold. A
//! representative threshold for normalized mic input is ~0.01–0.02, but the
//! caller owns the value so it can be tuned per the spec/UX.

/// Root-mean-square energy of one frame of normalized PCM samples. An empty
/// frame has zero energy (no division by zero).
pub fn frame_rms(frame: &[f32]) -> f32 {
    if frame.is_empty() {
        return 0.0;
    }
    let sum_sq: f64 = frame.iter().map(|&s| (s as f64) * (s as f64)).sum();
    ((sum_sq / frame.len() as f64).sqrt()) as f32
}

/// True iff a frame's RMS energy is strictly above `threshold` (i.e. it carries
/// speech rather than silence/noise floor).
pub fn is_speech(frame: &[f32], threshold: f32) -> bool {
    frame_rms(frame) > threshold
}

/// Iterate over `samples` in fixed `frame_len` chunks (the final short remainder
/// is yielded as its own frame). `frame_len` of 0 is treated as the whole slice
/// being a single frame, so callers never divide by zero.
fn frames(samples: &[f32], frame_len: usize) -> impl Iterator<Item = &[f32]> {
    let step = frame_len.max(1);
    samples.chunks(step)
}

/// True iff ANY frame in `samples` is speech. Used to DISCARD silent/empty
/// windows before calling whisper, so silence yields no transcript text.
pub fn has_speech(samples: &[f32], frame_len: usize, threshold: f32) -> bool {
    frames(samples, frame_len).any(|f| is_speech(f, threshold))
}

/// Trim leading and trailing silence from `samples`, returning the sub-slice
/// spanning from the first speech frame to the last (inclusive). Returns an empty
/// slice when there is no speech at all. This bounds an utterance to its spoken
/// extent so whisper sees the speech, not the dead air around it.
pub fn trim_silence(samples: &[f32], frame_len: usize, threshold: f32) -> &[f32] {
    let step = frame_len.max(1);
    let mut first: Option<usize> = None;
    let mut last: Option<usize> = None;
    let mut idx = 0usize;
    while idx < samples.len() {
        let end = (idx + step).min(samples.len());
        if is_speech(&samples[idx..end], threshold) {
            if first.is_none() {
                first = Some(idx);
            }
            last = Some(end);
        }
        idx = end;
    }
    match (first, last) {
        (Some(a), Some(b)) => &samples[a..b],
        _ => &[],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `frame_len` used across tests; small for readability.
    const FRAME: usize = 4;
    const THRESH: f32 = 0.01;

    #[test]
    fn frame_rms_of_silence_is_zero() {
        assert_eq!(frame_rms(&[0.0; 8]), 0.0);
        assert_eq!(frame_rms(&[]), 0.0);
    }

    #[test]
    fn frame_rms_of_known_signal_matches() {
        // RMS of [0.5, -0.5, 0.5, -0.5] = 0.5.
        let r = frame_rms(&[0.5, -0.5, 0.5, -0.5]);
        assert!((r - 0.5).abs() < 1e-6, "rms was {r}");
    }

    #[test]
    fn is_speech_distinguishes_loud_from_quiet() {
        assert!(!is_speech(&[0.0; 4], THRESH));
        assert!(is_speech(&[0.3, -0.3, 0.3, -0.3], THRESH));
    }

    /// Spec scenario: "Silence produces no text" — a buffer with no detected
    /// speech yields `has_speech == false`, so the command short-circuits to "".
    #[test]
    fn silence_produces_no_text() {
        let silent = vec![0.0f32; 64];
        assert!(!has_speech(&silent, FRAME, THRESH));
        assert_eq!(frame_rms(&silent), 0.0);
    }

    #[test]
    fn has_speech_true_when_a_loud_segment_present() {
        let mut buf = vec![0.0f32; 64];
        // Inject a loud burst in the middle.
        for s in buf.iter_mut().skip(20).take(8) {
            *s = 0.4;
        }
        assert!(has_speech(&buf, FRAME, THRESH));
    }

    #[test]
    fn trim_silence_removes_leading_and_trailing_zeros() {
        // 8 silent, 8 loud, 8 silent (frame-aligned at FRAME=4).
        let mut buf = vec![0.0f32; 24];
        for s in buf.iter_mut().skip(8).take(8) {
            *s = 0.5;
        }
        let trimmed = trim_silence(&buf, FRAME, THRESH);
        // Speech spans indices 8..16 → length 8.
        assert_eq!(trimmed.len(), 8);
        assert!(trimmed.iter().all(|&s| s == 0.5));
    }

    #[test]
    fn trim_silence_of_all_silence_is_empty() {
        let buf = vec![0.0f32; 32];
        assert!(trim_silence(&buf, FRAME, THRESH).is_empty());
    }
}
