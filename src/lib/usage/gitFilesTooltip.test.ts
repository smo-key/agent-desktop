import { describe, it, expect } from 'vitest';
import { uncommittedFilesTooltip, MAX_TOOLTIP_FILES } from './gitFilesTooltip';

describe('uncommittedFilesTooltip', () => {
  it('returns null when there are no changes', () => {
    expect(uncommittedFilesTooltip(null)).toBeNull();
    expect(uncommittedFilesTooltip(undefined)).toBeNull();
    expect(uncommittedFilesTooltip([])).toBeNull();
  });

  it('lists every file when there are 10 or fewer', () => {
    const files = ['a.ts', 'b.ts', 'src/c.rs'];
    const tip = uncommittedFilesTooltip(files);
    expect(tip).not.toBeNull();
    // Each path appears on its own line.
    for (const f of files) expect(tip).toContain(f);
    expect(tip!.split('\n')).toEqual(files);
    // No overflow hint when nothing was truncated.
    expect(tip).not.toMatch(/more/i);
  });

  it('lists exactly the first 10 with no overflow hint at the boundary', () => {
    const files = Array.from({ length: MAX_TOOLTIP_FILES }, (_, i) => `f${i}.ts`);
    const tip = uncommittedFilesTooltip(files)!;
    const lines = tip.split('\n');
    expect(lines).toHaveLength(MAX_TOOLTIP_FILES);
    expect(lines).toEqual(files);
    expect(tip).not.toMatch(/more/i);
  });

  it('caps at the first 10 and indicates how many more exist when > 10', () => {
    const files = Array.from({ length: 14 }, (_, i) => `f${i}.ts`);
    const tip = uncommittedFilesTooltip(files)!;
    const lines = tip.split('\n');
    // 10 file lines + 1 overflow line.
    expect(lines).toHaveLength(MAX_TOOLTIP_FILES + 1);
    // The first 10 files are listed, in order.
    expect(lines.slice(0, MAX_TOOLTIP_FILES)).toEqual(files.slice(0, MAX_TOOLTIP_FILES));
    // The 11th-14th are NOT listed individually.
    expect(tip).not.toContain('f10.ts');
    // The overflow line names the remaining count (14 - 10 = 4).
    expect(lines[MAX_TOOLTIP_FILES]).toMatch(/4 more/);
  });
});
