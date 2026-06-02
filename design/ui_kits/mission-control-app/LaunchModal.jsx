/* ============================================================================
   LaunchModal.jsx — compose & dispatch a new mission.
   ProjectSelect is a custom dropdown (project icons + "New project").
   ============================================================================ */
function ProjectSelect({ projects, value, onChange, onCreate }) {
  const [open, setOpen] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [name, setName] = React.useState('');
  const [pick, setPick] = React.useState(PROJECT_ICON_CHOICES[0]);
  const cur = projects.find(p => p.id === value) || projects[0];
  const create = () => {
    if (!name.trim()) return;
    const p = onCreate(name.trim(), false, pick.icon, pick.color);
    onChange(p.id); setName(''); setPick(PROJECT_ICON_CHOICES[0]); setCreating(false); setOpen(false);
  };
  return (
    <div className="psel">
      <button type="button" className="psel-btn" onClick={() => setOpen(o => !o)}>
        <Icon name={cur.icon} size={16} color={cur.color} />
        <span className="psel-name">{cur.name}</span>
        <span className="psel-repo">{cur.repo}</span>
        <Icon name="chevron-down" size={16} style={{ color: 'var(--fg-3)' }} />
      </button>
      {open && (
        <div className="psel-menu">
          {projects.map(p => (
            <button type="button" key={p.id} className={'psel-opt' + (p.id === value ? ' on' : '')}
              onClick={() => { onChange(p.id); setOpen(false); }}>
              <Icon name={p.icon} size={15} color={p.color} />
              <span className="psel-name">{p.name}</span>
              {p.id === value && <Icon name="check" size={14} style={{ color: 'var(--blue-300)' }} />}
            </button>
          ))}
          <div className="psel-sep" />
          {creating ? (
            <div className="psel-createbox">
              <IconPicker value={pick.icon} onPick={setPick} />
              <div className="psel-create">
                <Icon name={pick.icon} size={15} color={pick.color} />
                <input autoFocus value={name} placeholder="Project name…"
                  onChange={e => setName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') create(); if (e.key === 'Escape') setCreating(false); }} />
                <button type="button" className="icon-send" disabled={!name.trim()} onClick={create}><Icon name="check" size={15} /></button>
              </div>
            </div>
          ) : (
            <button type="button" className="psel-opt psel-new" onClick={() => setCreating(true)}>
              <Icon name="plus" size={15} /><span>New project</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function LaunchModal({ projects, onClose, onLaunch, onCreate }) {
  const [objective, setObjective] = React.useState('');
  const [project, setProject] = React.useState((projects[0] || {}).id);
  const canLaunch = objective.trim().length > 4;

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div className="ic"><Icon name="rocket" size={18} /></div>
          <div>
            <h2>Launch a mission</h2>
            <p>Set the objective and the project. You stay in control.</p>
          </div>
          <div className="x" onClick={onClose}><Icon name="x" size={17} /></div>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>Objective</label>
            <textarea className="ta" rows="3" autoFocus
              placeholder="e.g. Add rate limiting to the public API and write tests for it."
              value={objective} onChange={e => setObjective(e.target.value)} />
          </div>
          <div className="field">
            <label>Project</label>
            <ProjectSelect projects={projects} value={project} onChange={setProject} onCreate={onCreate} />
          </div>
        </div>
        <div className="modal-foot">
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="rocket"
            onClick={() => canLaunch && onLaunch({ objective: objective.trim(), project })}
            style={canLaunch ? {} : { opacity: .5, pointerEvents: 'none' }}>
            Launch mission
          </Button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { LaunchModal, ProjectSelect });
