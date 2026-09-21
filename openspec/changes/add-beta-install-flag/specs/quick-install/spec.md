## ADDED Requirements

### Requirement: Channel argument selects the release train
The installers SHALL accept an optional channel argument whose only accepted values are `stable` and `beta`, matched case-insensitively, and SHALL default to `stable` when it is absent.

`install.sh` SHALL take it as its first positional argument (`sh -s -- beta`
through a pipe) and `install.ps1` SHALL take it as a `-Channel` parameter, bound
positionally or by name, so the documented `irm … | iex` form continues to
install stable with no argument at all.

An unrecognized value SHALL be rejected with a message naming the accepted
values, and SHALL NOT fall back to a default, so that a typo cannot silently
install a different train than the user asked for.

#### Scenario: No argument installs stable

- **WHEN** the script is run with no channel argument
- **THEN** it resolves its asset from the stable `releases/latest` endpoint exactly as before

#### Scenario: Beta argument selects the beta train

- **WHEN** the script is run with `beta` (in any letter case)
- **THEN** it resolves its asset from the newest published prerelease

#### Scenario: Unknown channel is refused

- **WHEN** the script is run with a channel that is neither `stable` nor `beta`
- **THEN** it prints the accepted values and exits non-zero without downloading or installing anything

### Requirement: Beta resolution uses the newest published prerelease
On the beta channel the installers SHALL select the most recently published release whose `prerelease` flag is true and whose `draft` flag is false, and SHALL then resolve, verify and install that release's platform asset through the same path the stable channel uses.

Draft releases SHALL be skipped even when they are marked as prereleases,
because a failed release run can leave a draft carrying partial assets.

A stable release that is newer than every prerelease SHALL NOT displace the
prerelease: a user who asked for `beta` gets the beta build, and the app's own
beta channel — which prefers the highest version from either train — settles any
ordering from there.

#### Scenario: Newest prerelease is chosen over older ones

- **WHEN** the releases list contains several prereleases
- **THEN** the most recently published one is selected

#### Scenario: Draft prereleases are skipped

- **WHEN** the newest prerelease in the list is also marked `draft`
- **THEN** it is skipped and the newest non-draft prerelease is selected instead

#### Scenario: No prerelease has been published

- **WHEN** the releases list contains no non-draft prerelease
- **THEN** the script says so, points at the stable command, and exits non-zero without installing

### Requirement: A beta install names the in-app channel setting
After installing from the beta channel the installers SHALL tell the user that the app's own release channel is a separate, in-app preference and name where it lives (Settings → Software update).

Installing a beta build does not subscribe the app to the beta train, so without
this the user would receive no further betas and have no indication why.

#### Scenario: Beta install explains how to keep receiving betas

- **WHEN** an install from the beta channel completes
- **THEN** the closing output names the in-app Beta setting under Settings → Software update

#### Scenario: Stable install says nothing extra

- **WHEN** an install from the stable channel completes
- **THEN** no channel guidance is printed, leaving the default path unchanged
