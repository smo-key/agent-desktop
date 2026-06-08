import { describe, expect, it } from 'vitest';
import {
  buildSpecialist,
  formatToolsInput,
  MODEL_CHOICES,
  modelOptions,
  parseToolsInput,
  TOOL_CHOICES,
  toolOptions,
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

describe('modelOptions', () => {
  it('returns the curated list for undefined / empty / Default', () => {
    expect(modelOptions(undefined)).toBe(MODEL_CHOICES);
    expect(modelOptions('')).toBe(MODEL_CHOICES);
    expect(modelOptions('   ')).toBe(MODEL_CHOICES);
  });

  it('returns the curated list when the value is already curated', () => {
    expect(modelOptions('claude-opus-4-8')).toBe(MODEL_CHOICES);
  });

  it('appends an out-of-list value verbatim so it is preserved', () => {
    const opts = modelOptions('claude-future-9-9');
    expect(opts).toHaveLength(MODEL_CHOICES.length + 1);
    expect(opts[opts.length - 1]).toEqual({
      value: 'claude-future-9-9',
      label: 'claude-future-9-9'
    });
  });
});

describe('toolOptions', () => {
  it('returns the curated list when undefined or all curated', () => {
    expect(toolOptions(undefined)).toEqual([...TOOL_CHOICES]);
    expect(toolOptions(['Read', 'Bash'])).toEqual([...TOOL_CHOICES]);
  });

  it('appends out-of-list tools (in saved order) so they survive an edit', () => {
    const opts = toolOptions(['Read', 'MCP__custom', 'Edit', 'OtherTool']);
    expect(opts).toEqual([...TOOL_CHOICES, 'MCP__custom', 'OtherTool']);
  });
});
