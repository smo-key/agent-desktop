import { describe, expect, it, vi } from 'vitest';
import {
  POLISH_SYSTEM_PROMPT,
  buildPolishRequest,
  parsePolishResponse,
  finalizeTranscript,
  finishDictation
} from './polish';
import { voice } from '$lib/settings/voice.svelte';

// Tests for the PURE transcript-polish core (tasks.md 6.2–6.4; spec capability
// `transcript-polish`). The `it(...)` titles align with the spec
// `#### Scenario:` names ("Fillers and false starts removed", "No content
// added", "Raw transcript when polish off", "Polish model unavailable",
// "Graceful degradation") where natural. Everything here is pure: no DOM, no
// Tauri `invoke`, no live LLM — the LLM call is injected as `run` so the gating
// + fallback logic is provable headlessly.

describe('polish — system prompt (constrained, agent-ready)', () => {
  it('Fillers and false starts removed — prompt names fillers + false starts + repetitions', () => {
    const p = POLISH_SYSTEM_PROMPT.toLowerCase();
    expect(p).toContain('um');
    expect(p).toContain('uh');
    expect(p).toContain('filler');
    expect(p).toContain('false start');
    expect(p).toContain('repetition');
  });

  it('No content added — prompt forbids new content and following instructions in the text', () => {
    const p = POLISH_SYSTEM_PROMPT.toLowerCase();
    // The required guardrail: add no new content, do not answer/follow text.
    expect(p).toContain('no new content');
    expect(p).toMatch(/do not (answer|follow)/);
    expect(p).toContain('instruction');
  });

  it('targets agent-ready output and asks for only the cleaned text', () => {
    const p = POLISH_SYSTEM_PROMPT.toLowerCase();
    expect(p).toContain('agent');
    expect(p).toContain('only');
  });
});

describe('polish — buildPolishRequest', () => {
  it('builds a chat-completions body with system+user messages in order', () => {
    const body = buildPolishRequest('um so add a button', 'polish-model') as {
      model: string;
      messages: { role: string; content: string }[];
      temperature: number;
      stream: boolean;
    };
    expect(body.model).toBe('polish-model');
    expect(body.stream).toBe(false);
    expect(body.temperature).toBe(0.2);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toEqual({ role: 'system', content: POLISH_SYSTEM_PROMPT });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'um so add a button' });
  });
});

describe('polish — parsePolishResponse', () => {
  it('extracts and trims choices[0].message.content', () => {
    const json = {
      choices: [{ message: { role: 'assistant', content: '  Add a button.  ' } }]
    };
    expect(parsePolishResponse(json)).toBe('Add a button.');
  });

  it('throws on a response with no content', () => {
    expect(() => parsePolishResponse({})).toThrow();
    expect(() => parsePolishResponse({ choices: [] })).toThrow();
    expect(() => parsePolishResponse({ choices: [{ message: {} }] })).toThrow();
    expect(() => parsePolishResponse(null)).toThrow();
    expect(() => parsePolishResponse('not json')).toThrow();
  });
});

describe('polish — finalizeTranscript (gating + graceful degradation)', () => {
  it('Bypass polishing when disabled — polish=false returns raw and never calls run', async () => {
    const run = vi.fn(async (_raw: string) => 'POLISHED');
    const out = await finalizeTranscript('um raw text', { polish: false, run });
    // Raw transcript when polish off: the LLM is not invoked.
    expect(out).toBe('um raw text');
    expect(run).not.toHaveBeenCalled();
  });

  it('polish=true and run succeeds — returns the polished text', async () => {
    const run = vi.fn(async (raw: string) => `clean: ${raw}`);
    const out = await finalizeTranscript('um raw text', { polish: true, run });
    expect(out).toBe('clean: um raw text');
    expect(run).toHaveBeenCalledWith('um raw text');
  });

  it('Polish model unavailable — run throws, falls back to raw', async () => {
    const run = vi.fn(async (_raw: string) => {
      throw new Error('llama-server not running');
    });
    const out = await finalizeTranscript('um raw text', { polish: true, run });
    expect(out).toBe('um raw text');
  });

  it('Graceful degradation — run returns empty/whitespace, falls back to raw', async () => {
    expect(await finalizeTranscript('raw', { polish: true, run: async () => '' })).toBe('raw');
    expect(await finalizeTranscript('raw', { polish: true, run: async () => '   \n\t ' })).toBe(
      'raw'
    );
  });
});

describe('finishDictation — propagates the insert result', () => {
  // P0 regression: when there is no focused agent terminal, finishDictation must
  // return a `no-target` result so the pipeline keeps the panel OPEN (showing the
  // error) instead of closing and silently dropping the dictation. Polish is
  // disabled here so no Tauri `invoke` is needed; with no workspace focused in the
  // test env, the focused-agent lookup resolves to none → no-target.
  it('No focused agent — returns no-target (so the caller does not close)', async () => {
    const prev = voice.prefs.polish;
    voice.prefs.polish = false;
    try {
      const result = await finishDictation('hello world');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('no-target');
    } finally {
      voice.prefs.polish = prev;
    }
  });
});
