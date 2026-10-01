// Coalesced, single-flight runner (performance). Hook events from EVERY agent
// (each tool completion, each turn end) used to start a full transcript-activity
// refresh over all live panes immediately, with no debounce and no guard against
// overlap — so a few busy agents kept several identical refreshes in flight.
//
// `coalescedRunner(fn, windowMs)` returns a `request()` that:
//   - TRAILS: the first request in an idle period schedules one run `windowMs`
//     later; further requests inside that window join it.
//   - Is SINGLE-FLIGHT: a request made while `fn` is running never overlaps it; it
//     marks a follow-up, and exactly one run is scheduled after the current one
//     settles (however many requests arrived meanwhile).
// A rejected run is swallowed (the caller's own error handling stays inside `fn`)
// so a failure never wedges the runner.

export function coalescedRunner(fn: () => Promise<void>, windowMs: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let pending = false;

  const schedule = () => {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, windowMs);
  };

  const run = async () => {
    running = true;
    pending = false;
    try {
      await fn();
    } catch {
      // Swallowed: see the header.
    } finally {
      running = false;
      if (pending) schedule();
    }
  };

  return () => {
    if (running) {
      pending = true;
      return;
    }
    schedule();
  };
}
