/* ============================================================================
   ProjectPanel.jsx — hideable left rail: filter the fleet by project, and
   create new projects (each project = a folder/workspace you're working in).
   ============================================================================ */
function ProjectPanel({ projects, selected, total, onSelect, onClose, onCreate }) {
  const [creating, setCreating] = React.useState(false);
  const [name, setName] = React.useState('');
  const [pick, setPick] = React.useState(PROJECT_ICON_CHOICES[0]);
  const create = () => { if (name.trim()) { onCreate(name.trim(), true, pick.icon, pick.color); setName(''); setPick(PROJECT_ICON_CHOICES[0]); setCreating(false); } };

  return (
    <aside className="ppanel">
      <div className="pp-head">
        <span className="pp-title">Workspace</span>
        <button className="pp-collapse" title="Hide panel" onClick={onClose}>
          <Icon name="panel-left-close" size={16} />
        </button>
      </div>
      <button className={'pp-item' + (selected === 'all' ? ' active' : '')} onClick={() => onSelect('all')}>
        <Icon name="layers" size={16} /><span className="pp-name">All agents</span>
        <span className="pp-ct">{total}</span>
      </button>
      <div className="pp-label">Projects</div>
      {projects.map(p => (
        <button key={p.id} className={'pp-item' + (selected === p.id ? ' active' : '')} onClick={() => onSelect(p.id)}>
          <Icon name={p.icon} size={16} color={p.color} />
          <span className="pp-name">{p.name}</span>
          {p.attn ? <span className="pp-attn" title="Needs attention" /> : null}
          <span className="pp-ct">{p.count}</span>
        </button>
      ))}
      {creating ? (
        <div className="pp-createbox">
          <IconPicker value={pick.icon} onPick={setPick} />
          <div className="pp-create">
            <Icon name={pick.icon} size={16} color={pick.color} />
            <input autoFocus value={name} placeholder="Project name…"
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') create(); if (e.key === 'Escape') { setCreating(false); setName(''); } }} />
            <button className="icon-send" disabled={!name.trim()} onClick={create}><Icon name="check" size={15} /></button>
          </div>
        </div>
      ) : (
        <button className="pp-item pp-new" onClick={() => setCreating(true)}>
          <Icon name="plus" size={16} /><span className="pp-name">New project</span>
        </button>
      )}
    </aside>
  );
}

Object.assign(window, { ProjectPanel });
