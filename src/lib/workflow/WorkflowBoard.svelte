<script lang="ts">
  // The read-only WORKFLOW board (workflow-board STAGE 2). It is the third
  // top-level surface (alongside the overview + the terminal grid) and describes
  // exactly ONE repo: the active workspace's focused-pane cwd. The store
  // (board.svelte.ts) owns all the logic — detection, the read-only script runs,
  // the lifecycle state, and on-demand refresh; this component is the thin reactive
  // shell that renders the right surface for the current state:
  //
  //   - incapable  -> a clear empty state (the repo ships no /workflow tooling, and
  //                   NO script was run for it).
  //   - error      -> the structured WorkflowError, including the captured stderr
  //                   (e.g. "Jira auth missing in .claude/settings.local.json"),
  //                   NEVER a blank board.
  //   - loaded     -> the next.sh Markdown (safe-rendered) + the epics list as
  //                   read-only cards grouped into To Do / In Progress / Done.
  //
  // It is READ-ONLY BY CONSTRUCTION: there is no control here that mutates anything.
  // The only action is Refresh, which re-runs the same read-only scripts (spec:
  // On-Demand Board Refresh). The board never auto-runs a /workflow:* slash command;
  // closure + transitions stay with the user.
  //
  // The route drives `board.setRepo(focusedCwd)`; this component just reads the
  // store + offers Refresh. The pure pieces (markdown render, status grouping) live
  // in markdown.ts / board-model.ts and are unit-tested; the live script run + the
  // rendered visual are MANUAL.

  import { board } from './board.svelte';
  import { renderMarkdown } from './markdown';
  import { groupByStatus, type BoardEpic, type BoardColumn } from './board-model';

  // The next.sh Markdown rendered to safe HTML (only when present). renderMarkdown
  // escapes all source markup first, so {@html} of its output is safe.
  const nextHtml = $derived(
    board.nextMarkdown !== null ? renderMarkdown(board.nextMarkdown) : null
  );

  // The epics list grouped into the three canonical status columns (read-only
  // cards). Epics are BoardEpic ({key, summary, status}); we lift them into the
  // BoardIssue-shaped grouping (type/epic null) so the same pure grouper applies.
  const epicColumns = $derived.by<BoardColumn[]>(() =>
    groupByStatus(
      board.epics.map((e: BoardEpic) => ({
        key: e.key,
        summary: e.summary,
        status: e.status,
        type: 'Epic' as const,
        epic: null
      }))
    )
  );

  // A short, human label for the repo (last path segment) for the header.
  const repoLabel = $derived.by(() => {
    const r = board.repo;
    if (!r) return '';
    const parts = r.replace(/\/+$/, '').split('/');
    return parts[parts.length - 1] || r;
  });

  function refresh() {
    void board.refresh();
  }
</script>

<section class="workflow">
  <header class="head">
    <div class="head-text">
      <span class="head-title">Workflow</span>
      {#if board.repo}
        <span class="head-repo" title={board.repo}>{repoLabel}</span>
      {/if}
    </div>
    <button
      type="button"
      class="refresh"
      onclick={refresh}
      disabled={board.repo === null || board.isBusy}
      title="Re-run the read-only workflow scripts (next.sh, epics list)"
    >
      {board.isBusy ? 'Refreshing…' : 'Refresh'}
    </button>
  </header>

  <div class="body">
    {#if board.repo === null || board.status === 'idle'}
      <!-- No repo subject yet (store unseeded). -->
      <div class="empty">
        <p class="empty-title">No repository focused</p>
        <p class="empty-sub">
          Focus a pane in a workflow-capable repo to see its board.
        </p>
      </div>
    {:else if board.status === 'detecting'}
      <div class="empty"><p class="empty-sub">Checking for workflow tooling…</p></div>
    {:else if board.status === 'incapable'}
      <!-- Capability detection said this repo has no /workflow tooling. NO script
           was run for it (spec: "shows no board"). Clear empty state. -->
      <div class="empty">
        <p class="empty-title">No workflow board for this repo</p>
        <p class="empty-sub">
          <span class="mono">{repoLabel}</span> has no
          <span class="mono">.claude/commands/workflow</span> or
          <span class="mono">.claude/skills/workflow</span> directory, so there is
          nothing to show. Open this board on a repo that ships the workflow skill
          (e.g. its <span class="mono">next.sh</span> / <span class="mono"
            >epics.sh</span
          >
          / <span class="mono">issues.sh</span>).
        </p>
      </div>
    {:else if board.status === 'error' && board.error}
      <!-- A script exited nonzero / produced bad output. Surface the structured
           error (with captured stderr) — NOT a blank board. -->
      <div class="error" role="alert">
        <p class="error-title">Could not load the workflow board</p>
        <p class="error-message">{board.error.message}</p>
        {#if board.error.kind === 'script-failed'}
          <p class="error-hint">
            The repo's workflow script exited
            {#if board.error.exitCode != null}with code {board.error.exitCode}{/if}.
            This is usually Jira auth: check
            <span class="mono">{repoLabel}/.claude/settings.local.json</span> and the
            <span class="mono">JIRA_USER_EMAIL</span> /
            <span class="mono">JIRA_API_TOKEN</span> values.
          </p>
        {/if}
        {#if board.error.stderr}
          <pre class="error-stderr">{board.error.stderr}</pre>
        {/if}
        <p class="error-meta">
          <span class="mono">{board.error.kind}</span>
          {#if board.error.exitCode != null}· exit {board.error.exitCode}{/if}
        </p>
      </div>
    {:else}
      <!-- Loaded (or loading a refresh while prior data is still shown). -->
      {#if board.status === 'loading' && !board.hasData}
        <div class="empty"><p class="empty-sub">Running workflow scripts…</p></div>
      {/if}

      {#if nextHtml !== null}
        <article class="next">
          <!-- Safe: renderMarkdown escapes all source markup before emitting a
               fixed set of tags; it is the only producer of this HTML. -->
          <!-- eslint-disable-next-line svelte/no-at-html-tags -->
          {@html nextHtml}
        </article>
      {/if}

      {#if board.epics.length > 0}
        <section class="epics">
          <h2 class="epics-title">Epics</h2>
          <div class="columns">
            {#each epicColumns as col (col.id)}
              <div class="column">
                <div class="column-head">
                  <span class="column-label">{col.label}</span>
                  <span class="column-count">{col.issues.length}</span>
                </div>
                <div class="cards">
                  {#each col.issues as card (card.key)}
                    <div class="card">
                      <div class="card-key">{card.key}</div>
                      <div class="card-summary">{card.summary}</div>
                      <div class="card-status">{card.status}</div>
                    </div>
                  {:else}
                    <div class="card-empty">—</div>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        </section>
      {/if}

      {#if nextHtml === null && board.epics.length === 0 && board.status === 'loaded'}
        <div class="empty">
          <p class="empty-sub">The workflow scripts returned no items.</p>
        </div>
      {/if}
    {/if}
  </div>
</section>

<style>
  .workflow {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: #0d1117;
    color: #e6edf3;
    overflow: hidden;
  }

  .head {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 20px;
    border-bottom: 1px solid #21262d;
    background: #0d1117;
  }
  .head-text {
    display: flex;
    align-items: baseline;
    gap: 10px;
    min-width: 0;
  }
  .head-title {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .head-repo {
    font-size: 12px;
    color: #6e7681;
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .refresh {
    margin-left: auto;
    height: 26px;
    padding: 0 14px;
    border: 1px solid #30363d;
    border-radius: 6px;
    background: #161b22;
    color: #adbac7;
    font-size: 12px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition:
      background 0.12s ease,
      color 0.12s ease,
      border-color 0.12s ease;
  }
  .refresh:hover:not(:disabled) {
    background: #1c2128;
    color: #e6edf3;
    border-color: #58a6ff;
  }
  .refresh:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: 20px;
  }

  /* Empty / informational states. */
  .empty {
    max-width: 640px;
    margin: 48px auto;
    text-align: center;
    color: #6e7681;
  }
  .empty-title {
    font-size: 15px;
    font-weight: 600;
    color: #adbac7;
    margin: 0 0 8px;
  }
  .empty-sub {
    font-size: 13px;
    line-height: 1.6;
    margin: 0;
  }

  /* Structured error surface. */
  .error {
    max-width: 760px;
    margin: 24px auto;
    border: 1px solid #5c2c2c;
    border-radius: 8px;
    background: #1d1414;
    padding: 16px 18px;
  }
  .error-title {
    font-size: 14px;
    font-weight: 700;
    color: #ff7b72;
    margin: 0 0 6px;
  }
  .error-message {
    font-size: 13px;
    color: #e6edf3;
    margin: 0 0 10px;
  }
  .error-hint {
    font-size: 12.5px;
    line-height: 1.6;
    color: #adbac7;
    margin: 0 0 10px;
  }
  .error-stderr {
    margin: 0 0 10px;
    padding: 10px 12px;
    border-radius: 6px;
    background: #0d1117;
    border: 1px solid #30363d;
    color: #ffa198;
    font-size: 12px;
    line-height: 1.5;
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 240px;
    overflow: auto;
  }
  .error-meta {
    font-size: 11px;
    color: #6e7681;
    margin: 0;
  }

  .mono {
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 0.92em;
    color: #adbac7;
  }

  /* The next.sh markdown view. The rendered tags come from renderMarkdown only. */
  .next {
    max-width: 980px;
    margin: 0 auto 28px;
    font-size: 13.5px;
    line-height: 1.6;
  }
  .next :global(h1) {
    font-size: 20px;
    font-weight: 700;
    margin: 0 0 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid #21262d;
  }
  .next :global(h2) {
    font-size: 16px;
    font-weight: 700;
    margin: 22px 0 10px;
    color: #e6edf3;
  }
  .next :global(h3) {
    font-size: 14px;
    font-weight: 600;
    margin: 18px 0 8px;
    color: #adbac7;
  }
  .next :global(p) {
    margin: 0 0 10px;
    color: #c9d1d9;
  }
  .next :global(ul) {
    margin: 0 0 10px;
    padding-left: 22px;
    color: #c9d1d9;
  }
  .next :global(li) {
    margin: 2px 0;
  }
  .next :global(a) {
    color: #58a6ff;
    text-decoration: none;
  }
  .next :global(a:hover) {
    text-decoration: underline;
  }
  .next :global(code) {
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 0.9em;
    background: #161b22;
    border: 1px solid #21262d;
    border-radius: 4px;
    padding: 1px 5px;
  }
  .next :global(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 0 0 16px;
    font-size: 13px;
  }
  .next :global(th) {
    text-align: left;
    font-weight: 600;
    color: #adbac7;
    padding: 7px 10px;
    border-bottom: 1px solid #30363d;
    background: #161b22;
  }
  .next :global(td) {
    padding: 7px 10px;
    border-bottom: 1px solid #21262d;
    color: #c9d1d9;
    vertical-align: top;
  }
  .next :global(tr:last-child td) {
    border-bottom: none;
  }
  .next :global(strong) {
    color: #e6edf3;
    font-weight: 700;
  }

  /* Epics: read-only cards grouped into status columns. */
  .epics {
    max-width: 1100px;
    margin: 0 auto;
  }
  .epics-title {
    font-size: 16px;
    font-weight: 700;
    margin: 0 0 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid #21262d;
  }
  .columns {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 14px;
  }
  .column {
    background: #0d1117;
    border: 1px solid #21262d;
    border-radius: 8px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .column-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 9px 12px;
    background: #161b22;
    border-bottom: 1px solid #21262d;
  }
  .column-label {
    font-size: 12px;
    font-weight: 700;
    color: #adbac7;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .column-count {
    font-size: 11px;
    font-weight: 600;
    color: #6e7681;
    background: #0d1117;
    border: 1px solid #21262d;
    border-radius: 10px;
    min-width: 20px;
    text-align: center;
    padding: 1px 6px;
  }
  .cards {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    min-height: 40px;
  }
  .card {
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 6px;
    padding: 9px 11px;
  }
  .card-key {
    font-size: 11px;
    font-weight: 700;
    color: #58a6ff;
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  }
  .card-summary {
    font-size: 13px;
    color: #e6edf3;
    margin: 3px 0 5px;
    line-height: 1.4;
  }
  .card-status {
    font-size: 11px;
    color: #6e7681;
  }
  .card-empty {
    color: #30363d;
    font-size: 13px;
    text-align: center;
    padding: 6px 0;
  }
</style>
