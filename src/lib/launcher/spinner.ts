// PURE helper for the agent-launch spinner overlay. A freshly-spawned (or
// resumed) `claude` pane shows a centered spinner with a "Starting…"/"Resuming…"
// label until the agent is ready, so the user never stares at a blank pane or a
// half-rendered TUI. Kept framework-free (no Svelte/Tauri imports) so the
// readiness rules are unit-tested without a DOM or a live PTY. `TerminalPane`
// constructs a `LaunchSpinner` at mount and mirrors `.loading` into reactive
// state, driving it from the same output/inject/exit events it already handles.

/**
 * Wording for the launch-spinner label. A resumed pane continues a prior
 * transcript ("Resuming…"); a fresh launch or split starts a new one
 * ("Starting…"). An absent flag is a fresh launch.
 */
export function spinnerLabel(resume: boolean | undefined): string {
  return resume ? 'Resuming…' : 'Starting…';
}

/**
 * Tracks whether an agent pane is still in its launch "loading" window — the gap
 * between spawning the PTY and the agent being ready/interactive — during which
 * the spinner overlay is shown.
 *
 * `loading` starts true only for agent panes; shell panes never show the spinner.
 * It clears when:
 *  - the agent has NO initial prompt and the FIRST PTY output arrives (the TUI
 *    has begun rendering — true for a plain new session and for a resumed pane);
 *  - the agent HAS an initial prompt and that prompt is injected (we hold the
 *    spinner through claude's startup output burst so the empty input box never
 *    flashes before the text lands); or
 *  - the child exits before becoming ready (so a process that dies on launch
 *    never spins forever); or
 *  - a readiness-timeout backstop fires (so a promptless pane that spawns but
 *    emits no output and never exits is not hidden by the overlay forever).
 */
export class LaunchSpinner {
  #loading: boolean;
  readonly #hasPrompt: boolean;

  constructor(opts: { isAgent: boolean; hasPrompt: boolean }) {
    this.#loading = opts.isAgent;
    this.#hasPrompt = opts.hasPrompt;
  }

  /** Whether the spinner overlay should currently be shown. */
  get loading(): boolean {
    return this.#loading;
  }

  /** A PTY output byte arrived. Readies a promptless pane; a prompt-bearing pane
   *  waits for {@link onInjected} instead. */
  onOutput(): void {
    if (!this.#hasPrompt) this.#loading = false;
  }

  /** The initial prompt was injected (or forced by the readiness cap). */
  onInjected(): void {
    this.#loading = false;
  }

  /** The child exited before becoming ready. */
  onExit(): void {
    this.#loading = false;
  }

  /** The readiness-timeout backstop elapsed — stop waiting regardless of state,
   *  so a pane that never emits output (and never exits) is not covered forever. */
  onTimeout(): void {
    this.#loading = false;
  }
}
