//! Channel-aware update check (release-channels + desktop-auto-update specs).
//!
//! The Tauri updater plugin takes its endpoints from `tauri.conf.json` and, given
//! several, uses the **first that responds** — not the one with the highest
//! version (see `tauri-plugin-updater`'s `Updater::check`, which breaks out of its
//! endpoint loop as soon as one parses). Neither the JS `check()` options
//! (`headers`/`timeout`/`proxy`/`target`/`allowDowngrades`) nor the plugin's
//! `Builder` (`target`/`pubkey`/`installer_args`/`headers`/
//! `default_version_comparator`) expose an endpoint override, and the URL
//! placeholders (`{{target}}`, `{{arch}}`, `{{current_version}}`,
//! `{{bundle_type}}`) cannot express a channel. So channel selection has to happen
//! here, against `UpdaterExt::updater_builder().endpoints(..)`.
//!
//! We reimplement ONLY the plugin's `check` command. Its `download` / `install`
//! commands resolve their handle with `webview.resources_table().get::<Update>(rid)`,
//! so returning the plugin's own `Metadata` shape — with the `Update` registered in
//! the **calling webview's** resource table — lets the frontend rebuild a plugin
//! `Update` and keep using the plugin's download/progress/install path unchanged.
//!
//! On the beta channel BOTH manifests are checked and the higher-versioned
//! candidate wins, so a stable hotfix that outranks the current beta still reaches
//! beta users without the publish pipeline maintaining any cross-channel invariant.

use serde::{Deserialize, Serialize};
use tauri::{Manager, ResourceId, Runtime, Webview};
use tauri_plugin_updater::{Update, UpdaterExt};

/// The release channels the app can follow. Anything unrecognized from the
/// frontend is treated as `Stable` — a user is never opted into prereleases by a
/// malformed preference.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Channel {
    Stable,
    Beta,
}

impl Channel {
    /// Parse a channel name from the frontend, defaulting to `Stable`.
    pub fn parse(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "beta" => Channel::Beta,
            _ => Channel::Stable,
        }
    }
}

/// The metadata shape the updater plugin's own `check` command returns, so the
/// frontend can reconstruct its `Update` class from ours verbatim.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    pub rid: ResourceId,
    pub current_version: String,
    pub version: String,
    pub date: Option<String>,
    pub body: Option<String>,
    pub raw_json: serde_json::Value,
}

/// Which configured endpoints a channel queries, as indices into
/// `plugins.updater.endpoints` (index 0 = stable, index 1 = beta).
///
/// Stable asks only the stable manifest, so a prerelease can never be offered to
/// a stable user. Beta asks BOTH, because the winner is the highest version
/// across them — a stable release that outranks the current beta must still be
/// offered.
pub fn endpoint_indices_for(channel: Channel) -> &'static [usize] {
    match channel {
        Channel::Stable => &[0],
        Channel::Beta => &[1, 0],
    }
}

/// Pick the higher of two candidate versions, PURELY.
///
/// Returns `true` when `candidate` should replace `incumbent`. `None` for the
/// incumbent means "nothing chosen yet". An unparseable version loses to a
/// parseable one and never displaces an existing choice, so a malformed manifest
/// cannot hijack the decision.
pub fn candidate_wins(candidate: &str, incumbent: Option<&str>) -> bool {
    let Ok(cand) = semver::Version::parse(candidate) else {
        return false;
    };
    match incumbent {
        None => true,
        Some(cur) => match semver::Version::parse(cur) {
            Ok(cur) => cand > cur,
            // The incumbent is unparseable; anything valid beats it.
            Err(_) => true,
        },
    }
}

/// Read the updater endpoints out of the app's own configuration, so the URLs stay
/// single-sourced in `tauri.conf.json` rather than being duplicated here.
fn configured_endpoints<R: Runtime>(webview: &Webview<R>) -> Vec<String> {
    webview
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|v| v.get("endpoints"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

/// Check the selected channel for an available update.
///
/// Mirrors `tauri_plugin_updater::commands::check`, but builds the updater against
/// the endpoint(s) for `channel` and, on beta, keeps the highest-versioned
/// candidate across both manifests. The rejected candidate's resource is closed so
/// the hourly background poll does not accumulate handles.
#[tauri::command]
pub async fn updater_check<R: Runtime>(
    webview: Webview<R>,
    channel: String,
) -> Result<Option<UpdateMetadata>, String> {
    let channel = Channel::parse(&channel);
    let endpoints = configured_endpoints(&webview);

    let mut best: Option<Update> = None;
    let mut last_error: Option<String> = None;
    let mut asked = 0usize;

    for idx in endpoint_indices_for(channel) {
        let Some(raw) = endpoints.get(*idx) else {
            // A channel whose endpoint is not configured is skipped rather than
            // failing the whole check; stable still works if beta is missing.
            continue;
        };
        let Ok(url) = url::Url::parse(raw) else {
            last_error = Some(format!("invalid updater endpoint: {raw}"));
            continue;
        };
        asked += 1;

        let updater = match webview
            .updater_builder()
            .endpoints(vec![url])
            .map_err(|e| e.to_string())
            .and_then(|b| b.build().map_err(|e| e.to_string()))
        {
            Ok(u) => u,
            Err(e) => {
                last_error = Some(e);
                continue;
            }
        };

        match updater.check().await {
            // `None` = this manifest offers nothing newer than the running
            // version; the plugin's own comparator already filtered it.
            Ok(None) => {}
            Ok(Some(update)) => {
                let wins = candidate_wins(&update.version, best.as_ref().map(|u| u.version.as_str()));
                if wins {
                    best = Some(update);
                }
                // The loser is simply dropped here: it was never registered in the
                // resource table, so there is nothing to close.
            }
            Err(e) => last_error = Some(e.to_string()),
        }
    }

    match best {
        Some(update) => {
            // Date is passed through from the manifest rather than re-formatted, so
            // this command needs no time-formatting dependency for a field the UI
            // does not render.
            let date = update
                .raw_json
                .get("pub_date")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let meta = UpdateMetadata {
                current_version: update.current_version.clone(),
                version: update.version.clone(),
                date,
                body: update.body.clone(),
                raw_json: update.raw_json.clone(),
                // MUST be the calling webview's table: the plugin's `download` /
                // `install` commands resolve the rid from there.
                rid: webview.resources_table().add(update),
            };
            Ok(Some(meta))
        }
        None => {
            // Every endpoint we asked errored -> report it, so the manual Settings
            // check can show "Couldn't check". Otherwise we are genuinely current.
            if asked > 0 && last_error.is_some() {
                Err(last_error.unwrap())
            } else if asked == 0 {
                Err(format!(
                    "no updater endpoint configured for the {channel:?} channel"
                ))
            } else {
                Ok(None)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channel_parse_defaults_to_stable() {
        assert_eq!(Channel::parse("beta"), Channel::Beta);
        assert_eq!(Channel::parse("BETA"), Channel::Beta);
        assert_eq!(Channel::parse(" beta "), Channel::Beta);
        assert_eq!(Channel::parse("stable"), Channel::Stable);
        assert_eq!(Channel::parse(""), Channel::Stable);
        assert_eq!(Channel::parse("nightly"), Channel::Stable);
    }

    #[test]
    fn stable_ignores_a_newer_beta() {
        // Stable queries the stable endpoint ONLY, so the beta manifest is never
        // even fetched for a user on the stable channel.
        assert_eq!(endpoint_indices_for(Channel::Stable), &[0]);
    }

    #[test]
    fn beta_takes_the_newer_beta() {
        assert!(candidate_wins("0.4.0-beta.4", Some("0.4.0-beta.3")));
        assert!(!candidate_wins("0.4.0-beta.3", Some("0.4.0-beta.4")));
    }

    #[test]
    fn beta_takes_a_higher_stable() {
        // Beta asks both manifests, and a plain release outranks its prereleases.
        assert_eq!(endpoint_indices_for(Channel::Beta), &[1, 0]);
        assert!(candidate_wins("0.4.0", Some("0.4.0-beta.3")));
        assert!(!candidate_wins("0.3.2", Some("0.4.0-beta.3")));
    }

    #[test]
    fn a_losing_candidate_is_not_leaked() {
        // The first candidate always wins against "nothing chosen yet"; a lower
        // second candidate is rejected (and dropped before ever reaching the
        // resource table).
        assert!(candidate_wins("0.4.0-beta.1", None));
        assert!(!candidate_wins("0.3.9", Some("0.4.0-beta.1")));
    }

    #[test]
    fn a_malformed_version_never_wins() {
        assert!(!candidate_wins("not-a-version", None));
        assert!(!candidate_wins("", Some("0.4.0")));
        // …but anything valid displaces an unparseable incumbent.
        assert!(candidate_wins("0.4.0", Some("garbage")));
    }
}
