import { describe, it, expect, vi } from 'vitest';
import { buildPaneMenu, type PaneMenuDeps, type PaneMenuItem } from './paneMenu';

function makeDeps(over: Partial<PaneMenuDeps> = {}): PaneMenuDeps {
  return {
    close: vi.fn(),
    newSession: vi.fn(),
    copy: vi.fn(),
    paste: vi.fn(),
    insertFilename: vi.fn(),
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

    item(m, 'close').run();
    expect(d.close).toHaveBeenCalledOnce();
    item(m, 'new-session').run();
    expect(d.newSession).toHaveBeenCalledOnce();
    item(m, 'copy').run();
    expect(d.copy).toHaveBeenCalledOnce();
    item(m, 'paste').run();
    expect(d.paste).toHaveBeenCalledOnce();
    item(m, 'insert-filename').run();
    expect(d.insertFilename).toHaveBeenCalledOnce();
  });

  it('Context menu has an always-enabled Insert Filename item in the first section', () => {
    const m = buildPaneMenu(makeDeps());
    const insert = item(m, 'insert-filename');
    expect(insert.shortcut).toBe('⌘I');
    expect(insert.disabled).toBeFalsy();
    // It lives in the first section alongside Copy/Paste.
    expect(m[0].some((i) => i.id === 'insert-filename')).toBe(true);
  });

  it('Context menu disables copy without a selection and close on the only pane', () => {
    const m = buildPaneMenu(makeDeps({ hasSelection: false, canClose: false }));
    expect(item(m, 'copy').disabled).toBe(true);
    expect(item(m, 'close').disabled).toBe(true);
    // Paste remains available regardless.
    expect(item(m, 'paste').disabled).toBeFalsy();

    const enabled = buildPaneMenu(makeDeps({ hasSelection: true, canClose: true }));
    expect(item(enabled, 'copy').disabled).toBeFalsy();
    expect(item(enabled, 'close').disabled).toBeFalsy();
  });
});
