import { describe, expect, it } from 'vitest';
import {
  finalModelFilename,
  resolveFinalModelPath,
  reduceTranscribeEvent
} from './pipeline';

// PURE tests for the dictation-pipeline orchestration helpers. The controller
// itself (DictationPipeline) wires `invoke`/`Channel`/`MicCapture`/DOM and is the
// thin, untested integration layer — only RUNS with the live sidecars + mic
// (MANUAL, tasks 9.1/9.2). Everything testable headlessly lives here.

describe('finalModelFilename — tier → final whisper model (mirrors Rust registry)', () => {
  it('accurate tier → large-v3-turbo', () => {
    expect(finalModelFilename('accurate')).toBe('ggml-large-v3-turbo-q5_0.bin');
  });

  it('fast tier → small', () => {
    expect(finalModelFilename('fast')).toBe('ggml-small.bin');
  });
});

describe('resolveFinalModelPath — present tier model vs bundled-tiny fallback', () => {
  it('prefers the tier model path when present', () => {
    expect(resolveFinalModelPath('/models/ggml-large-v3-turbo-q5_0.bin', '/res/ggml-tiny.bin')).toBe(
      '/models/ggml-large-v3-turbo-q5_0.bin'
    );
  });

  it('falls back to the bundled tiny model when the tier model is missing', () => {
    expect(resolveFinalModelPath(null, '/res/ggml-tiny.bin')).toBe('/res/ggml-tiny.bin');
  });

  it('returns null when neither model is on disk (caller skips the final pass)', () => {
    expect(resolveFinalModelPath(null, null)).toBeNull();
  });
});

describe('reduceTranscribeEvent — stream event → panel effect', () => {
  it('maps a partial to a partial-overlay effect', () => {
    expect(reduceTranscribeEvent({ event: 'partial', text: 'hello wor' })).toEqual({
      kind: 'partial',
      text: 'hello wor'
    });
  });

  it('maps an error to an error effect', () => {
    expect(reduceTranscribeEvent({ event: 'error', message: 'boom' })).toEqual({
      kind: 'error',
      message: 'boom'
    });
  });

  it('ignores a stream final (the explicit stop path is authoritative)', () => {
    expect(reduceTranscribeEvent({ event: 'final', text: 'done' })).toEqual({ kind: 'ignore' });
  });
});
