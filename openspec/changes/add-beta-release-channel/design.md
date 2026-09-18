# Design — beta release channel

## 1. Why channel selection cannot live in configuration

`tauri.conf.json`'s `plugins.updater.endpoints` is a *list*, and
`tauri-plugin-updater`'s `Updater::check` walks it and **breaks on the first
endpoint that returns a parseable release** (`updater.rs`, the `for url in
&self.endpoints` loop). It has no notion of "try them all and take the highest",
and it is not channel-aware.

The three obvious escape hatches are all closed:

| Idea | Why it fails |
| --- | --- |
| Pass the endpoint from JS | `CheckOptions` is `{headers, timeout, proxy, target, allowDowngrades}` — no endpoints. |
| Override at plugin init | `tauri_plugin_updater::Builder` exposes `target`, `pubkey`, `installer_args`, `headers`, `default_version_comparator` — no `endpoints`. Its `UpdaterState` is private and not interior-mutable. |
| URL placeholders | Only `{{target}}`, `{{arch}}`, `{{current_version}}`, `{{bundle_type}}` are substituted. A channel is not derivable from any of them — a user on a stable build who opts into beta still needs the beta manifest. |

What *is* available is `UpdaterExt::updater_builder()`, on any `Manager`, with
`UpdaterBuilder::endpoints(Vec<Url>)`. So channel resolution has to happen in our
own Rust command.

## 2. The seam: our check, the plugin's download

Reimplementing download/install would mean re-creating the progress `Channel`,
the signature verification and the per-platform install paths. We don't: we
reimplement **only** `commands::check`.

The plugin's `download`/`install` commands resolve their handle with
`webview.resources_table().get::<Update>(rid)`. That table is per-webview and the
`Update` type is `tauri_plugin_updater::Update` — both reachable from our own
command. So `updater_check` returns exactly the plugin's `Metadata` shape
(`rid`, `currentVersion`, `version`, `date`, `body`, `rawJson`), the frontend does
`new Update(meta)` with the plugin's **exported** `Update` class, and every
subsequent call (`download`, `install`, `close`) goes through the plugin
unchanged.

Consequences that shaped the code:

- The command takes `webview: Webview<R>`, **not** `AppHandle`. An rid minted
  from a different resource table would not resolve in `download`.
- `date` is passed through from the manifest's `pub_date` string rather than
  re-formatted via `time`, avoiding a dependency for a field the UI does not use.
- On the beta path two `check()`es run and each `Some` allocates an `Update`.
  The loser is dropped explicitly, or the hourly poll leaks one handle per hour —
  the same failure mode `closeUpdate` already guards on the JS side.

## 3. Highest-wins: client-side, not publish-time

The alternative was to make the beta manifest *always* contain
`max(beta, stable)` by rewriting it whenever a stable release publishes. Rejected:
it turns a client rule into a publish-ordering invariant that every future change
to the pipeline has to preserve, and it silently breaks if a stable release is
ever published out of band.

Doing it in the client is three lines of `semver::Version` comparison and is
self-correcting: whatever is published, the app picks the highest candidate it
can see for its channel. It also means a **stable** release needs no beta-lane
awareness at all.

Note the plugin's own comparator already filters `> current_version` per
endpoint, so each check returns `None` when its manifest is not newer. Our
comparison therefore only ever chooses between candidates that are both genuine
upgrades.

## 4. Endpoint hosting: a pinned `beta-channel` prerelease

GitHub gives `releases/latest/download/<asset>` for the newest **non**-prerelease
release, and nothing equivalent for prereleases. Two options were considered:

- **`raw.githubusercontent.com/<owner>/<repo>/beta/latest.json`** — needs a
  manifest commit on the `beta` branch on every publish (with `[skip ci]`
  interplay), permanently diverging `beta` from `main` by a file that is not
  source, and raw.githubusercontent has its own multi-minute cache.
- **A pinned `beta-channel` prerelease** (chosen) — no branch pollution, the
  manifest is served by the same release-asset mechanism as the bundles, and
  freshness is controllable.

Freshness is the reason the refresh **deletes and recreates** the release rather
than re-uploading the asset: a replaced asset can be served stale from cache,
while a new release/asset id is a new URL path segment on the CDN.

The tag is `beta-channel`, not `beta`, so it cannot be confused with the `beta`
*branch* in `refs/` (`git checkout beta` would become ambiguous otherwise).

The refresh runs in `publish-release`, after the versioned Release is undrafted.
That ordering matters: `latest.json` accumulates one platform entry per build leg,
so copying it any earlier would pin the beta channel to a partially populated
manifest.

## 5. Repairing the gate before extending it

`scripts/release-gate.sh`'s `semver_cmp` truncates at `[-+]`. That is not merely
insufficient for the beta lane — it actively breaks the **existing** stable lane
the moment any prerelease tag exists:

```
tags: v0.3.2, v0.4.0-beta.1     package.json on main: 0.4.0
LATEST_TAG (-v:refname, all v*) -> v0.4.0-beta.1
semver_cmp("0.4.0", "0.4.0-beta.1") -> compares "0.4.0" vs "0.4.0" -> 0 (equal)
=> should_release=false, silently, forever
```

`git tag --sort=-v:refname` is also not semver-correct for prereleases without
`versionsort.suffix` configuration.

So the version math moves out of shell into `scripts/lib/version-compare.mjs`
(node is already a hard requirement of the gate) as pure, table-testable
functions: `parseVersion`, `compareVersions` (full semver, numeric-vs-alphanumeric
prerelease identifier rules), `isPrerelease`, `highestTag`, and `decideRelease`.
`release-gate.sh` keeps its CLI contract (`should_release` / `version` / `tag` on
`$GITHUB_OUTPUT`, exit 0 on a no-op) and gains a `channel` output.

The channel/version-form cross-check is deliberately part of the gate rather than
a workflow `if:`: it is version math, it is the thing that would otherwise let
someone accidentally publish a prerelease as stable, and in the gate it is
covered by the same unit tests as everything else.

## 6. Settings

The channel pref follows `compactMode.svelte.ts` exactly — a pure
`parseReleaseChannelPrefs` (tested) plus a rune store that loads once and saves a
merged slice. `runUpdateCheck` reads the store rather than taking a parameter, so
the launch check, the hourly poll, the `updateStore.recheck` retry seam and the
Settings button all follow the preference with no signature changes.

Switching triggers an immediate re-check — otherwise opting into beta appears to
do nothing for up to an hour.
