// Tracks which project FOLDERS have an in-flight git push/pull, so the footer's
// push/pull buttons can disable while one runs (and a second concurrent trigger
// no-ops). Keyed by the project's absolute folder PATH, so push and pull on the
// same project are mutually exclusive — any in-flight sync disables both buttons.
// Runes singleton, mirroring `projectGit`.

/** Reactive in-flight git-sync tracker, keyed by project folder path. */
export class GitBusyStore {
  /** path -> true while a push/pull runs there. A `$state` record (deep proxy) so
   *  component reads track and writes notify. */
  byPath = $state<Record<string, boolean>>({});

  /** Whether a push/pull is currently in flight for `path`. */
  isBusy(path: string | null | undefined): boolean {
    return !!path && this.byPath[path] === true;
  }

  /** Mark `path` busy (a sync started). */
  begin(path: string): void {
    this.byPath[path] = true;
  }

  /** Clear `path`'s busy flag (the sync finished, success or failure). */
  end(path: string): void {
    delete this.byPath[path];
  }
}

/** Singleton, imported by the git actions (writer) + the footer (reader). */
export const gitBusy = new GitBusyStore();
