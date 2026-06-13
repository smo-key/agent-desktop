## Why

Agent Desktop exists so you can run many agents but only think about one at a
time — yet today the only signal that an agent needs you is the visual "Needs
input" lane, which you miss the moment you switch apps or focus on a different
agent. An agent then sits idle, waiting, while you don't know to look. The app
needs to actively reach out — a sound and/or an OS desktop notification — the
instant an agent starts waiting on you.

## What Changes

- Add two **independent alert channels** that fire when an agent enters the
  "Needs input" state (the existing `needsAttention` predicate: a live agent that
  is `waiting` at its prompt or `error`ed, and not paused/archived):
  - a **sound** (a short synthesized chime), and
  - an **OS desktop notification** (native, via the Tauri notification plugin).
- Each channel has its **own alert mode**, fully independent of the other:
  - `off` — never alert on this channel,
  - `app-unfocused` — alert only when the Agent Desktop window is not focused,
  - `agent-unfocused` — alert unless you are actively viewing that exact agent,
  - `always` — alert on every entry into "Needs input".
- An alert fires **once, on the edge** an agent enters "Needs input" — not
  repeatedly while it stays there. Agents already waiting when the app launches
  do not alert (the detector primes on first observation).
- Persist the two channel modes as a new `notifications` slice of `settings.json`;
  surface both as pickers in the Settings modal. **Defaults: both channels `off`**
  (the feature is silent and opt-in out of the box).
- The desktop channel requests the OS notification permission (macOS) when first
  enabled (set to anything other than `off`).
- **No alerts before an agent's first prompt**: an agent launched with no initial
  prompt sits `waiting` at an empty prompt, but firing an alert there is just
  noise — you launched it, you know it's waiting on you. Suppress both channels
  for a never-prompted agent (per the per-pane `everPrompted` signal) until it has
  been prompted at least once. The agent still shows in the "Needs input" lane;
  only the sound/desktop alert is withheld.
- **Notifications read "Project: Agent" with the latest message as the body**: the
  desktop notification's TITLE is "<Project Name>: <Agent Title>" (the agent
  identified by its generated session title — the same label shown on its card —
  falling back to the workspace/cwd name, and the project prefix dropped when the
  agent has no project), and its BODY is the agent's most recently sent message
  (its pending question, else its last assistant message) on one clipped line. So a
  notification reads title "Acme API: Fix login dialog" / body "Which migration
  strategy should I use?" rather than the old "Agent needs input" / "Session 1 — …".

## Capabilities

### New Capabilities
- `needs-input-alerts`: Sound and/or desktop-notification alerts when an agent
  enters the "Needs input" state, each channel with its own off/app-unfocused/
  agent-unfocused/always mode, edge-triggered once per entry, persisted as a
  settings slice and configured from the Settings modal.

### Modified Capabilities
<!-- None. This capability consumes the existing `needsAttention` predicate
     (agent-status-derivation / agent-roster-display) and the view/focus state
     without changing their requirements. -->

## Impact

- **New frontend modules**: `src/lib/overview/notify.ts` (pure edge-detector +
  per-channel gate), `src/lib/overview/windowFocus.svelte.ts` (OS window focus
  state), `src/lib/overview/alerts.svelte.ts` (reactive shell: side effects),
  `src/lib/settings/notifications.svelte.ts` (settings store + validator).
- **Modified frontend**: `src/lib/overview/Inbox.svelte` (one hook into the
  existing per-second roster effect), `src/lib/ui/SettingsModal.svelte` (two
  mode pickers).
- **New dependency**: `@tauri-apps/plugin-notification` (JS) +
  `tauri-plugin-notification` (Rust), registered in `src-tauri/src/lib.rs`, with
  the `notification:default` permission added to
  `src-tauri/capabilities/default.json`.
- **No changes** to existing status derivation, roster, or inbox-advance
  requirements — those remain the source of "an agent needs you".
