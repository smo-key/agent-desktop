<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { Terminal, IDisposable } from '@xterm/xterm';
  import type { FitAddon } from '@xterm/addon-fit';
  import type { WebglAddon } from '@xterm/addon-webgl';
  import { Channel, invoke } from '@tauri-apps/api/core';
  import { registerTerminal, unregisterTerminal } from './layout/terminals';
  import { getUsagePaths } from './usage/paths';
  import { buildSpawnOverride } from './usage/spawn';
  import { InitialInputSender } from './launcher/initialInput';

  // PtyEvent — the exact wire shape the Rust backend streams over the per-pane
  // Channel (internally tagged on `event`):
  //   { event: 'data', bytes: number[] }  -> raw output bytes (write to xterm)
  //   { event: 'exit', code: number }     -> child exited and was reaped
  type PtyEvent =
    | { event: 'data'; bytes: number[] }
    | { event: 'exit'; code: number };

  let {
    /** Stable identity for this pane. Caller keys usage on it (`{#key paneId}`). */
    paneId,
    /** Program to run in the PTY. Defaults to `claude`. */
    program = 'claude',
    /** Arguments passed to the program. */
    args = [] as string[],
    /** Working directory for the child; `null` inherits the app's cwd. */
    cwd = null as string | null,
    /**
     * Whether this pane is the focused/active one. Browsers cap WebGL contexts
     * (~16/page), so we load the WebGL renderer ONLY on the active pane and
     * dispose it on inactive ones (xterm falls through to its DOM renderer,
     * preserving scrollback). See design D5.
     */
    active = true,
    /**
     * While true, `fit()` is deferred (a gutter drag is in progress). When it
     * flips back to false we run one fit to settle the final geometry. This
     * avoids reflow/PTY-resize churn on every drag frame (spec: defer fit to
     * drag-end).
     */
    deferFit = false,
    /**
     * Whether this pane's workspace is currently shown. Hidden workspaces are
     * `display:none` (host is 0×0), so we MUST re-fit when a pane becomes
     * visible again — its container may have changed size while hidden. Default
     * true so single-workspace callers are unaffected. (Spec: re-fit the active
     * workspace panes on switch.)
     */
    visible = true,
    /**
     * OPTIONAL user-supplied initial prompt (session-launcher spec). After the
     * PTY is spawned and the input/output wiring is live, this text is written
     * to the PTY VERBATIM followed by a single carriage return, exactly ONCE
     * (guarded against double-send on re-render via `InitialInputSender`).
     * Empty/undefined sends nothing — `claude` starts at an idle prompt. The app
     * NEVER synthesizes a slash command; a prompt beginning with `/` is passed
     * through verbatim. See src/lib/launcher/initialInput.ts.
     */
    initialInput = undefined as string | undefined
  }: {
    paneId: string;
    program?: string;
    args?: string[];
    cwd?: string | null;
    active?: boolean;
    deferFit?: boolean;
    visible?: boolean;
    initialInput?: string;
  } = $props();

  // Single-shot sender for the optional initial prompt. Constructed in onMount
  // from the LAUNCH-TIME prop value (an initial prompt is delivered once, at
  // spawn — never re-sent on a later prop change); `trySend` is idempotent across
  // re-renders so the prompt is delivered at most once (guard against
  // double-send). The app never synthesizes a command — only the user's text.
  let initialInputSender: InitialInputSender | undefined;

  // The host element xterm renders into.
  let host: HTMLDivElement;

  // Live resources, owned by this component instance. All created in onMount,
  // all released (in order) in onDestroy. Kept as plain (non-reactive) locals so
  // xterm is never constructed/read inside a state-tracking $effect.
  let term: Terminal | undefined;
  let fit: FitAddon | undefined;
  let webgl: WebglAddon | undefined;
  let channel: Channel<PtyEvent> | undefined;
  let ro: ResizeObserver | undefined;
  let onDataSub: IDisposable | undefined;
  let onResizeSub: IDisposable | undefined;
  let contextLossSub: IDisposable | undefined;

  // The backend pane id (u64) for this terminal, resolved by pty_spawn. Distinct
  // from the frontend `paneId` identity prop.
  let ptyId: number | undefined;
  // Reactive: surfaced on the host as `data-exited` for styling/tests.
  let exited = $state(false);
  // True once `term.open()` has run, so the WebGL effect knows the renderer is
  // attachable. Plain local (not state): only read inside async/effect bodies.
  let opened = false;

  // GitHub-ish dark theme. Note: the xterm 6 key is `selectionBackground`
  // (the old `selection` key was removed).
  const THEME = {
    background: '#0d1117',
    foreground: '#c9d1d9',
    cursor: '#58a6ff',
    cursorAccent: '#0d1117',
    selectionBackground: '#284766',
    black: '#484f58',
    red: '#ff7b72',
    green: '#3fb950',
    yellow: '#d29922',
    blue: '#58a6ff',
    magenta: '#bc8cff',
    cyan: '#39c5cf',
    white: '#b1bac4',
    brightBlack: '#6e7681',
    brightRed: '#ffa198',
    brightGreen: '#56d364',
    brightYellow: '#e3b341',
    brightBlue: '#79c0ff',
    brightMagenta: '#d2a8ff',
    brightCyan: '#56d4dd',
    brightWhite: '#f0f6fc'
  };

  /** Guarded fit: skip 0×0 containers (hidden / mid-layout) so we never push a
   *  zero-size resize down to the PTY, and skip entirely while a gutter drag is
   *  in progress (deferFit) — the final fit runs at drag-end. Returns whether a
   *  fit ran. */
  function safeFit(): boolean {
    if (!fit || !host) return false;
    if (deferFit) return false;
    if (host.clientWidth === 0 || host.clientHeight === 0) return false;
    fit.fit();
    return true;
  }

  /** Append a subtle inline note (used for `[process exited]`). */
  function note(text: string) {
    // Dim grey, on its own line, without disturbing scrollback semantics.
    term?.write(`\r\n\x1b[2m${text}\x1b[0m\r\n`);
  }

  // WebGL is loaded lazily and ONLY on the active pane (context cap ~16/page).
  // These two helpers are idempotent so the `active` effect can call them
  // freely. On context loss we dispose and let xterm's DOM renderer take over.
  async function loadWebgl() {
    if (webgl || !term || !opened) return;
    try {
      const { WebglAddon } = await import('@xterm/addon-webgl');
      // The term may have been disposed (or we lost focus) while awaiting.
      if (!term || !opened || webgl) return;
      const addon = new WebglAddon();
      contextLossSub = addon.onContextLoss(() => {
        addon.dispose();
        if (webgl === addon) webgl = undefined;
        // term keeps rendering via the DOM renderer; scrollback is preserved.
      });
      term.loadAddon(addon);
      webgl = addon;
    } catch {
      // No WebGL available — DOM renderer is already active. Not fatal.
      webgl = undefined;
    }
  }

  function disposeWebgl() {
    contextLossSub?.dispose();
    contextLossSub = undefined;
    webgl?.dispose();
    webgl = undefined;
    // xterm transparently falls back to the DOM renderer; scrollback + the live
    // PTY are untouched (we only swap the renderer, never the Terminal).
  }

  onMount(() => {
    let disposed = false;

    // Capture the launch-time initial prompt once (an initial prompt is a
    // spawn-time value; later prop changes must not re-send it).
    initialInputSender = new InitialInputSender(initialInput);

    (async () => {
      // Dynamic-import the heavy/DOM-only modules so SSR + the static build stay
      // clean (these touch `window`/WebGL and must not run at build time).
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit')
      ]);

      // The component may have been torn down while we were awaiting imports.
      if (disposed) return;

      term = new Terminal({
        allowProposedApi: true,
        scrollback: 5000,
        fontFamily:
          'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
        fontSize: 13,
        theme: THEME,
        cursorBlink: true
      });

      fit = new FitAddon();
      term.loadAddon(fit);

      // Open into the DOM *before* loading WebGL — the WebGL addon needs a live
      // renderer/canvas to attach to.
      term.open(host);
      opened = true;
      safeFit();

      // WebGL renderer — loaded ONLY when this pane is active (context cap
      // ~16/page). The reactive `active` effect below keeps this in sync as
      // focus moves; here we just kick off the initial load if we start active.
      // We never use @xterm/addon-canvas (removed in xterm 6); the fallback is
      // xterm's own DOM renderer.
      if (active && !disposed) await loadWebgl();

      // Per-pane output channel. The backend streams PtyEvents here in read order.
      channel = new Channel<PtyEvent>();
      channel.onmessage = (msg) => {
        if (!term) return;
        if (msg.event === 'data') {
          // Raw bytes, verbatim — xterm reassembles split codepoints / escapes.
          term.write(new Uint8Array(msg.bytes));
        } else {
          exited = true;
          // Clear the backend pane id so input/paste/send (and the registered
          // `send` handle) all treat this pane as dead: nothing is written to a
          // PTY that no longer exists, and `send` reports false rather than a
          // false success.
          ptyId = undefined;
          note(`[process exited${msg.code !== 0 ? ` (code ${msg.code})` : ''}]`);
        }
      };

      // Wire `claude` panes THROUGH the statusline wrapper (per-session
      // `--settings` override + AGENT_DESKTOP_PANE/SNAPSHOT_DIR env), leaving the
      // global ~/.claude/settings.json untouched. Shell panes spawn unchanged.
      // `getUsagePaths()` is memoized (one round-trip across all panes) and
      // resolves to null on failure, in which case `claude` spawns unwrapped.
      const usagePaths = program === 'claude' ? await getUsagePaths() : null;
      if (disposed) return;
      const { args: spawnArgs, env: spawnEnv } = buildSpawnOverride({
        program,
        args,
        paneId,
        usagePaths
      });

      // Spawn the PTY-backed process. Arg name `onEvent` is the camelCase of the
      // Rust param `on_event`; the command name stays verbatim. `env` is omitted
      // for shell panes (undefined → backend default empty), set only for claude.
      const id = await invoke<number>('pty_spawn', {
        program,
        args: spawnArgs,
        cwd,
        cols: term.cols,
        rows: term.rows,
        env: spawnEnv,
        onEvent: channel
      });
      if (disposed) {
        // Torn down mid-spawn: kill the freshly-spawned child so it isn't orphaned.
        void invoke('pty_kill', { id }).catch(() => {});
        return;
      }
      ptyId = id;

      // Expose a Copy/Paste handle for the pane context menu (decoupled from the
      // xterm instance). Unregistered in onDestroy.
      registerTerminal(paneId, {
        getSelection: () => term?.getSelection() ?? '',
        hasSelection: () => term?.hasSelection() ?? false,
        paste: (text: string) => {
          if (ptyId === undefined || !text) return;
          void invoke('pty_write', {
            id: ptyId,
            data: Array.from(new TextEncoder().encode(text))
          }).catch(() => {});
        },
        // Message-an-agent (agent-overview): write the EXACT user text plus a
        // single carriage return through the same pty_write path. Sends ONLY the
        // given text — nothing is synthesized on the user's behalf. Returns false
        // when there is no live PTY to write to (the process exited / never wired),
        // so the caller never reports a false success against a dead agent.
        send: (text: string): boolean => {
          if (ptyId === undefined) return false;
          void invoke('pty_write', {
            id: ptyId,
            data: Array.from(new TextEncoder().encode(text + '\r'))
          }).catch(() => {});
          return true;
        }
      });

      // Input: forward raw encoded bytes to the PTY writer.
      const enc = new TextEncoder();
      onDataSub = term.onData((d) => {
        if (ptyId === undefined) return;
        void invoke('pty_write', {
          id: ptyId,
          data: Array.from(enc.encode(d))
        }).catch(() => {});
      });

      // Resize round-trip: xterm computes new cols/rows on fit(); onResize then
      // propagates them to the PTY (SIGWINCH → TUIs reflow).
      onResizeSub = term.onResize(({ cols, rows }) => {
        if (ptyId === undefined) return;
        void invoke('pty_resize', { id: ptyId, cols, rows }).catch(() => {});
      });

      // Drive resizes from the container. Guard 0×0; fit() emits onResize when
      // the geometry actually changed, which is what hits pty_resize.
      ro = new ResizeObserver(() => {
        safeFit();
      });
      ro.observe(host);

      // One more fit now that input/resize wiring is live, in case layout settled
      // during the async spawn.
      safeFit();

      // Deliver the OPTIONAL initial prompt — AFTER the PTY is spawned and the
      // input/output wiring is live — exactly once. The sender encodes the user's
      // text VERBATIM + a single carriage return (never an app-synthesized slash
      // command) and latches so a re-render can't double-send. A no-prompt pane
      // writes nothing, leaving claude at an idle interactive prompt.
      initialInputSender?.trySend((data) => {
        if (ptyId === undefined) return;
        void invoke('pty_write', { id: ptyId, data }).catch(() => {});
      });
    })();

    // onMount's returned cleanup runs synchronously on destroy; we set the flag so
    // any still-pending async setup above bails out. The heavy disposal lives in
    // onDestroy (ordered).
    return () => {
      disposed = true;
    };
  });

  onDestroy(() => {
    // Ordered teardown (per spec): ResizeObserver.disconnect() → webgl.dispose()
    // → term.dispose() → close channel → pty_kill. Leaves no leaked DOM nodes,
    // listeners, or WebGL contexts, and kills the still-running child.
    unregisterTerminal(paneId);

    ro?.disconnect();
    ro = undefined;

    onResizeSub?.dispose();
    onDataSub?.dispose();
    contextLossSub?.dispose();

    webgl?.dispose();
    webgl = undefined;

    term?.dispose();
    term = undefined;

    // Channel<T> has no explicit close in the Tauri API; dropping our reference
    // lets the backend's next send fail, which stops the read loop. Clear it so
    // late messages are ignored.
    if (channel) channel.onmessage = () => {};
    channel = undefined;

    if (ptyId !== undefined) {
      void invoke('pty_kill', { id: ptyId }).catch(() => {});
      ptyId = undefined;
    }
  });

  // Keep the WebGL renderer attached to the active pane only. When this pane
  // becomes active we load WebGL; when it goes inactive we dispose it (freeing a
  // GL context for whatever pane is now focused) and fall back to DOM. Reading
  // `active` makes this effect re-run on focus changes; `opened`/`webgl` are
  // plain locals so they don't (we gate the initial load on `opened` instead).
  $effect(() => {
    // Track `active` reactively.
    const isActive = active;
    if (!opened) return;
    if (isActive) {
      void loadWebgl();
    } else {
      disposeWebgl();
    }
  });

  // When a gutter drag ends (deferFit goes true -> false), run one fit to
  // settle the final geometry and push the resize to the PTY. While deferFit is
  // true, safeFit() is a no-op so nothing churns mid-drag.
  $effect(() => {
    if (!deferFit) {
      safeFit();
    }
  });

  // When this pane becomes visible (its workspace was switched to), the host
  // went from 0×0 (display:none) to its real size. Re-fit on the next frame —
  // after the browser has laid the now-shown element out — so cols/rows and the
  // PTY size match the (possibly changed) viewport. safeFit() guards 0×0, so the
  // hidden->visible transition is the meaningful one. ResizeObserver may not
  // reliably fire on a display toggle, so this explicit re-fit guarantees it.
  $effect(() => {
    if (!visible) return;
    const raf = requestAnimationFrame(() => safeFit());
    return () => cancelAnimationFrame(raf);
  });
</script>

<div class="pane" data-pane-id={paneId} data-exited={exited}>
  <div class="host" bind:this={host}></div>
</div>

<style>
  .pane {
    position: relative;
    width: 100%;
    height: 100%;
    background: #0d1117;
    overflow: hidden;
  }

  .host {
    position: absolute;
    inset: 0;
    /* small breathing room around the grid; xterm fills the rest */
    padding: 4px 6px;
  }

  /* xterm draws its own viewport; keep its internal scrollbar subtle */
  .host :global(.xterm) {
    height: 100%;
  }
  .host :global(.xterm-viewport)::-webkit-scrollbar {
    width: 10px;
  }
  .host :global(.xterm-viewport)::-webkit-scrollbar-thumb {
    background: #30363d;
    border-radius: 5px;
  }
</style>
