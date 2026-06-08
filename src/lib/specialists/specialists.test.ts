import { describe, expect, it } from 'vitest';
import {
  parseSpecialist,
  serializeSpecialist,
  SpecialistParseError,
  validateSpecialistName,
  type Specialist,
} from './specialists';

// Pure, framework-free tests for the specialist model: (de)serialization of a
// native Claude Code subagent file (`.claude/agents/<name>.md`) and name
// validation. Runs under the default (node) Vitest environment — no DOM/Tauri.

describe('parseSpecialist', () => {
  it('parses all fields including optional model and tools', () => {
    const md = [
      '---',
      'name: test-writer',
      'description: Writes focused unit tests',
      'model: claude-sonnet-4-6',
      'tools: [Read, Edit, Bash]',
      '---',
      'You are a meticulous test author.',
      '',
      'Always write the failing test first.',
    ].join('\n');

    const s = parseSpecialist(md);

    expect(s.name).toBe('test-writer');
    expect(s.description).toBe('Writes focused unit tests');
    expect(s.model).toBe('claude-sonnet-4-6');
    expect(s.tools).toEqual(['Read', 'Edit', 'Bash']);
    expect(s.prompt).toBe(
      'You are a meticulous test author.\n\nAlways write the failing test first.'
    );
  });

  it('omits optional fields when they are absent from frontmatter', () => {
    const md = ['---', 'name: minimal', 'description: A minimal agent', '---', 'Be brief.'].join(
      '\n'
    );

    const s = parseSpecialist(md);

    expect(s.name).toBe('minimal');
    expect(s.description).toBe('A minimal agent');
    expect(s).not.toHaveProperty('model');
    expect(s).not.toHaveProperty('tools');
    expect(s.prompt).toBe('Be brief.');
  });

  it('throws SpecialistParseError when the frontmatter block is missing', () => {
    expect(() => parseSpecialist('Just a body, no frontmatter.')).toThrow(SpecialistParseError);
  });

  it('throws SpecialistParseError when the frontmatter block is unterminated', () => {
    const md = ['---', 'name: broken', 'description: no closing fence'].join('\n');
    expect(() => parseSpecialist(md)).toThrow(SpecialistParseError);
  });

  it('throws SpecialistParseError when required name is missing', () => {
    const md = ['---', 'description: nameless', '---', 'body'].join('\n');
    expect(() => parseSpecialist(md)).toThrow(SpecialistParseError);
  });
});

describe('serializeSpecialist', () => {
  it('omits optional fields that are absent', () => {
    const s: Specialist = { name: 'minimal', description: 'A minimal agent', prompt: 'Be brief.' };

    const out = serializeSpecialist(s);

    expect(out).not.toContain('model:');
    expect(out).not.toContain('tools:');
    expect(out).toContain('name: minimal');
    expect(out).toContain('description: A minimal agent');
  });
});

describe('round-trip', () => {
  it('parse∘serialize is the identity on a model', () => {
    const s: Specialist = {
      name: 'reviewer',
      description: 'Reviews diffs adversarially',
      model: 'claude-opus-4-8',
      tools: ['Read', 'Grep'],
      prompt: 'You are a skeptical reviewer.\n\nFind real bugs.',
    };

    expect(parseSpecialist(serializeSpecialist(s))).toEqual(s);
  });

  it('parse∘serialize is the identity on a minimal model', () => {
    const s: Specialist = { name: 'mini', description: 'tiny', prompt: 'go' };

    expect(parseSpecialist(serializeSpecialist(s))).toEqual(s);
  });

  it('serialize∘parse preserves the file (modulo normalization)', () => {
    const md = [
      '---',
      'name: doc',
      'description: Documents code',
      'model: claude-sonnet-4-6',
      'tools: [Read, Write]',
      '---',
      'You write clear docs.',
    ].join('\n');

    expect(serializeSpecialist(parseSpecialist(md))).toBe(md);
  });
});

describe('validateSpecialistName', () => {
  it('accepts a clean, unique name', () => {
    expect(validateSpecialistName('test-writer', ['reviewer', 'docs'])).toEqual({ ok: true });
  });

  it('rejects an empty / whitespace-only name', () => {
    expect(validateSpecialistName('   ', [])).toMatchObject({ ok: false });
  });

  it('rejects a name with a path separator', () => {
    expect(validateSpecialistName('foo/bar', [])).toMatchObject({ ok: false });
    expect(validateSpecialistName('foo\\bar', [])).toMatchObject({ ok: false });
  });

  it('rejects ".." traversal', () => {
    expect(validateSpecialistName('..', [])).toMatchObject({ ok: false });
  });

  it('rejects a leading dot', () => {
    expect(validateSpecialistName('.hidden', [])).toMatchObject({ ok: false });
  });

  it('rejects bad characters', () => {
    expect(validateSpecialistName('has space', [])).toMatchObject({ ok: false });
    expect(validateSpecialistName('tab\tname', [])).toMatchObject({ ok: false });
  });

  it('rejects a duplicate name (case-insensitive)', () => {
    expect(validateSpecialistName('Reviewer', ['reviewer'])).toMatchObject({ ok: false });
  });
});
