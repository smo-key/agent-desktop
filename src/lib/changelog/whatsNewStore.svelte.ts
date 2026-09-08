// Reactive store for the "What's new" (release notes) modal.
//
// Two entry points:
//   - `maybeShowOnLaunch(settings)` — called once from +page.svelte's onMount with
//     the already-loaded settings object. Opens the dialog the first time the app
//     runs a version the user has not seen, recording it in the `whatsNew`
//     settings slice (settings.json, merge-saved — NOT localStorage).
//   - `show()` — the Settings version button; reopens the running version's notes
//     any time (a dev build shows the newest section under its own version).
//
// The changelog text and running version are injected so the singleton can be
// built from the real bundle while tests construct their own.

import { saveSettingsSlice } from '$lib/settings/persist';
import { newestSection, parseNotes, sectionFor } from './section.mjs';
import { changelog, runningVersion } from './releaseNotes';

/** One `### heading` group of bullet items (each item a list of inline runs). */
export type NoteGroup = ReturnType<typeof parseNotes>[number];
export type NoteRun = NoteGroup['items'][number][number];

/** What the store needs to know about the build it runs in. */
export interface WhatsNewSource {
  /** The running version (`package.json`); ignored when `dev`. */
  version: string;
  /** True under a dev server: never auto-open, show the newest section. */
  dev: boolean;
  /** The full CHANGELOG.md text. */
  changelog: string;
}

/** The persisted `whatsNew` settings slice. */
export interface WhatsNewPrefs {
  seenVersion: string;
}

/** PURE: the `seenVersion` out of a persisted slice of any shape, or `''`. */
export function parseSeenVersion(raw: unknown): string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return '';
  const v = (raw as Record<string, unknown>).seenVersion;
  return typeof v === 'string' ? v : '';
}

export class WhatsNewStore {
  /** Whether the modal is shown. */
  open = $state(false);
  /** The version whose notes are loaded (the newest section's under dev). */
  version = $state('');
  /** The parsed notes; empty when the version has no section. */
  groups = $state<NoteGroup[]>([]);

  constructor(private readonly src: WhatsNewSource) {}

  /** Resolve `{ version, body }` for the running build. */
  private resolve(): { version: string; body: string } {
    if (this.src.dev) {
      return newestSection(this.src.changelog) ?? { version: 'dev', body: '' };
    }
    return { version: this.src.version, body: sectionFor(this.src.changelog, this.src.version) };
  }

  /** Load the running version's notes and open the modal. Idempotent. */
  show(): void {
    const { version, body } = this.resolve();
    this.version = version;
    this.groups = parseNotes(body);
    this.open = true;
  }

  /** Hide the modal. Idempotent. */
  close(): void {
    this.open = false;
  }

  /**
   * The once-per-version launch check. `settings` is the loaded settings.json
   * object. Returns true when the dialog was opened.
   *
   *   1. dev build → nothing (no release version to compare).
   *   2. seenVersion === running → nothing.
   *   3. no seenVersion AND settings is empty → fresh install: record silently
   *      (onboarding is on screen; there was no update to announce).
   *   4. else record the running version and open IF it has notes.
   */
  async maybeShowOnLaunch(settings: Record<string, unknown>): Promise<boolean> {
    if (this.src.dev) return false;
    const { version, body } = this.resolve();
    if (!version) return false;
    const seen = parseSeenVersion(settings.whatsNew);
    if (seen === version) return false;
    const freshInstall = !seen && Object.keys(settings).length === 0;
    const prefs: WhatsNewPrefs = { seenVersion: version };
    await saveSettingsSlice('whatsNew', prefs);
    if (freshInstall || !body) return false;
    this.version = version;
    this.groups = parseNotes(body);
    this.open = true;
    return true;
  }
}

/** The singleton, built from the bundled changelog + the running version. */
export const whatsNew = new WhatsNewStore({ ...runningVersion(), changelog });
