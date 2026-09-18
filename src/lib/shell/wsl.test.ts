import { describe, expect, it } from 'vitest';
import {
  distroFor,
  distroFromCwd,
  distroFromShell,
  isPseudoDistro,
  isWslShell,
  toWslPath,
  wslInvocation
} from './wsl';

// The `it(...)` titles are the EXACT `#### Scenario:` names from the
// wsl-agent-launch spec, so the coverage gate can match them.

describe('wsl-agent-launch', () => {
  describe('isWslShell', () => {
    it('A non-WSL shell is unaffected', () => {
      // The heuristic is the ONLY trigger for the whole WSL path, so a false
      // positive would reroute a perfectly good Windows/Unix launch through a
      // VM that may not exist.
      for (const program of [
        'pwsh',
        'powershell.exe',
        'C:\\Windows\\system32\\cmd.exe',
        '/bin/zsh',
        '/bin/bash', // POSIX bash is NOT the WSL launcher
        'C:\\tools\\nu.exe',
        '',
        '   '
      ]) {
        expect(isWslShell(program), `${JSON.stringify(program)}`).toBe(false);
      }
    });

    it('recognizes the WSL launchers', () => {
      for (const program of [
        'wsl.exe',
        'wsl',
        'C:\\Windows\\System32\\bash.exe', // the legacy WSL shim, by FULL PATH only
        'ubuntu.exe',
        'Ubuntu.exe',
        'ubuntu-24.04.exe',
        'ubuntu2404.exe',
        'debian.exe',
        'kali-linux.exe',
        'opensuse-tumbleweed.exe',
        'sles-15.exe',
        'oracle-linux-9.exe',
        'fedoraremix.exe',
        // Real aliases an over-narrow list had rejected.
        'ubuntupreview.exe',
        'Arch.exe',
        'SLES-12-SP5.exe',
        'opensuse-leap-15.6.exe',
        'kali.exe',
        // The real-world case from the field report: a full WindowsApps path.
        'C:\\Program Files\\WindowsApps\\CanonicalGroupLimited.Ubuntu_2204.1.7.0_x64__79rhkp1fndgsc\\ubuntu.exe',
        'C:/Program Files/WindowsApps/Canonical.../ubuntu.exe'
      ]) {
        expect(isWslShell(program), `${JSON.stringify(program)}`).toBe(true);
      }
    });

    it('does not mistake a lookalike Windows program for a launcher', () => {
      // The matcher was prefix-anchored (`^(…|mint|arch)`) and matched
      // `mintty.exe` — the Git Bash / Cygwin terminal — and `archive.exe`.
      // A false positive spawns `wsl.exe` for someone who may have no WSL at
      // all, inflicting the very os error 2 this capability exists to fix.
      for (const program of [
        'mintty.exe',
        'C:\\Program Files\\Git\\usr\\bin\\mintty.exe',
        'archive.exe',
        // Git Bash / MSYS2 / Cygwin: by far the most common bash.exe on Windows.
        'C:\\Program Files\\Git\\bin\\bash.exe',
        'C:\\msys64\\usr\\bin\\bash.exe',
        'C:\\cygwin64\\bin\\bash.exe',
        'bash.exe'
      ]) {
        expect(isWslShell(program), `${JSON.stringify(program)}`).toBe(false);
        expect(distroFromShell(program)).toBe(null);
      }
    });

    it('tolerates a non-string program', () => {
      for (const bad of [null, undefined, 42, {}, []]) {
        expect(isWslShell(bad as unknown as string)).toBe(false);
      }
    });
  });

  describe('path translation', () => {
    it('A distro-internal project folder', () => {
      expect(toWslPath('\\\\wsl.localhost\\Ubuntu\\home\\u\\src\\app')).toBe(
        '/home/u/src/app'
      );
      // The exact folder from the field report.
      expect(
        toWslPath('\\\\wsl.localhost\\Ubuntu\\home\\v-patel\\source\\data-flow-central')
      ).toBe('/home/v-patel/source/data-flow-central');
    });

    it('The legacy UNC form', () => {
      expect(toWslPath('\\\\wsl$\\Ubuntu\\home\\u\\src\\app')).toBe('/home/u/src/app');
      // Forward-slash spellings of both UNC forms occur in persisted layouts.
      expect(toWslPath('//wsl$/Ubuntu/home/u/src/app')).toBe('/home/u/src/app');
      expect(toWslPath('//wsl.localhost/Ubuntu/home/u')).toBe('/home/u');
    });

    it('A Windows-drive path', () => {
      expect(toWslPath('C:\\Users\\u\\AppData\\Roaming\\app\\s.js')).toBe(
        '/mnt/c/Users/u/AppData/Roaming/app/s.js'
      );
      expect(toWslPath('C:/Users/u/AppData/Roaming/app/s.js')).toBe(
        '/mnt/c/Users/u/AppData/Roaming/app/s.js'
      );
      // The drive letter is lowercased — /mnt/C does not exist.
      expect(toWslPath('D:\\data')).toBe('/mnt/d/data');
    });

    it('passes a POSIX path through unchanged', () => {
      expect(toWslPath('/home/u/src')).toBe('/home/u/src');
      expect(toWslPath('/')).toBe('/');
    });

    it('translates the distro root to /', () => {
      // A project opened AT the distro root must not yield the empty string,
      // which `cd ""` would reject.
      expect(toWslPath('\\\\wsl.localhost\\Ubuntu')).toBe('/');
      expect(toWslPath('\\\\wsl.localhost\\Ubuntu\\')).toBe('/');
    });

    it('tolerates a non-string path', () => {
      for (const bad of [null, undefined, 42, {}]) {
        expect(toWslPath(bad as unknown as string)).toBe('');
      }
    });
  });

  describe('distro resolution', () => {
    it('The folder names the distro', () => {
      // The cwd is the STRONGER signal: it names its distro unambiguously,
      // while the shell basename is a pattern match.
      expect(distroFor('ubuntu.exe', '\\\\wsl.localhost\\Debian\\home\\u')).toBe('Debian');
      expect(distroFromCwd('\\\\wsl$\\Debian\\home\\u')).toBe('Debian');
    });

    it('Only the shell names the distro', () => {
      expect(distroFor('ubuntu.exe', 'C:\\src\\app')).toBe('Ubuntu');
      expect(distroFromShell('debian.exe')).toBe('Debian');
      expect(
        distroFromShell(
          'C:\\Program Files\\WindowsApps\\CanonicalGroupLimited.Ubuntu_2204\\ubuntu.exe'
        )
      ).toBe('Ubuntu');
    });

    it('Neither names a distro', () => {
      // A generic launcher with a non-distro cwd: do NOT guess. Omitting -d
      // lets wsl.exe apply the user's own default.
      expect(distroFor('wsl.exe', 'C:\\src\\app')).toBe(null);
      expect(distroFromShell('wsl.exe')).toBe(null);
      expect(distroFromShell('bash.exe')).toBe(null);
      expect(distroFromCwd('C:\\src\\app')).toBe(null);
    });

    it('does not guess a versioned distro name', () => {
      // `ubuntu2404` → `Ubuntu2404` is a name the registry never uses, and a
      // WRONG `-d` hard-fails while omitting it falls back to the user's default
      // distro. So an unreliable derivation yields null rather than a guess.
      expect(distroFromShell('ubuntu-24.04.exe')).toBe(null);
      expect(distroFromShell('ubuntu2404.exe')).toBe(null);
      expect(distroFromShell('opensuse-leap-15.6.exe')).toBe(null);
      // A project inside the distro is unaffected: its UNC path carries the
      // true registered name and wins over the shell signal.
      expect(distroFor('ubuntu-24.04.exe', '\\\\wsl.localhost\\Ubuntu-24.04\\home\\u')).toBe(
        'Ubuntu-24.04'
      );
    });

    it('never targets a pseudo-distro', () => {
      // VERIFIED on the reporter's machine: `wsl.exe -l -q` lists Ubuntu AND
      // docker-desktop. Docker's entries are not interactive distros.
      expect(isPseudoDistro('docker-desktop')).toBe(true);
      expect(isPseudoDistro('docker-desktop-data')).toBe(true);
      expect(isPseudoDistro('Docker-Desktop')).toBe(true);
      expect(isPseudoDistro('Ubuntu')).toBe(false);

      // Even when a path names one, it is not a launch target.
      expect(distroFromCwd('\\\\wsl.localhost\\docker-desktop\\tmp')).toBe(null);
    });
  });

  describe('wslInvocation', () => {
    it('Agent session in a WSL project folder', () => {
      const { program, args } = wslInvocation({
        distro: 'Ubuntu',
        cwd: '\\\\wsl.localhost\\Ubuntu\\home\\u\\app',
        exe: 'claude',
        args: ['--session-id', 'abc']
      });
      expect(program).toBe('wsl.exe');
      expect(args).toEqual([
        '-d',
        'Ubuntu',
        '--',
        'sh',
        '-lc',
        '[ -n "$1" ] || { echo "agent-desktop: no working directory" >&2; exit 1; }; cd "$1" || exit 1; shift; exec "$@"',
        'sh',
        '/home/u/app',
        'claude',
        '--session-id',
        'abc'
      ]);
    });

    it('The agent CLI is only on the login PATH', () => {
      // `-l` is what sources the profile that puts ~/.local/bin on PATH.
      // VERIFIED: the reporter's CLIs live at /home/v-patel/.local/bin.
      const { args } = wslInvocation({
        distro: 'Ubuntu',
        cwd: '/home/u',
        exe: 'claude',
        args: []
      });
      expect(args).toContain('-lc');
      expect(args.some((a) => a.includes('-l'))).toBe(true);
    });

    it('A path containing spaces', () => {
      // Arguments ride in "$@" — never interpolated into the script text — so
      // whitespace and quotes cannot split the command or inject shell syntax.
      const { args } = wslInvocation({
        distro: 'Ubuntu',
        cwd: '/home/u/my project',
        exe: 'claude',
        args: ['--settings', '{"a":"b c"}', "it's"]
      });
      expect(args).toEqual([
        '-d',
        'Ubuntu',
        '--',
        'sh',
        '-lc',
        '[ -n "$1" ] || { echo "agent-desktop: no working directory" >&2; exit 1; }; cd "$1" || exit 1; shift; exec "$@"',
        'sh',
        '/home/u/my project',
        'claude',
        '--settings',
        '{"a":"b c"}',
        "it's"
      ]);
      // The script text is a FIXED constant: no input reaches it.
      const script = args[5];
      expect(script).toBe('[ -n "$1" ] || { echo "agent-desktop: no working directory" >&2; exit 1; }; cd "$1" || exit 1; shift; exec "$@"');
      expect(script).not.toContain('my project');
    });

    it('A launch with no working directory is refused', () => {
      // `cd ""` is a SILENT NO-OP in POSIX sh (verified on sh, dash and bash) —
      // it exits 0 and leaves the inherited directory. Without the `-n` guard an
      // empty cwd would start the agent in the distro's $HOME, which is exactly
      // the silent wrong-directory outcome `|| exit 1` exists to prevent.
      const { args } = wslInvocation({ distro: 'Ubuntu', cwd: '', exe: 'claude', args: [] });
      expect(args).toContain('[ -n "$1" ] || { echo "agent-desktop: no working directory" >&2; exit 1; }; cd "$1" || exit 1; shift; exec "$@"');
    });

    it('omits -d when no distro is known', () => {
      const { args } = wslInvocation({
        distro: null,
        cwd: '/home/u',
        exe: 'claude',
        args: []
      });
      expect(args.slice(0, 2)).toEqual(['--', 'sh']);
      expect(args).not.toContain('-d');
    });

    it('keeps the sh placeholder that takes $0', () => {
      // POSIX assigns the first operand after `-c <script>` to $0. Dropping the
      // placeholder would shift every parameter by one: `cd "$1"` would target
      // the executable and the cwd would be exec'd as the command.
      const { args } = wslInvocation({
        distro: null,
        cwd: '/home/u',
        exe: 'claude',
        args: []
      });
      const scriptIdx = args.indexOf('[ -n "$1" ] || { echo "agent-desktop: no working directory" >&2; exit 1; }; cd "$1" || exit 1; shift; exec "$@"');
      expect(args[scriptIdx + 1]).toBe('sh'); // $0
      expect(args[scriptIdx + 2]).toBe('/home/u'); // $1 — the cwd
      expect(args[scriptIdx + 3]).toBe('claude'); // $2 — the command
    });
  });
});
