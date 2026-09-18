// KEEP-AWAKE driver — the thin edge between the PURE `shouldKeepAwake` policy
// (keepAwake.svelte.ts) and the backend's `keep_awake_set` command. The route
// re-resolves the desired state on every roster tick (~1 Hz); this class turns
// that stream into at most one backend call per TRANSITION, so the platform
// inhibitor (a `caffeinate` child on macOS, a thread-owned execution state on
// Windows) is acquired once when work starts and released once when it ends —
// never re-spawned every second. `release()` is the teardown hook: it releases
// only if currently held. Framework-free so the transition rule is unit-tested.

export class KeepAwakeDriver {
  private held = false;

  /** `apply(enabled)` performs the actual acquire/release (e.g. invokes the backend). */
  constructor(private readonly apply: (enabled: boolean) => void) {}

  /** Whether the inhibitor is currently held (as far as this driver has asked). */
  get isHeld(): boolean {
    return this.held;
  }

  /** Feed the latest desired state; applies only when it differs from the held state. */
  update(desired: boolean): void {
    if (desired === this.held) return;
    this.held = desired;
    this.apply(desired);
  }

  /** Release if held (teardown). */
  release(): void {
    this.update(false);
  }
}
