import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShellStore } from './shell.svelte';
import {
  setHostIsWindows,
  setPlatformDefaultShell,
  UNIX_DEFAULT_SHELL
} from '$lib/shell/defaultShell';
import { isWslShell } from '$lib/shell/wsl';

// The invalidation half of the `shell-selection` delta in `wsl-agent-launch`:
// the shell preference is the signal for WHERE agent executables live, so
// changing it must re-run detection. Without this the settings placeholder keeps
// showing an in-distro Linux path after the user switches back to a host shell.
//
// The `it(...)` titles are the EXACT `#### Scenario:` names from that delta.

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockRejectedValue(new Error('no backend in tests'))
}));

describe('shell-selection — agent executable invalidation', () => {
  beforeEach(() => {
    setPlatformDefaultShell(UNIX_DEFAULT_SHELL);
    // A WSL shell is only launchable on a Windows host. The store notifies the
    // RESOLVED shell (what spawns actually use), so without this the `.exe`
    // values below would correctly resolve away to the platform default.
    setHostIsWindows(true);
  });

  afterEach(() => setHostIsWindows(false));

  it('notifies the shell that will actually be used, not the raw input', () => {
    // On a non-Windows host `ubuntu.exe` is not launchable, and every spawn
    // resolves it to the platform default. Notifying the raw string would have
    // detection probing a distro while launches used /bin/zsh — and the
    // distro-match guard would then discard every detected path, forever.
    setHostIsWindows(false);
    setPlatformDefaultShell('/bin/zsh');
    const store = new ShellStore();
    const seen: string[] = [];
    store.onShellChanged = (shell) => void seen.push(shell);

    store.setProgram('ubuntu.exe');

    expect(seen).toEqual(['/bin/zsh']);
    expect(isWslShell(seen[0])).toBe(false);
  });

  it('Switching to a WSL shell', () => {
    const store = new ShellStore();
    const seen: string[] = [];
    store.onShellChanged = (shell) => void seen.push(shell);

    store.setProgram('C:\\Program Files\\WindowsApps\\Canonical\\ubuntu.exe');

    expect(seen).toHaveLength(1);
    expect(isWslShell(seen[0])).toBe(true);
    // The new shell — not the old one — is what detection is re-run against.
    expect(seen[0]).toContain('ubuntu.exe');
  });

  it('Switching away from a WSL shell', () => {
    const store = new ShellStore();
    const seen: string[] = [];
    store.onShellChanged = (shell) => void seen.push(shell);

    store.setProgram('ubuntu.exe');
    store.setProgram('pwsh');

    expect(seen).toEqual(['ubuntu.exe', 'pwsh']);
    // The second notification is for a NON-WSL shell, so the re-probe targets
    // the host and the previously detected in-distro paths cannot survive.
    expect(isWslShell(seen[1])).toBe(false);
  });

  it('reports the platform default when the preference is cleared', () => {
    // Clearing means "use the platform default", so THAT is the shell detection
    // must run against — not an empty string, which implies nothing.
    setPlatformDefaultShell('pwsh');
    const store = new ShellStore();
    const seen: string[] = [];
    store.onShellChanged = (shell) => void seen.push(shell);

    store.setProgram('ubuntu.exe');
    store.setProgram('');

    expect(seen).toEqual(['ubuntu.exe', 'pwsh']);
  });

  it('does not require a listener', () => {
    // The hook is optional: a store with no listener (any context that never
    // wires the agent-paths store) must not throw on a shell change.
    const store = new ShellStore();
    expect(() => store.setProgram('pwsh')).not.toThrow();
  });
});
