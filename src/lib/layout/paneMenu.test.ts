import { describe, it, expect, vi } from 'vitest';
import { buildPaneMenu, type PaneMenuDeps, type PaneMenuItem } from './paneMenu';

function makeDeps(over: Partial<PaneMenuDeps> = {}): PaneMenuDeps {
  return {
    split: vi.fn(),
    close: vi.fn(),
    newSession: vi.fn(),
    copy: vi.fn(),
    paste: vi.fn(),
    canClose: true,
    hasSelection: true,
    ...over
  };
}

function item(sections: PaneMenuItem[][], id: string): PaneMenuItem {
  const found = sections.flat().find((i) => i.id === id);
  if (!found) throw new Error(`menu item ${id} not found`);
  return found;
}

describe('Pane Context Menu', () => {
  it('Context menu actions dispatch the matching pane operation', () => {
    const d = makeDeps();
    const m = buildPaneMenu(d);

    item(m, 'split-right').run();
    expect(d.split).toHaveBeenCalledWith('row', 'after');
    item(m, 'split-down').run();
    expect(d.split).toHaveBeenCalledWith('col', 'after');
    item(m, 'split-left').run();
    expect(d.split).toHaveBeenCalledWith('row', 'before');
    item(m, 'split-up').run();
    expect(d.split).toHaveBeenCalledWith('col', 'before');

    item(m, 'close').run();
    expect(d.close).toHaveBeenCalledOnce();
    item(m, 'new-session').run();
    expect(d.newSession).toHaveBeenCalledOnce();
    item(m, 'copy').run();
    expect(d.copy).toHaveBeenCalledOnce();
    item(m, 'paste').run();
    expect(d.paste).toHaveBeenCalledOnce();
  });

  it('Context menu disables copy without a selection and close on the only pane', () => {
    const m = buildPaneMenu(makeDeps({ hasSelection: false, canClose: false }));
    expect(item(m, 'copy').disabled).toBe(true);
    expect(item(m, 'close').disabled).toBe(true);
    // Paste and splits remain available regardless.
    expect(item(m, 'paste').disabled).toBeFalsy();
    expect(item(m, 'split-right').disabled).toBeFalsy();

    const enabled = buildPaneMenu(makeDeps({ hasSelection: true, canClose: true }));
    expect(item(enabled, 'copy').disabled).toBeFalsy();
    expect(item(enabled, 'close').disabled).toBeFalsy();
  });
});
