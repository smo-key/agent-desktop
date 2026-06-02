/* ============================================================================
   MissionDetail.jsx — drill into one agent. The main area is a live terminal to
   the agent (placeholder for now); a rail carries mission info + telemetry.
   ============================================================================ */
function MissionDetail({ mission, onApprove, onDeny, onPause, onResume, onAbort }) {
  const m = mission;
  return (
    <div className="detail">
      <div className="detail-main">
        <div className="dh">
          <ProjectIcon id={m.project} size={46} radius="var(--r-lg)" />
          <div className="dh-col">
            <div className="dh-row1">
              <span className="dh-name">{(m.ticket ? m.ticket + ': ' : '') + m.summary}</span>
              <Badge status={m.status} />
            </div>
            <div className="dh-task" dangerouslySetInnerHTML={{ __html: m.objective }} />
          </div>
          <div className="dh-acts">
            {m.status === 'standby'
              ? <Button variant="primary" sm icon="play" onClick={() => onResume(m.id)}>Resume</Button>
              : <Button variant="secondary" sm icon="pause" onClick={() => onPause(m.id)}>Pause</Button>}
            <Button variant="danger" sm icon="octagon-x" onClick={() => onAbort(m.id)}>Abort</Button>
          </div>
        </div>

        {m.approval && (
          <div className="needs" style={{ marginBottom: 14, flex: 'none' }}>
            <div className="needs-head">
              <Icon name="shield-alert" size={16} />
              <span className="t">{m.ticket} needs your approval</span>
              <span className="c">paused</span>
            </div>
            <ApprovalRow mission={m} onApprove={onApprove} onDeny={onDeny} />
          </div>
        )}

        {/* ---- terminal (placeholder for the live agent session) ---- */}
        <div className="term">
          <div className="term-bar">
            <span className="dots"><span className="d" style={{ background: '#ED6A5E' }} /><span className="d" style={{ background: '#F4BE4F' }} /><span className="d" style={{ background: '#61C554' }} /></span>
            <span className="t">agent · {m.ticket} — {m.branch}</span>
            <span className="tag">Placeholder</span>
          </div>
          <div className="term-body">
            <div className="tline mut"># {m.repo} · {m.summary}</div>
            <div className="tline"><span className="pr">$</span> mc agent attach {m.ticket || m.id}</div>
            {m.timeline.map((ev, i) => (
              <div className="tline ag" key={i}>
                <span className="mut">[agent]</span> <span dangerouslySetInnerHTML={{ __html: ev.title }} />
              </div>
            ))}
            <div className="tline ag"><span className="mut">[agent]</span> <span dangerouslySetInnerHTML={{ __html: m.lastMessage }} /></div>
            <div className="tline"><span className="pr">$</span> <span className="blink">▋</span></div>
          </div>
          <div className="term-input">
            <span className="chev">›</span>
            <input placeholder="Message the agent…  (interactive terminal coming soon)" disabled />
            <button className="icon-send" disabled><Icon name="arrow-up" size={16} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { MissionDetail });
