import { describe, expect, it } from 'vitest';
import { normalizeActivity } from './activity.svelte';

// Tests for the PURE activity-map normalizer (the unit-tested core of the
// transcript-activity store). The live watcher/event wiring is confirmed in-app.

describe('activity — transcript activity normalizer', () => {
  it('normalizes the activity map, coercing non-strings to null', () => {
    const norm = normalizeActivity({
      'sess-a': {
        summary: 'Looking at the parser',
        question: null,
        contextPct: 42,
        userMsgCount: 3
      },
      'sess-b': { summary: null, question: 'Which database?' },
      'sess-c': { summary: 123, question: undefined, contextPct: 'x', userMsgCount: 'x' } // non-numbers -> null
    });
    expect(norm['sess-a']).toEqual({
      summary: 'Looking at the parser',
      question: null,
      questions: null,
      contextPct: 42,
      messages: null,
      userHash: null,
      userMsgCount: 3,
      lastMsgTs: null
    });
    expect(norm['sess-b']).toEqual({
      summary: null,
      question: 'Which database?',
      questions: null,
      contextPct: null,
      messages: null,
      userHash: null,
      userMsgCount: null,
      lastMsgTs: null
    });
    expect(norm['sess-c']).toEqual({
      summary: null,
      question: null,
      questions: null,
      contextPct: null,
      messages: null,
      userHash: null,
      userMsgCount: null,
      lastMsgTs: null
    });
  });

  it('normalizes structured questions, keeping options and dropping malformed entries', () => {
    const norm = normalizeActivity({
      'sess-q': {
        question: 'Pick a DB',
        questions: [
          {
            header: 'DB',
            question: 'Postgres or MySQL?',
            multiSelect: false,
            options: [
              { label: 'Postgres', description: 'relational' },
              { label: 'MySQL' }, // missing description -> ''
              { description: 'no label' } // no label -> dropped
            ]
          },
          { header: 'bad' } // no question text -> dropped
        ]
      }
    });
    expect(norm['sess-q'].questions).toEqual([
      {
        header: 'DB',
        question: 'Postgres or MySQL?',
        multiSelect: false,
        options: [
          { label: 'Postgres', description: 'relational' },
          { label: 'MySQL', description: '' }
        ]
      }
    ]);
  });

  it('returns an empty map for a non-object payload', () => {
    expect(normalizeActivity(null)).toEqual({});
    expect(normalizeActivity('nope')).toEqual({});
    expect(normalizeActivity(42)).toEqual({});
  });

  it('drops non-object session values', () => {
    const norm = normalizeActivity({ 'sess-a': 'bad', 'sess-b': { question: 'ok?' } });
    expect('sess-a' in norm).toBe(false);
    expect(norm['sess-b']).toEqual({
      summary: null,
      question: 'ok?',
      questions: null,
      contextPct: null,
      messages: null,
      userHash: null,
      userMsgCount: null,
      lastMsgTs: null
    });
  });
});
