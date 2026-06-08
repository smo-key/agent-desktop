import { describe, expect, it } from 'vitest';
import {
  buildSpecialist,
  formatToolsInput,
  parseToolsInput,
  type SpecialistFormFields
} from './specialistForm';

// Pure, framework-free tests for the specialist FORM helpers: parsing the
// free-text `tools` input into a clean array (and back), and assembling a
// Specialist from the raw bound form fields. Runs under node Vitest — no DOM.

describe('parseToolsInput', () => {
  it('splits on commas and whitespace', () => {
    expect(parseToolsInput('Read, Edit Bash')).toEqual(['Read', 'Edit', 'Bash']);
  });

  it('tolerates extra separators and surrounding brackets', () => {
    expect(parseToolsInput('[Read,  , Edit ,]')).toEqual(['Read', 'Edit']);
  });

  it('de-duplicates while preserving order', () => {
    expect(parseToolsInput('Read, Edit, Read')).toEqual(['Read', 'Edit']);
  });

  it('yields an empty array for empty or separator-only input', () => {
    expect(parseToolsInput('')).toEqual([]);
    expect(parseToolsInput('   , ')).toEqual([]);
  });

  it('round-trips with formatToolsInput', () => {
    const tools = ['Read', 'Edit', 'Bash'];
    expect(parseToolsInput(formatToolsInput(tools))).toEqual(tools);
  });
});

describe('formatToolsInput', () => {
  it('joins an array with ", "', () => {
    expect(formatToolsInput(['Read', 'Edit'])).toBe('Read, Edit');
  });

  it('returns empty string for undefined', () => {
    expect(formatToolsInput(undefined)).toBe('');
  });
});

describe('buildSpecialist', () => {
  const base: SpecialistFormFields = {
    name: '  reviewer ',
    description: '  Reviews diffs ',
    model: '',
    tools: '',
    prompt: '  You review code.  '
  };

  it('trims name/description/prompt and omits empty optional fields', () => {
    const s = buildSpecialist(base);
    expect(s).toEqual({
      name: 'reviewer',
      description: 'Reviews diffs',
      prompt: 'You review code.'
    });
    expect(s.model).toBeUndefined();
    expect(s.tools).toBeUndefined();
  });

  it('includes model and parsed tools when present', () => {
    const s = buildSpecialist({
      ...base,
      model: ' claude-sonnet-4-6 ',
      tools: 'Read, Edit'
    });
    expect(s.model).toBe('claude-sonnet-4-6');
    expect(s.tools).toEqual(['Read', 'Edit']);
  });
});
