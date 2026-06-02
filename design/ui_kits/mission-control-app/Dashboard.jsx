/* ============================================================================
   Dashboard.jsx — the whole experience IS the control room.
   Lanes, top→bottom: Needs attention · Completed · In flight. Two-column grid.
   ============================================================================ */
function Lane({ kind, icon, title, items, handlers }) {
  if (!items.length) return null;
  return (
    <section className={'lane ' + kind}>
      <div className="lane-head">
        <span className="lane-ic"><Icon name={icon} size={14} /></span>
        <span className="lane-title">{title}</span>
        <span className="lane-ct">{items.length}</span>
        <span className="lane-line" />
      </div>
      <div className="agrid">
        {items.map(a => <AgentCard key={a.id} agent={a} {...handlers} />)}
      </div>
    </section>
  );
}

function Dashboard({ agents, projName, panelOpen, onTogglePanel, onOpen, onApprove, onDeny, onAnswer, onFeedback, onResolve, onLaunch }) {
  const attn = agents.filter(a => a.lane === 'attn');
  const done = agents.filter(a => a.lane === 'done');
  const flight = agents.filter(a => a.lane === 'flight');
  const handlers = { onOpen, onApprove, onDeny, onAnswer, onFeedback, onResolve };

  return (
    <div className="cr">
      <div className="cr-head"><div className="cr-head-in">
        <button className="cr-toggle" title="Toggle projects" onClick={onTogglePanel}>
          <Icon name={panelOpen ? 'panel-left-close' : 'panel-left'} size={16} />
        </button>
        <div>
          <h1>{projName || 'Control room'}</h1>
        </div>
        <div className="cr-actions">
          <div className="search"><Icon name="search" size={15} /><input placeholder="Search agents…" /></div>
          <button className="btn btn-primary launch-btn" onClick={onLaunch}>
            <Icon name="rocket" size={15} />Launch mission<span className="kbd">⌘N</span>
          </button>
        </div>
      </div></div>

      <div className="lanes">
        <Lane kind="attn" icon="hand" title="Needs attention" items={attn} handlers={handlers} />
        <Lane kind="done" icon="check-check" title="Completed" items={done} handlers={handlers} />
        <Lane kind="flight" icon="radar" title="In flight" items={flight} handlers={handlers} />
      </div>
    </div>
  );
}

Object.assign(window, { Dashboard, Lane });
