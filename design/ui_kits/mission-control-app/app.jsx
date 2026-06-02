/* ============================================================================
   app.jsx — Mission Control: a project-filtered control room.
   Agents are identified by purpose (verb + ticket + feature), not names.
   ============================================================================ */
const { useState } = React;

const PROJECTS = MC_PROJECTS; /* defined in ui.jsx — id, name, repo, icon, color */

/* lane: 'attn' (needs you) · 'done' · 'flight' ; ask (attn only) */
const SEED = [
  /* ---------- NEEDS ATTENTION ---------- */
  {
    id: 'a1', project: 'payments', ticket: 'PAY-118', summary: 'Migrate soft-delete column',
    lane: 'attn', status: 'review',
    lastMessage: 'I\u2019ve written migration <b>0042</b> to add a nullable <code>deleted_at</code> column to 3 tables. It\u2019s backwards-compatible, but it touches a shared environment — I need your go-ahead before I run it.',
    ask: { kind: 'approval', command: 'npm run migrate:staging -- --to=v3' },
    approval: { summary: 'wants to run a database migration against <b>staging</b>. This alters live schema and can\u2019t be undone automatically.', command: 'npm run migrate:staging -- --to=v3' },
    progress: 100, branch: 'migrate-v3', runtime: '00:18', tokens: '12.7k', repo: 'acme/payments-api',
    autonomy: 'Supervised', steps: 19, cost: '$0.22',
    objective: 'Add a nullable <code>deleted_at</code> column to support soft-deletes, then migrate staging.',
    short: 'Add soft-delete column',
    files: [{ path: 'migrations/0042_soft_delete.sql', add: 14, del: 0 }, { path: 'src/models/base.ts', add: 9, del: 2 }],
    timeline: [
      { time: '15:31:10', type: 'thought', title: 'Drafted the migration', body: 'Adds <code>deleted_at TIMESTAMP NULL</code> to 3 tables.' },
      { time: '15:36:02', type: 'approval', title: 'Paused — <b>needs your approval</b> to migrate staging' },
    ],
  },
  {
    id: 'a2', project: 'storefront', ticket: 'SHOP-77', summary: 'Test the checkout flow',
    lane: 'attn', status: 'review',
    lastMessage: 'The failed-payment path can hit the real Stripe sandbox or a stub. How do you want the test to run?',
    ask: { kind: 'question', options: ['Mock the Stripe sandbox (faster)', 'Keep the live sandbox call (true end-to-end)'] },
    progress: 34, branch: 'checkout-tests', runtime: '00:09', tokens: '6.1k', repo: 'acme/storefront',
    autonomy: 'Trusted', steps: 8, cost: '$0.11',
    objective: 'Cover the <b>checkout flow</b> with integration tests, including the failed-payment path.',
    short: 'Test checkout flow',
    files: [{ path: 'test/checkout.int.spec.ts', add: 62, del: 0 }],
    timeline: [
      { time: '15:48:22', type: 'thought', title: 'Mapping the checkout states', body: 'Cart \u2192 address \u2192 payment \u2192 confirm.' },
      { time: '15:55:40', type: 'thought', title: 'Paused with a question about the payment stub' },
    ],
  },
  {
    id: 'a3', project: 'web', ticket: 'WEB-160', summary: 'Write the onboarding emails',
    lane: 'attn', status: 'review',
    lastMessage: 'Three emails: a welcome, a first-mission nudge, and a week-one check-in. I kept the tone calm and direct to match the brand. Want to review before I wire them into the flow?',
    ask: { kind: 'review' },
    progress: 90, branch: 'onboarding-copy', runtime: '00:21', tokens: '15.3k', repo: 'acme/web',
    autonomy: 'Trusted', steps: 22, cost: '$0.26',
    objective: 'Write a 3-email <b>onboarding sequence</b> for new accounts, on-brand and concise.',
    short: 'Onboarding emails',
    files: [{ path: 'emails/onboarding/welcome.mdx', add: 38, del: 0 }, { path: 'emails/onboarding/nudge.mdx', add: 31, del: 0 }],
    timeline: [
      { time: '15:12:03', type: 'edit', title: 'Drafted three emails', file: 'emails/onboarding/welcome.mdx' },
      { time: '15:33:18', type: 'thought', title: 'Paused for your review of the tone' },
    ],
  },

  {
    id: 'a9', project: 'web', ticket: 'WEB-205', summary: 'Rewrite the pricing page',
    lane: 'attn', status: 'review',
    lastMessage: 'Finished the new pricing page — rewrote the three tiers and added a comparison table. Give it a read and publish when you\u2019re happy.',
    ask: { kind: 'handoff', cta: 'Approve & publish', files: [{ path: 'web/pricing/page.mdx' }, { path: 'web/pricing/comparison.mdx' }] },
    progress: 100, branch: 'pricing-copy', runtime: '00:16', tokens: '11.2k', repo: 'acme/web',
    autonomy: 'Auto', steps: 21, cost: '$0.19',
    objective: 'Rewrite the <b>pricing page</b> copy and add a plan comparison table.',
    short: 'Pricing page copy',
    files: [{ path: 'web/pricing/page.mdx', add: 96, del: 71 }, { path: 'web/pricing/comparison.mdx', add: 58, del: 0 }],
    timeline: [
      { time: '14:40:02', type: 'edit', title: 'Rewrote the pricing tiers', file: 'web/pricing/page.mdx' },
      { time: '14:55:18', type: 'complete', title: 'Done — <b>handed off for your review</b>' },
    ],
  },
  {
    id: 'a10', project: 'infra', ticket: 'INF-210', summary: 'Rotate production API keys',
    lane: 'attn', status: 'review',
    lastMessage: 'I\u2019ve generated the replacement keys, but rotating production secrets needs a human. Once you\u2019ve swapped them in the console, I\u2019ll verify the services reconnect.',
    ask: { kind: 'handoff', cta: 'I\u2019ve done it', action: 'Rotate the production API key in the cloud console, then mark this done.' },
    progress: 100, branch: 'key-rotation', runtime: '00:08', tokens: '4.8k', repo: 'acme/infra',
    autonomy: 'Auto', steps: 6, cost: '$0.07',
    objective: 'Prepare a <b>production API key rotation</b> and hand off the manual step.',
    short: 'Prod key rotation',
    files: [{ path: 'infra/keys/ROTATION.md', add: 24, del: 0 }],
    timeline: [
      { time: '16:01:11', type: 'edit', title: 'Generated replacement keys + runbook', file: 'infra/keys/ROTATION.md' },
      { time: '16:03:40', type: 'complete', title: 'Paused — <b>needs a human action</b>' },
    ],
  },

  /* ---------- COMPLETED ---------- */
  {
    id: 'a4', project: 'docs', ticket: 'DOC-52', summary: 'Update the API reference',
    lane: 'done', status: 'done',
    lastMessage: 'Done — regenerated the reference from the OpenAPI spec, fixed 12 broken examples, and merged the PR. All checks green.',
    tasks: { total: 5, done: 5 },
    progress: 100, branch: 'api-docs', runtime: '00:31', tokens: '18.9k', repo: 'acme/docs',
    autonomy: 'Auto', steps: 33, cost: '$0.29',
    objective: 'Regenerate the <b>API reference</b> from the OpenAPI spec and fix broken examples.',
    short: 'Update API docs',
    files: [{ path: 'docs/api/reference.mdx', add: 240, del: 188 }],
    timeline: [
      { time: '11:02:00', type: 'command', title: 'Regenerated reference from spec' },
      { time: '11:28:51', type: 'complete', title: 'Mission complete', body: 'Docs rebuilt, 12 examples fixed, PR merged.' },
    ],
  },
  {
    id: 'a5', project: 'payments', ticket: 'PAY-33', summary: 'Add API rate limiting',
    lane: 'done', status: 'done',
    lastMessage: 'Shipped. 100 req/min per key with clean 429s and a Retry-After header. Added tests and updated the docs.',
    tasks: { total: 6, done: 6 },
    progress: 100, branch: 'rate-limit', runtime: '00:24', tokens: '16.0k', repo: 'acme/payments-api',
    autonomy: 'Trusted', steps: 26, cost: '$0.25',
    objective: 'Add per-key <b>rate limiting</b> to the public API with proper 429 responses.',
    short: 'API rate limiting',
    files: [{ path: 'src/middleware/rateLimit.ts', add: 88, del: 0 }, { path: 'test/rateLimit.spec.ts', add: 54, del: 0 }],
    timeline: [
      { time: '09:40:11', type: 'edit', title: 'Implemented the limiter middleware', file: 'src/middleware/rateLimit.ts' },
      { time: '10:04:33', type: 'complete', title: 'Mission complete', body: 'Tests pass, docs updated, PR merged.' },
    ],
  },

  /* ---------- IN FLIGHT ---------- */
  {
    id: 'a6', project: 'payments', ticket: 'PAY-204', summary: 'Refactor the auth module',
    lane: 'flight', status: 'nominal',
    lastMessage: 'Extracted token issue / verify / refresh into <b>TokenService</b>. Auth suite is green (18 passing). Moving on to refresh-token rotation.',
    tasks: { total: 18, done: 14 },
    progress: 78, branch: 'auth-refactor', runtime: '00:42', tokens: '38.2k', repo: 'acme/payments-api',
    autonomy: 'Supervised', steps: 47, cost: '$0.61',
    objective: 'Refactor the <b>auth module</b>: extract token handling into a dedicated service, add coverage, keep the public API stable.',
    short: 'Refactor auth module',
    files: [
      { path: 'src/auth/token.service.ts', add: 184, del: 0 }, { path: 'src/auth/session.ts', add: 22, del: 96 },
      { path: 'src/auth/index.ts', add: 8, del: 4 }, { path: 'test/auth/token.spec.ts', add: 131, del: 0 },
    ],
    timeline: [
      { time: '14:02:11', type: 'thought', title: 'Planned the refactor', body: 'Route 3 call sites through a new <b>TokenService</b>.' },
      { time: '14:08:55', type: 'edit', title: 'Created <b>token.service.ts</b>', file: 'src/auth/token.service.ts' },
      { time: '14:19:02', type: 'command', title: 'Ran the auth test suite', code: '<span class="c">$</span> npm test -- auth\n<span class="add">  \u2713 18 passing</span>  <span class="c">(2.1s)</span>' },
      { time: '14:24:31', type: 'step', title: 'Step complete — <b>14 / 18</b> tasks done' },
    ],
  },
  {
    id: 'a7', project: 'infra', ticket: 'INF-198', summary: 'Fix the flaky deploy job',
    lane: 'flight', status: 'active',
    lastMessage: 'Reproduced the failure locally — looks like a race in the cache warm-up step. Narrowing down which service starts too early.',
    progress: 40, branch: 'fix-deploy-flake', runtime: '00:12', tokens: '9.4k', repo: 'acme/infra',
    autonomy: 'Trusted', steps: 11, cost: '$0.14',
    objective: 'Find and fix the intermittent failure in the <b>deploy job</b>.',
    short: 'Fix flaky deploy',
    files: [{ path: '.ci/deploy.yml', add: 4, del: 1 }],
    timeline: [
      { time: '15:50:09', type: 'command', title: 'Re-ran the job 8 times to reproduce' },
      { time: '15:58:44', type: 'thought', title: 'Suspecting a cache warm-up race' },
    ],
  },
  {
    id: 'a8', project: 'payments', ticket: 'PAY-231', summary: 'Add webhook retries',
    lane: 'flight', status: 'nominal',
    lastMessage: 'Backoff scheduler is in. Now adding the dead-letter queue for payloads that fail every retry.',
    tasks: { total: 8, done: 5 },
    progress: 60, branch: 'webhook-retry', runtime: '00:27', tokens: '21.4k', repo: 'acme/payments-api',
    autonomy: 'Supervised', steps: 28, cost: '$0.34',
    objective: 'Add exponential-backoff <b>retries</b> to outbound webhooks with a dead-letter queue.',
    short: 'Webhook retries',
    files: [{ path: 'src/webhooks/retry.ts', add: 71, del: 12 }],
    timeline: [
      { time: '13:10:44', type: 'step', title: 'Implemented backoff scheduler' },
      { time: '15:40:20', type: 'edit', title: 'Building the dead-letter queue', file: 'src/webhooks/retry.ts' },
    ],
  },
];

/* ----------------------------------------------------------------- app */
function App() {
  const [agents, setAgents] = useState(SEED);
  const [view, setView] = useState('control');
  const [selectedId, setSelectedId] = useState(null);
  const [launching, setLaunching] = useState(false);
  const [project, setProject] = useState('all');
  const [panelOpen, setPanelOpen] = useState(true);
  const [, forceProj] = useState(0);

  const createProject = (name, select, icon, color) => {
    const p = addProject(name, icon, color);
    forceProj(v => v + 1);
    if (select) setProject(p.id);
    return p;
  };

  const selected = agents.find(a => a.id === selectedId);
  const patch = (id, p) => setAgents(as => as.map(a => a.id === id ? { ...a, ...p } : a));

  const open = id => { setSelectedId(id); setView('detail'); };
  const back = () => { setView('control'); setSelectedId(null); };

  const toFlight = (id, lastMessage) =>
    patch(id, { lane: 'flight', status: 'active', ask: null, approval: null, lastMessage });

  const approve = id => toFlight(id, 'Approved — running the migration now. I\u2019ll report back when it\u2019s applied.');
  const deny = id => toFlight(id, 'Understood — I\u2019ll skip that and keep going without it.');
  const answer = (id, text, isOption) => toFlight(id, isOption
    ? 'Going with \u201c' + text + '\u201d. Continuing.'
    : 'Thanks — that\u2019s what I needed. Continuing now.');
  const feedback = (id, kind) => toFlight(id, kind === 'ok'
    ? 'Great — wiring the emails into the onboarding flow now.'
    : 'On it — I\u2019ll revise the tone and send you the updated drafts shortly.');

  const pause = id => patch(id, { status: 'standby' });
  const resume = id => patch(id, { status: 'active' });
  const abort = id => patch(id, { status: 'abort', lastMessage: 'Aborted by flight director.' });
  const resolve = id => toFlight(id, 'Thanks for the review — back to work, I’ll keep going from here.');

  /* Cmd/Ctrl+N → launch a mission */
  React.useEffect(() => {
    const onKey = e => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        setLaunching(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const launch = ({ objective, project: proj }) => {
    const n = agents.length;
    const pj = PROJECTS.find(p => p.id === proj) || PROJECTS[0];
    const feat = objective.length > 38 ? objective.slice(0, 38).trim() + '…' : objective;
    const a = {
      id: 'new' + n, project: pj.id, ticket: null, summary: feat,
      lane: 'flight', status: 'active', progress: 4,
      lastMessage: 'Mission received — reviewing the objective and planning an approach.',
      ask: null, branch: 'mission-' + (40 + n), runtime: '00:00', tokens: '0.2k',
      repo: pj.repo, steps: 1, cost: '$0.00', objective,
      short: objective.length > 26 ? objective.slice(0, 26) + '…' : objective, files: [],
      timeline: [{ time: 'now', type: 'thought', title: 'Mission received', body: 'Planning an approach.' }],
    };
    setAgents(as => [a, ...as]);
    setLaunching(false);
    open(a.id);
  };

  /* project list with live counts + attention flags */
  const projects = PROJECTS.map(p => {
    const mine = agents.filter(a => a.project === p.id);
    return { ...p, count: mine.length, attn: mine.some(a => a.lane === 'attn') };
  });

  const visible = project === 'all' ? agents : agents.filter(a => a.project === project);
  const projName = project === 'all' ? null : (PROJECTS.find(p => p.id === project) || {}).name;

  /* usage totals for the status bar */
  const LIMITS = { h5: 0.41, d7: 0.68 };
  const parseCost = c => parseFloat(String(c || '').replace(/[^0-9.]/g, '')) || 0;
  const parseTok = t => { const s = String(t || ''); const v = parseFloat(s) || 0; return /k/i.test(s) ? v * 1000 : v; };
  const fmtTok = n => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n));
  const inDetail = view === 'detail' && selected;
  const sbScope = inDetail ? (selected.ticket || selected.summary) : 'Fleet · today';
  const sbSpend = '$' + (inDetail ? parseCost(selected.cost) : agents.reduce((s, a) => s + parseCost(a.cost), 0)).toFixed(2);
  const sbTok = fmtTok(inDetail ? parseTok(selected.tokens) : agents.reduce((s, a) => s + parseTok(a.tokens), 0));

  return (
    <div className="win">
      <div className="titlebar">
        <div className="lights"><span className="light r" /><span className="light y" /><span className="light g" /></div>
        <div className="tb-title"><img src="../../assets/logomark.svg" alt="" />Mission Control</div>
        <div style={{ width: 52 }} />
      </div>
      <div className="body">
        {panelOpen && (
          <ProjectPanel projects={projects} selected={project} total={agents.length}
            onSelect={setProject} onClose={() => setPanelOpen(false)} onCreate={createProject} />
        )}
        <div className="main">
          {view === 'detail' && selected ? (
            <React.Fragment>
              <div className="backbar">
                <a onClick={back}><Icon name="arrow-left" size={15} />Control room</a>
                <Icon name="chevron-right" size={14} style={{ color: 'var(--fg-4)' }} />
                <span className="cur">{(selected.ticket ? selected.ticket + ': ' : '') + selected.summary}</span>
              </div>
              <div className="content" style={{ display: 'flex', flexDirection: 'column' }}>
                <MissionDetail mission={selected} onApprove={approve} onDeny={deny}
                  onPause={pause} onResume={resume} onAbort={abort} />
              </div>
            </React.Fragment>
          ) : (
            <Dashboard agents={visible} projName={projName} panelOpen={panelOpen}
              onTogglePanel={() => setPanelOpen(o => !o)} onOpen={open} onApprove={approve}
              onDeny={deny} onAnswer={answer} onFeedback={feedback} onResolve={resolve} onLaunch={() => setLaunching(true)} />
          )}
          <StatusBar scope={sbScope} spend={sbSpend} tokens={sbTok} limits={LIMITS} />
        </div>
      </div>
      {launching && <LaunchModal projects={PROJECTS} onClose={() => setLaunching(false)} onLaunch={launch} onCreate={createProject} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
