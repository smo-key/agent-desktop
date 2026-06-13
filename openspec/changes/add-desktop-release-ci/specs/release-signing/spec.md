## ADDED Requirements

### Requirement: macOS builds are signed and notarized from secrets

When Apple signing secrets are present, the macOS build jobs SHALL import the
code-signing certificate into a temporary keychain and SHALL produce a build that
is code-signed with the Developer ID identity, notarized by Apple, and stapled.
The pipeline SHALL accept either notary credential set documented in
`.env.notarize.example`: an App Store Connect API key (`APPLE_API_ISSUER`,
`APPLE_API_KEY`, `APPLE_API_KEY_PATH`) or an Apple ID set (`APPLE_ID`,
`APPLE_PASSWORD`, `APPLE_TEAM_ID`), alongside `APPLE_SIGNING_IDENTITY` and the
certificate (`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`).

#### Scenario: Signing secrets present

- **WHEN** a macOS target builds with the certificate and a complete notary
  credential set available
- **THEN** the certificate is imported into a temporary keychain and the produced
  `.dmg`/`.app` is signed, notarized, and stapled

#### Scenario: Temporary keychain is isolated

- **WHEN** the certificate is imported for a build
- **THEN** it is imported into a temporary, unlocked keychain created for the run
  rather than the runner's default login keychain

### Requirement: Graceful unsigned fallback

The macOS build SHALL produce an unsigned artifact and still succeed when the signing certificate secret is absent (e.g. a fork or untrusted pull request): it SHALL skip keychain import, emit a warning that the artifact is unsigned, and SHALL NOT leak secret values in logs.

#### Scenario: Signing secrets absent

- **WHEN** a macOS target builds with no certificate secret available
- **THEN** the build skips signing, logs a warning that the artifact is unsigned,
  and the job still completes successfully

### Requirement: Updater signing key

The pipeline SHALL sign updater bundles with the Tauri update-signing private key
provided via secret (`TAURI_SIGNING_PRIVATE_KEY`, with
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` when set), so that published update artifacts
carry valid signatures verifiable against the committed public key.

#### Scenario: Update bundles are signed

- **WHEN** a release builds with the updater signing key available
- **THEN** the produced update bundles are signed and their signatures verify
  against the public key configured in the app
