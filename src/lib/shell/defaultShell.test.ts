import { beforeEach, describe, expect, it } from 'vitest';
import {
  defaultShell,
  hostIsWindows,
  isLaunchableHere,
  platformDefaultShell,
  resolveProgram,
  setHostIsWindows,
  setPlatformDefaultShell,
  setShellPreference,
  shellPreference,
  UNIX_DEFAULT_SHELL
} from './defaultShell';

// The `it(...)` titles are the EXACT `#### Scenario:` names from the
// shell-selection spec, so the coverage gate can match them.

describe('shell-selection', () => {
  beforeEach(() => {
    // Reset the module singletons between tests.
    setPlatformDefaultShell(UNIX_DEFAULT_SHELL);
    setShellPreference(null);
    setHostIsWindows(false);
  });

  it('Fresh install on Windows', () => {
    // The backend resolved pwsh (PowerShell 7 present); a new pane launches it.
    setHostIsWindows(true);
    setPlatformDefaultShell('pwsh');
    expect(platformDefaultShell()).toBe('pwsh');
    expect(defaultShell()).toBe('pwsh');
  });

  it('Windows without PowerShell 7', () => {
    // No pwsh on PATH — the backend falls back to the always-present shell,
    // which must still yield a launchable pane rather than nothing.
    setHostIsWindows(true);
    setPlatformDefaultShell('powershell.exe');
    expect(defaultShell()).toBe('powershell.exe');
  });

  it('macOS default is unchanged', () => {
    // With no preference and the Unix default, behavior is exactly as before.
    expect(defaultShell()).toBe('/bin/zsh');
    // And an explicit $SHELL-derived default flows through untouched.
    setPlatformDefaultShell('/bin/bash');
    expect(defaultShell()).toBe('/bin/bash');
  });

  it('Preference survives a restart', () => {
    // Rehydrating the stored preference on the next launch wins over the default.
    setPlatformDefaultShell('/bin/zsh');
    setShellPreference('/opt/homebrew/bin/fish');
    expect(shellPreference()).toBe('/opt/homebrew/bin/fish');
    expect(defaultShell()).toBe('/opt/homebrew/bin/fish');
  });

  it('Unset preference falls through to the default', () => {
    setHostIsWindows(true);
    setPlatformDefaultShell('pwsh');
    for (const bad of [null, undefined, '', '   ', 42, {}]) {
      setShellPreference(bad as unknown as string);
      expect(shellPreference(), `${JSON.stringify(bad)} should clear`).toBe(null);
      expect(defaultShell()).toBe('pwsh');
    }
  });

  it('A macOS-authored layout is restored on Windows', () => {
    // THE regression this capability exists to prevent: a persisted layout
    // recording /bin/zsh, restored on Windows, must not spawn a dead pane.
    setHostIsWindows(true);
    setPlatformDefaultShell('pwsh');
    expect(resolveProgram('/bin/zsh')).toBe('pwsh');
    expect(resolveProgram('/bin/bash')).toBe('pwsh');
    expect(isLaunchableHere('/bin/zsh', true)).toBe(false);

    // The mirror case: a Windows-authored layout restored on macOS.
    setHostIsWindows(false);
    setPlatformDefaultShell('/bin/zsh');
    expect(resolveProgram('powershell.exe')).toBe('/bin/zsh');
    expect(resolveProgram('C:\\Windows\\system32\\cmd.exe')).toBe('/bin/zsh');
    expect(isLaunchableHere('powershell.exe', false)).toBe(false);
  });

  it('keeps a program that is launchable on the host', () => {
    // Same-platform values are passed through untouched — the fallback must not
    // be overeager, or a user's real choice would be silently discarded.
    setPlatformDefaultShell('/bin/zsh');
    expect(resolveProgram('/bin/bash')).toBe('/bin/bash');
    expect(resolveProgram('claude')).toBe('claude'); // bare command, no path
    setHostIsWindows(true);
    setPlatformDefaultShell('pwsh');
    expect(resolveProgram('powershell.exe')).toBe('powershell.exe');
    expect(resolveProgram('C:\\tools\\nu.exe')).toBe('C:\\tools\\nu.exe');
    expect(resolveProgram('claude')).toBe('claude');
  });

  it('PowerShell on Linux or macOS is a legitimate choice', () => {
    // PowerShell 7 runs on Unix (`brew install powershell`). Treating a bare
    // `pwsh` as Windows-only silently discarded the user's explicit setting,
    // while `/usr/bin/pwsh` worked — an arbitrary, undiscoverable distinction.
    setHostIsWindows(false);
    setPlatformDefaultShell('/bin/bash');
    expect(isLaunchableHere('pwsh', false)).toBe(true);
    setShellPreference('pwsh');
    expect(defaultShell()).toBe('pwsh');
    setShellPreference('/usr/bin/pwsh');
    expect(defaultShell()).toBe('/usr/bin/pwsh');
  });

  it('the host platform is an explicit signal, not inferred from the default', () => {
    // Inferring the platform from the resolved default made a Windows box that
    // defaults to bare `pwsh` read as Unix, which then rejected every Windows
    // program in a restored layout.
    setHostIsWindows(true);
    setPlatformDefaultShell('pwsh');
    expect(hostIsWindows()).toBe(true);
    expect(resolveProgram('C:\\tools\\nu.exe')).toBe('C:\\tools\\nu.exe');
    expect(resolveProgram('powershell.exe')).toBe('powershell.exe');
    expect(resolveProgram('/bin/zsh')).toBe('pwsh');
  });

  it('trims surrounding whitespace from a stored program', () => {
    setPlatformDefaultShell('/bin/zsh');
    expect(resolveProgram('  /bin/bash  ')).toBe('/bin/bash');
  });
});
