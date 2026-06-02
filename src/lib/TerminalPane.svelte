<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { Terminal, IDisposable } from '@xterm/xterm';
  import type { FitAddon } from '@xterm/addon-fit';
  import type { WebglAddon } from '@xterm/addon-webgl';
  import { Channel, invoke } from '@tauri-apps/api/core';

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
    cwd = null as string | null
  }: {
    paneId: string;
    program?: string;
    args?: string[];
    cwd?: string | null;
  } = $props();

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
   *  zero-size resize down to the PTY. Returns whether a fit ran. */
  function safeFit(): boolean {
    if (!fit || !host) return false;
    if (host.clientWidth === 0 || host.clientHeight === 0) return false;
    fit.fit();
    return true;
  }

  /** Append a subtle inline note (used for `[process exited]`). */
  function note(text: string) {
    // Dim grey, on its own line, without disturbing scrollback semantics.
    term?.write(`\r\n\x1b[2m${text}\x1b[0m\r\n`);
  }

  onMount(() => {
    let disposed = false;

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
      safeFit();

      // WebGL renderer (visible pane). On context loss, dispose WebGL and let
      // xterm fall through to its DOM renderer (we never use @xterm/addon-canvas,
      // which was removed in xterm 6). Guard the whole thing: a machine without a
      // usable WebGL context should degrade to DOM rather than throw.
      try {
        const { WebglAddon } = await import('@xterm/addon-webgl');
        if (disposed || !term) return;
        webgl = new WebglAddon();
        contextLossSub = webgl.onContextLoss(() => {
          webgl?.dispose();
          webgl = undefined;
          // term keeps rendering via the DOM renderer; scrollback is preserved.
        });
        term.loadAddon(webgl);
      } catch {
        // No WebGL available — DOM renderer is already active. Not fatal.
        webgl = undefined;
      }

      // Per-pane output channel. The backend streams PtyEvents here in read order.
      channel = new Channel<PtyEvent>();
      channel.onmessage = (msg) => {
        if (!term) return;
        if (msg.event === 'data') {
          // Raw bytes, verbatim — xterm reassembles split codepoints / escapes.
          term.write(new Uint8Array(msg.bytes));
        } else {
          exited = true;
          note(`[process exited${msg.code !== 0 ? ` (code ${msg.code})` : ''}]`);
        }
      };

      // Spawn the PTY-backed process. Arg name `onEvent` is the camelCase of the
      // Rust param `on_event`; the command name stays verbatim.
      const id = await invoke<number>('pty_spawn', {
        program,
        args,
        cwd,
        cols: term.cols,
        rows: term.rows,
        onEvent: channel
      });
      if (disposed) {
        // Torn down mid-spawn: kill the freshly-spawned child so it isn't orphaned.
        void invoke('pty_kill', { id }).catch(() => {});
        return;
      }
      ptyId = id;

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
