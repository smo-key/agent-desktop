import { describe, expect, it, vi } from 'vitest';
import { KeepAwakeDriver } from './keepAwakeDriver';

// PURE driver tests. The `it(...)` title is the EXACT `#### Scenario:` name from the
// keep-awake spec (Requirement: Keep-awake resolves from mode and agent activity).

describe('KeepAwakeDriver', () => {
  it('Inhibitor toggles only on transitions', () => {
    const apply = vi.fn();
    const d = new KeepAwakeDriver(apply);

    // Initially not held: repeated "false" ticks send nothing.
    d.update(false);
    d.update(false);
    expect(apply).not.toHaveBeenCalled();

    // false → true: exactly one acquire; steady ticks send nothing more.
    d.update(true);
    d.update(true);
    d.update(true);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenLastCalledWith(true);

    // true → false: exactly one release.
    d.update(false);
    d.update(false);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenLastCalledWith(false);

    // release() while held → one release; while not held → nothing.
    d.update(true);
    expect(apply).toHaveBeenCalledTimes(3);
    d.release();
    expect(apply).toHaveBeenCalledTimes(4);
    expect(apply).toHaveBeenLastCalledWith(false);
    d.release();
    expect(apply).toHaveBeenCalledTimes(4);
  });
});
