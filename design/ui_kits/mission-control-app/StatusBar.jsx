/* ============================================================================
   StatusBar.jsx — persistent footer: account usage limits (5h / 7d remaining)
   plus spend + token totals. Scopes to a single agent when one is open.
   ============================================================================ */
function StatusBar({ scope, spend, tokens, limits }) {
  const lim = (k, used) => {
    const pct = Math.round(used * 100);
    const color = used >= 0.85 ? 'var(--abort-500)' : used >= 0.7 ? 'var(--caution-500)' : 'var(--blue-500)';
    return (
      <div className="sb-lim">
        <span className="sb-k">{k}</span>
        <span className="sb-track"><i style={{ width: pct + '%', background: color }} /></span>
        <span className="sb-v">{100 - pct}% left</span>
      </div>
    );
  };
  return (
    <div className="statusbar">
      <span className="sb-section">Usage</span>
      {lim('5h', limits.h5)}
      {lim('7d', limits.d7)}
      <span className="sb-grow" />
      <span className="sb-scope"><Icon name="gauge" size={13} />{scope}</span>
      <span className="sb-stat"><Icon name="circle-dollar-sign" size={13} />{spend}</span>
      <span className="sb-stat"><Icon name="coins" size={13} />{tokens} tokens</span>
    </div>
  );
}

Object.assign(window, { StatusBar });
