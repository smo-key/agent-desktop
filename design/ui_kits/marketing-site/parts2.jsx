/* ============================================================================
   parts2.jsx — manager section, steps, CTA, footer
   ============================================================================ */
function ManagerSplit() {
  const feats = [
    'Clear approval requests — the <b>real command</b> and exactly why it needs you.',
    'Three autonomy levels: <b>Supervised</b>, <b>Trusted</b>, and <b>Auto</b>.',
    '<b>Always-allow</b> rules so routine work never interrupts you twice.',
  ];
  return (
    <section className="section section-tight" id="product"><div className="wrap">
      <div className="split">
        <div className="split-txt">
          <div className="sec-eyebrow">Manager, not micromanager</div>
          <h2 className="sec-h">Approve the moves that matter. Ignore the ones that don't.</h2>
          <p className="sec-p">Every agent runs on a leash you choose. When it reaches a destructive
            or costly action, it stops and asks — with the exact command and the reason it needs you.</p>
          <div className="feat-list">
            {feats.map((f, i) => (
              <div className="feat-item" key={i}>
                <div className="ic"><Icon name="check" size={14} /></div>
                <div className="ft" dangerouslySetInnerHTML={{ __html: f }} />
              </div>
            ))}
          </div>
        </div>
        <div className="split-vis">
          <div className="vis-panel"><div className="vis-appr">
            <div className="vis-hd">
              <span className="ic"><Icon name="shield-alert" size={15} /></span>
              <span className="t">Surveyor needs your approval</span>
              <span className="s">AC-118 · paused</span>
            </div>
            <div className="vis-bd">
              <div className="vis-desc">The agent wants to <b>run a database migration</b> against staging.
                This alters live schema and can't be undone automatically.</div>
              <div className="vis-cmd"><span className="c">$ </span>npm run migrate:staging <span className="c">--</span> --to=v3</div>
              <div className="vis-acts">
                <span className="a1"><Icon name="circle-check" size={15} />Approve &amp; continue</span>
                <span className="a2">Deny</span>
              </div>
            </div>
          </div></div>
        </div>
      </div>
    </div></section>
  );
}

function Steps() {
  const steps = [
    { n: '01', icon: 'rocket', h: 'Launch', p: 'Describe the objective, pick a repo, set the autonomy level. Dispatch in seconds.' },
    { n: '02', icon: 'radar', h: 'Oversee', p: 'Watch the fleet from the control room — live status, telemetry, and full activity for every agent.' },
    { n: '03', icon: 'circle-check', h: 'Approve', p: 'Step in only when an agent asks. Approve, deny, or adjust — then it carries on.' },
  ];
  return (
    <section className="section" id="how"><div className="wrap">
      <div className="sec-eyebrow">How it works</div>
      <h2 className="sec-h">From objective to outcome, with you in the loop.</h2>
      <div className="steps">
        {steps.map((s, i) => (
          <div className="step" key={i}>
            <div className="num">{s.n}</div>
            <h3>{s.h}</h3><p>{s.p}</p>
          </div>
        ))}
      </div>
    </div></section>
  );
}

function CTA() {
  return (
    <section className="cta"><div className="wrap"><div className="cta-card">
      <img src={LM} alt="" />
      <h2>Take command of your agents.</h2>
      <p>Launch your first mission in under a minute. Free while we're in early access.</p>
      <div className="hero-cta">
        <a className="btn btn-primary btn-lg" href="#"><Icon name="rocket" size={16} />Get started free</a>
        <a className="btn btn-ghost btn-lg" href="#"><Icon name="book-open" size={16} />Read the docs</a>
      </div>
    </div></div></section>
  );
}

function Footer() {
  const cols = [
    { h: 'Product', links: ['Features', 'Pricing', 'Changelog', 'Download'] },
    { h: 'Company', links: ['About', 'Blog', 'Careers'] },
    { h: 'Resources', links: ['Docs', 'API', 'Status', 'Community'] },
  ];
  return (
    <footer className="footer"><div className="wrap">
      <div className="foot-in">
        <div className="foot-brand">
          <div className="b"><img src={LM} alt="" />Mission Control</div>
          <p>The desktop command center for AI agents. You set the mission; we keep you in control.</p>
        </div>
        <div className="foot-cols">
          {cols.map((c, i) => (
            <div className="foot-col" key={i}>
              <h4>{c.h}</h4>
              {c.links.map((l, j) => <a href="#" key={j}>{l}</a>)}
            </div>
          ))}
        </div>
      </div>
      <div className="foot-bot">
        <span>© 2026 Mission Control</span>
        <span className="made"><span className="d" />All systems nominal</span>
      </div>
    </div></footer>
  );
}

Object.assign(window, { ManagerSplit, Steps, CTA, Footer });
