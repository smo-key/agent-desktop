import { describe, it, expect } from 'vitest';
import { terminalLeftFraction } from './footerGeometry';
import type { Node } from '../layout/tree';

const leaf = (id: string, paneId: string): Node => ({ type: 'leaf', id, paneId });
const row = (children: Node[], ratios: number[]): Node => ({
  type: 'split',
  id: 's',
  direction: 'row',
  children,
  ratios
});
const col = (children: Node[], ratios: number[]): Node => ({
  type: 'split',
  id: 'sc',
  direction: 'col',
  children,
  ratios
});

const isTerm = (pid: string) => pid.startsWith('t');

describe('terminalLeftFraction', () => {
  it('single terminal leaf → 0', () => {
    expect(terminalLeftFraction(leaf('l', 't1'), isTerm)).toBe(0);
  });

  it('null when no terminal pane', () => {
    expect(terminalLeftFraction(row([leaf('a', 'a1'), leaf('b', 'a2')], [0.5, 0.5]), isTerm)).toBeNull();
  });

  it('row split [agent | terminal] → agent ratio', () => {
    const root = row([leaf('a', 'a1'), leaf('b', 't1')], [0.6, 0.4]);
    expect(terminalLeftFraction(root, isTerm)).toBeCloseTo(0.6, 6);
  });

  it('three-way row, terminal last → sum of preceding ratios', () => {
    const root = row([leaf('a', 'a1'), leaf('b', 'a2'), leaf('c', 't1')], [0.3, 0.3, 0.4]);
    expect(terminalLeftFraction(root, isTerm)).toBeCloseTo(0.6, 6);
  });

  it('column split → terminal shares the x-range (0)', () => {
    const root = col([leaf('a', 'a1'), leaf('b', 't1')], [0.5, 0.5]);
    expect(terminalLeftFraction(root, isTerm)).toBe(0);
  });

  it('nested: terminal inside the right column → outer left edge', () => {
    const root = row(
      [leaf('a', 'a1'), col([leaf('c', 't1'), leaf('d', 'a2')], [0.5, 0.5])],
      [0.5, 0.5]
    );
    expect(terminalLeftFraction(root, isTerm)).toBeCloseTo(0.5, 6);
  });

  it('multiple terminals → the leftmost (min) fraction', () => {
    const root = row([leaf('a', 't2'), leaf('b', 'a1'), leaf('c', 't1')], [0.25, 0.25, 0.5]);
    expect(terminalLeftFraction(root, isTerm)).toBe(0);
  });
});
