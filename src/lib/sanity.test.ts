import { describe, expect, it } from 'vitest';

// Toolchain smoke test: proves Vitest runs under the SPA build.
describe('toolchain', () => {
  it('runs vitest', () => {
    expect(1 + 1).toBe(2);
  });
});
