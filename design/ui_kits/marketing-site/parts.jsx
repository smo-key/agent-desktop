/* ============================================================================
   parts.jsx — Mission Control marketing site components
   ============================================================================ */
function Icon({ name, size = 18, color, style, className }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const el = ref.current; if (!el) return;
    el.innerHTML = `<i data-lucide="${name}"></i>`;
    if (window.lucide) window.lucide.createIcons({ attrs: { 'stroke-width': 1.75 } });
  }, [name]);
  return <span ref={ref} className={'mc-icon' + (className ? ' ' + className : '')}
               style={{ width: size, height: size, color, ...style }} />;
}
const LM = '../../assets/logomark.svg';

function Nav() {
  return (
    <nav className="nav"><div className="wrap nav-in">
      <a className="nav-brand" href="#top"><img src={LM} alt="" />Mission<span>&nbsp;Control</span></a>
      <div className="nav-links">
        <a href="#product">Product</a><a href="#how">How it works</a>
        <a href="#values">Why</a><a href="#">Pricing</a><a href="#">Docs</a>
      </div>
      <div className="nav-cta">
        <a className="signin" href="#">Sign in</a>
        <a className="btn btn-primary" href="#"><Icon name="rocket" size={16} />Get started</a>
      </div>
    </div></nav>
  );
}

function ProductMock() {
  return (
    <div className="showcase"><div className="mock">
      <div className="mock-bar">
        <span className="l r" /><span className="l y" /><span className="l g" />
        <span className="t">acme · production</span>
      </div>
      <div className="mock-body">
        <div className="mock-side">
          <div className="mock-launch">Launch mission</div>
          <div className="mock-nav on"><Icon name="layout-dashboard" size={14} />Control room</div>
          <div className="mock-nav"><Icon name="shield-question" size={14} />Approvals</div>
          <div className="mock-nav"><Icon name="activity" size={14} />Activity</div>
          <div className="mock-nav"><Icon name="users-round" size={14} />Agents</div>
        </div>
        <div className="mock-main">
          <div className="mock-h">Control room</div>
          <div className="mock-sub">3 agents in flight · 1 awaiting your review</div>
          <div className="mock-grid">
            {[
              { nm: 'Orbiter', cs: 'AC-204', cls: 'live', badge: 'n', bt: 'Running',
                tk: 'Refactoring the <b>auth module</b> into a service layer.', w: 78, c: 'var(--blue-500)' },
              { nm: 'Surveyor', cs: 'AC-118', cls: 'review', badge: 'r', bt: 'Review',
                tk: 'Wants to <b>run a database migration</b> on staging.', w: 100, c: 'var(--orange-500)' },
              { nm: 'Pathfinder', cs: 'AC-077', cls: 'live', badge: 'n', bt: 'Running',
                tk: 'Writing <b>integration tests</b> for checkout.', w: 34, c: 'var(--blue-500)' },
              { nm: 'Relay', cs: 'AC-231', cls: '', badge: 'n', bt: 'Standby',
                tk: 'Standing by on the <b>webhook retries</b> design.', w: 52, c: 'var(--fg-4)' },
            ].map((m, i) => (
              <div className={'mock-card ' + m.cls} key={i}>
                <div className="mc-row">
                  <div className="mc-avt"><img src={LM} alt="" /></div>
                  <div><div className="mc-nm">{m.nm}</div><div className="mc-cs">{m.cs}</div></div>
                  <div className={'mbadge ' + m.badge}>
                    <span className="d" style={{ background: m.badge === 'r' ? 'var(--orange-500)' : 'var(--nominal-500)' }} />{m.bt}
                  </div>
                </div>
                <div className="mc-tk" dangerouslySetInnerHTML={{ __html: m.tk }} />
                <div className="mbar"><i style={{ width: m.w + '%', background: m.c }} /></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div></div>
  );
}

function Hero() {
  return (
    <header className="hero" id="top">
      <div className="wrap">
        <span className="eyebrow"><Icon name="radar" size={14} />Agent operations, simplified</span>
        <h1>Manage your agents.<br /><span className="accent">Don't micromanage them.</span></h1>
        <p>Mission Control is the desktop command center for AI agents. Set the objective,
           watch the work, and approve only what matters — so you stay the manager, never the bottleneck.</p>
        <div className="hero-cta">
          <a className="btn btn-primary btn-lg" href="#"><Icon name="rocket" size={16} />Get started free</a>
          <a className="btn btn-ghost btn-lg" href="#"><Icon name="play" size={16} />Watch a mission</a>
        </div>
        <div className="hero-note">Free while in early access · macOS, Windows &amp; Linux</div>
      </div>
      <ProductMock />
    </header>
  );
}

function Trust() {
  const logos = ['Northwind', 'Heliograph', 'Pier&nbsp;9', 'Verce', 'Lumen Labs'];
  return (
    <div className="trust"><div className="wrap trust-in">
      <span className="trust-label">Trusted by teams shipping with agents</span>
      {logos.map((l, i) => <span className="trust-logo" key={i} dangerouslySetInnerHTML={{ __html: l }} />)}
    </div></div>
  );
}

function Values() {
  const vals = [
    { ic: 'layout-dashboard', h: 'Simplicity',
      p: 'One screen for your whole fleet. No terminal, no tab sprawl — just what each agent is doing and what needs you.' },
    { ic: 'shield-check', h: 'Predictability',
      p: 'Agents pause for approval before anything risky or irreversible. You set the autonomy; nothing happens behind your back.' },
    { ic: 'zap', h: 'Capability',
      p: 'Run many agents at once across repos and environments — with real telemetry, full logs, and one-click handoff.' },
  ];
  return (
    <section className="section" id="values"><div className="wrap">
      <div className="sec-eyebrow">Built on three ideas</div>
      <h2 className="sec-h">Powerful enough to trust. Simple enough to enjoy.</h2>
      <div className="triad">
        {vals.map((v, i) => (
          <div className="value" key={i}>
            <div className="ic"><Icon name={v.ic} size={22} /></div>
            <h3>{v.h}</h3><p>{v.p}</p>
          </div>
        ))}
      </div>
    </div></section>
  );
}

Object.assign(window, { Icon, Nav, Hero, ProductMock, Trust, Values, LM });
