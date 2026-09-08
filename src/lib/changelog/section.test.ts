import { describe, expect, it } from 'vitest';

// The changelog parser shared by scripts/release-notes.mjs (CI release body) and
// the in-app What's new dialog. Scenario-titled tests cover the
// whats-new-dialog + release-changelog spec deltas.

import { sectionFor, newestSection, parseNotes } from './section.mjs';

const MD = `# Changelog

Intro text.

## 0.4.0 — 2026-09-10

### New

- **Auto update**: installs on restart
- Plain bullet with \`code\` and a [link](https://example.com).

### Fixed

- **Crash**: no more crash

## 0.3.2 - 2026-09-01

- **Older**: older note
`;

describe('sectionFor', () => {
  it('section found for the running version', () => {
    expect(sectionFor(MD, '0.4.0')).toBe(
      '### New\n\n- **Auto update**: installs on restart\n- Plain bullet with `code` and a [link](https://example.com).\n\n### Fixed\n\n- **Crash**: no more crash'
    );
    // Last section runs to end of file.
    expect(sectionFor(MD, '0.3.2')).toBe('- **Older**: older note');
  });

  it('no section for the running version', () => {
    expect(sectionFor(MD, '0.4.1')).toBe('');
    // `0.4` must not match `0.4.0` by prefix.
    expect(sectionFor(MD, '0.4')).toBe('');
    expect(sectionFor('', '0.4.0')).toBe('');
    expect(sectionFor(MD, '')).toBe('');
  });

  it('section lookup accepts a v prefix', () => {
    expect(sectionFor(MD, 'v0.3.2')).toBe('- **Older**: older note');
  });

  it('tolerates CRLF line endings', () => {
    expect(sectionFor(MD.replace(/\n/g, '\r\n'), '0.3.2')).toBe('- **Older**: older note');
  });
});

describe('newestSection', () => {
  it('dev build resolves the newest section', () => {
    expect(newestSection(MD)).toEqual({
      version: '0.4.0',
      body: sectionFor(MD, '0.4.0')
    });
    expect(newestSection('# nothing here')).toBeNull();
  });
});

describe('parseNotes', () => {
  it('headings bullets and bold parsed', () => {
    const groups = parseNotes('### New\n\n- **Auto update**: installs on restart\n');
    expect(groups).toEqual([
      {
        heading: 'New',
        items: [
          [
            { kind: 'bold', text: 'Auto update' },
            { kind: 'text', text: ': installs on restart' }
          ]
        ]
      }
    ]);
  });

  it('bullets before any heading', () => {
    const groups = parseNotes('- first\n- second\n\n### Fixed\n- third');
    expect(groups.map((g) => g.heading)).toEqual(['', 'Fixed']);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[1].items).toEqual([[{ kind: 'text', text: 'third' }]]);
  });

  it('parses inline code and links, and `*` bullets', () => {
    const groups = parseNotes('* see `yarn dev` and [docs](https://x.y/z) now');
    expect(groups[0].items[0]).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'code', text: 'yarn dev' },
      { kind: 'text', text: ' and ' },
      { kind: 'link', text: 'docs', href: 'https://x.y/z' },
      { kind: 'text', text: ' now' }
    ]);
  });

  it('keeps a wrapped bullet as one item and ignores stray prose', () => {
    const groups = parseNotes('### New\n- **Long**: line one\n  continues here\nstray prose');
    expect(groups[0].items).toEqual([
      [
        { kind: 'bold', text: 'Long' },
        { kind: 'text', text: ': line one continues here' }
      ]
    ]);
  });

  it('returns no groups for an empty body', () => {
    expect(parseNotes('')).toEqual([]);
    expect(parseNotes('### New\n')).toEqual([]);
  });
});
