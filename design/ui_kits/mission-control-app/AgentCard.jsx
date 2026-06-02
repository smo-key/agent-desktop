/* ============================================================================
   AgentCard.jsx — control-room card. A plain AI-summary title (optionally
   "TICKET: …"), the agent's last message, inline attention actions, and a task
   progress strip (mini segments per task; the active one flashes). Click
   anywhere except a button/input to open the agent.
   ============================================================================ */
function TaskBar({ tasks, status }) {
  const { total, done } = tasks;
  return (
    <div className="taskbar">
      {Array.from({ length: total }).map((_, i) => {
        const cls = i < done ? 'seg done' : (i === done && status !== 'done') ? 'seg cur' : 'seg';
        return <span key={i} className={cls + (status === 'done' ? ' ok' : '')} />;
      })}
    </div>
  );
}

function AgentCard({ agent, onOpen, onApprove, onDeny, onAnswer, onFeedback, onResolve }) {
  const a = agent;
  const [reply, setReply] = React.useState('');
  const attn = a.lane === 'attn';
  const kind = attn ? a.ask.kind : null;
  const title = (a.ticket ? a.ticket + ': ' : '') + a.summary;

  const send = () => { if (reply.trim()) { onAnswer(a.id, reply.trim(), false); setReply(''); } };
  const cardOpen = (e) => { if (e.target.closest('button, input, select, textarea, a')) return; onOpen(a.id); };

  return (
    <div className={'acard clickable ' + a.lane} onClick={cardOpen}>
      <div className="ac-top">
        <ProjectIcon id={a.project} size={34} />
        <div className="ac-head-txt"><span className="ac-feat">{title}</span></div>
      </div>

      <div className="ac-msg"><div className="ac-msg-txt" dangerouslySetInnerHTML={{ __html: a.lastMessage }} /></div>

      {kind === 'approval' && (
        <React.Fragment>
          <div className="ac-cmd"><span className="c">$ </span>{a.ask.command}</div>
          <div className="ac-acts">
            <Button variant="energy" sm icon="circle-check" onClick={() => onApprove(a.id)}>Approve &amp; continue</Button>
            <Button variant="ghost" sm onClick={() => onDeny(a.id)}>Deny</Button>
          </div>
        </React.Fragment>
      )}

      {kind === 'question' && (
        <React.Fragment>
          {a.ask.options && (
            <div className="ac-options">
              {a.ask.options.map((o, i) => (
                <button className="opt" key={i} onClick={() => onAnswer(a.id, o, true)}>{o}</button>
              ))}
            </div>
          )}
          <div className="ac-reply">
            <input value={reply} onChange={e => setReply(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') send(); }}
              placeholder={'Reply…'} />
            <button className="icon-send" disabled={!reply.trim()} onClick={send}><Icon name="arrow-up" size={16} /></button>
          </div>
        </React.Fragment>
      )}

      {kind === 'review' && (
        <div className="ac-acts">
          <Button variant="energy" sm icon="circle-check" onClick={() => onFeedback(a.id, 'ok')}>Looks good</Button>
          <Button variant="ghost" sm onClick={() => onFeedback(a.id, 'changes')}>Request changes</Button>
        </div>
      )}

      {kind === 'handoff' && (
        <React.Fragment>
          {a.ask.files && (
            <div className="ac-files">
              {a.ask.files.map((f, i) => (
                <button className="ac-file" key={i} onClick={() => onOpen(a.id)}>
                  <Icon name="file-code" size={15} className="fi" />
                  <span className="fn">{f.path}</span>
                  <span className="rv">Review<Icon name="arrow-right" size={13} /></span>
                </button>
              ))}
            </div>
          )}
          {a.ask.action && (
            <div className="ac-actionnote"><Icon name="hand" size={15} /><span>{a.ask.action}</span></div>
          )}
          <div className="ac-acts">
            <Button variant="energy" sm icon="circle-check" onClick={() => onResolve(a.id)}>{a.ask.cta || 'Mark as done'}</Button>
          </div>
        </React.Fragment>
      )}

      {!attn && (a.tasks
        ? <TaskBar tasks={a.tasks} status={a.status} />
        : <div className="bar"><i style={{ width: a.progress + '%',
            background: a.lane === 'done' ? 'var(--nominal-500)' : a.status === 'active' ? 'var(--blue-400)' : 'var(--blue-500)' }} /></div>)}
    </div>
  );
}

Object.assign(window, { AgentCard, TaskBar });
