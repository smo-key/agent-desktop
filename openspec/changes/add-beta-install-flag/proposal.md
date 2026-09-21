## Why

The Beta release channel now works end to end inside the app: `0.4.0-2` ships
the `beta-latest.json` endpoint, and Settings → Software update lets a user
switch trains. But there is no way to *get onto* the beta train from a clean
machine. The one-line installers resolve their asset from GitHub's
`releases/latest`, which by definition excludes prereleases — so the documented
install command can only ever produce a stable build.

That leaves the only path onto beta as "install stable, launch it, open
Settings, switch to Beta, wait for an update check" — and for anyone who wants
to test a beta *because* it fixes their problem, that is precisely the build
they cannot run yet.

## What Changes

- **`docs/install.sh`** accepts an optional channel argument:
  `curl -fsSL … | sh -s -- beta`. With no argument the behavior is byte-for-byte
  what it is today — the stable path is unchanged and still needs no flags.
- **`docs/install.ps1`** accepts the same choice as a `-Channel` parameter, so
  `& ([scriptblock]::Create((irm …))) beta` installs a beta on Windows. The
  documented `irm … | iex` form keeps working and still installs stable.
- **Beta resolution** goes through the newest **prerelease** in the releases
  list — drafts skipped — and then re-uses the existing single-release asset
  resolution, digest verification and install paths unchanged.
- An **unknown channel is rejected** rather than silently treated as stable, so
  a typo cannot quietly install the wrong train.
- After a beta install the script **points at the in-app channel setting**,
  because installing a beta build does not by itself put the app on the beta
  channel.
- **`README.md`** documents both commands.

Out of scope: writing the app's `releaseChannel` preference from the installer.
That means reaching into the app's settings blob from a shell script, and the
in-app control already exists; the installer names it instead.

## Capabilities

### Modified Capabilities
- `quick-install`: gains a channel argument. Asset resolution, integrity
  verification and the per-OS install paths are untouched — only *which release*
  is resolved changes, and only when the argument is given.
