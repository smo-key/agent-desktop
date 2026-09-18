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
        'bash.exe', // the Windows WSL bash shim
        'ubuntu.exe',
        'Ubuntu.exe',
        'ubuntu-24.04.exe',
        'ubuntu2404.exe',
        'debian.exe',
        'kali-linux.exe',
        'opensuse-tumbleweed.exe',
        'SLES-15.exe',
        'oracle-linux-9.exe',
        'fedoraremix.exe',
        // The real-world case from the field report: a full WindowsApps path.
        'C:\\Program Files\\WindowsApps\\CanonicalGroupLimited.Ubuntu_2204.1.7.0_x64__79rhkp1fndgsc\\ubuntu.exe',
        'C:/Program Files/WindowsApps/Canonical.../ubuntu.exe'
      ]) {
        expect(isWslShell(program), `${JSON.stringify(program)}`).toBe(true);
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
      expect(distroFor('ubuntu-24.04.exe', 'C:\\src\\app')).toBe('Ubuntu-24.04');
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
        'cd "$1" || exit 1; shift; exec "$@"',
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
        'cd "$1" || exit 1; shift; exec "$@"',
        'sh',
        '/home/u/my project',
        'claude',
        '--settings',
        '{"a":"b c"}',
        "it's"
      ]);
      // The script text is a FIXED constant: no input reaches it.
      const script = args[5];
      expect(script).toBe('cd "$1" || exit 1; shift; exec "$@"');
      expect(script).not.toContain('my project');
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
      const scriptIdx = args.indexOf('cd "$1" || exit 1; shift; exec "$@"');
      expect(args[scriptIdx + 1]).toBe('sh'); // $0
      expect(args[scriptIdx + 2]).toBe('/home/u'); // $1 — the cwd
      expect(args[scriptIdx + 3]).toBe('claude'); // $2 — the command
    });
  });
});
