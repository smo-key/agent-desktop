/* ============================================================================
   ui.jsx — shared primitives for the Mission Control app kit
   Exposed on window for the other Babel scripts.
   ============================================================================ */

/* Lucide icon wrapper. Renders an <i data-lucide> placeholder into a sized
   span, then lets Lucide swap it for an <svg>. Stroke width is uniform (1.75)
   across the app, so a single global createIcons() call is safe. Size is via CSS. */
function Icon({ name, size = 18, color, style, className }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = `<i data-lucide="${name}"></i>`;
    if (window.lucide) window.lucide.createIcons({ attrs: { 'stroke-width': 1.75 } });
  }, [name]);
  return (
    <span ref={ref} className={'mc-icon' + (className ? ' ' + className : '')}
          style={{ width: size, height: size, color, ...style }} />
  );
}

const STATUS = {
  nominal: { dot: 's-nominal', badge: 'b-nominal', label: 'Running', pulse: true },
  active:  { dot: 's-active',  badge: 'b-active',  label: 'Thinking', pulse: true },
  review:  { dot: 's-review',  badge: 'b-review',  label: 'Awaiting review' },
  standby: { dot: 's-standby', badge: 'b-standby', label: 'Standby' },
  abort:   { dot: 's-abort',   badge: 'b-abort',   label: 'Failed' },
  done:    { dot: 's-done',    badge: 'b-done',    label: 'Completed' },
};

function StatusDot({ status, pulse }) {
  const s = STATUS[status] || STATUS.standby;
  const doPulse = pulse !== undefined ? pulse : s.pulse;
  return <span className={'sdot ' + s.dot + (doPulse ? ' pulse' : '')} />;
}

function Badge({ status, children }) {
  const s = STATUS[status] || STATUS.standby;
  return (
    <span className={'badge ' + s.badge}>
      <StatusDot status={status} pulse={false} />
      {children || s.label}
    </span>
  );
}

function Button({ variant = 'secondary', sm, icon, children, onClick, style }) {
  return (
    <button className={`btn btn-${variant}${sm ? ' btn-sm' : ''}`} onClick={onClick} style={style}>
      {icon && <Icon name={icon} size={sm ? 14 : 15} />}
      {children}
    </button>
  );
}

/* Agent avatar — the logomark on a tile. */
function AgentAvatar({ size = 34, className = 'mc-av' }) {
  return (
    <div className={className} style={{ width: size, height: size }}>
      <img src="../../assets/logomark.svg" alt="" />
    </div>
  );
}

/* ----------------------------------------------------------------------------
   Projects — each carries an icon + color (or, in production, a logo). This
   identity is reused as the agent's icon so the fleet reads by project.
   ---------------------------------------------------------------------------- */
const MC_PROJECTS = [
  { id: 'payments',   name: 'Payments API', repo: 'acme/payments-api', icon: 'credit-card',  color: '#4C8DFF' },
  { id: 'storefront', name: 'Storefront',   repo: 'acme/storefront',   icon: 'shopping-bag', color: '#3CCB7F' },
  { id: 'web',        name: 'Web App',      repo: 'acme/web',          icon: 'globe',        color: '#36C2C2' },
  { id: 'docs',       name: 'Docs',         repo: 'acme/docs',         icon: 'book-open',    color: '#F0B341' },
  { id: 'infra',      name: 'Infra',        repo: 'acme/infra',        icon: 'server',       color: '#B98AE6' },
];
function projectOf(id) { return MC_PROJECTS.find(p => p.id === id) || MC_PROJECTS[0]; }
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/* Palette for newly-created projects (cycles through distinct icon + color pairs). */
const PROJECT_PALETTE = [
  { icon: 'box', color: '#E0739E' }, { icon: 'compass', color: '#4CC2A8' },
  { icon: 'cpu', color: '#7FBF4F' }, { icon: 'flame', color: '#F0844F' },
  { icon: 'sparkles', color: '#9B8CF0' }, { icon: 'satellite', color: '#5EC8E0' },
];
/* Icon + color choices offered when creating a project. */
const PROJECT_ICON_CHOICES = [
  { icon: 'credit-card', color: '#4C8DFF' }, { icon: 'shopping-bag', color: '#3CCB7F' },
  { icon: 'globe', color: '#36C2C2' }, { icon: 'book-open', color: '#F0B341' },
  { icon: 'server', color: '#B98AE6' }, { icon: 'box', color: '#E0739E' },
  { icon: 'cpu', color: '#7FBF4F' }, { icon: 'rocket', color: '#5EC8E0' },
  { icon: 'database', color: '#F0844F' }, { icon: 'compass', color: '#4CC2A8' },
  { icon: 'smartphone', color: '#E8B84B' }, { icon: 'bot', color: '#6FA0F0' },
];
function addProject(name, icon, color) {
  const fb = PROJECT_PALETTE[MC_PROJECTS.length % PROJECT_PALETTE.length];
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
  const p = { id: 'p' + Date.now(), name: name.trim(), repo: 'acme/' + slug, icon: icon || fb.icon, color: color || fb.color };
  MC_PROJECTS.push(p);
  return p;
}

/* Icon picker for the create-project flow. */
function IconPicker({ value, onPick }) {
  return (
    <div className="icon-picker">
      {PROJECT_ICON_CHOICES.map(c => (
        <button type="button" key={c.icon} className={'ipick' + (value === c.icon ? ' on' : '')}
          style={value === c.icon ? { borderColor: hexA(c.color, 0.55), background: hexA(c.color, 0.16) } : {}}
          onClick={() => onPick(c)}>
          <Icon name={c.icon} size={16} color={c.color} />
        </button>
      ))}
    </div>
  );
}

/* Project-tinted icon tile — used as the agent avatar. */
function ProjectIcon({ id, size = 34, radius = 'var(--r-md)' }) {
  const p = projectOf(id);
  return (
    <div className="proj-ic" style={{
      width: size, height: size, borderRadius: radius,
      background: hexA(p.color, 0.14), borderColor: hexA(p.color, 0.30), color: p.color,
    }}>
      <Icon name={p.icon} size={Math.round(size * 0.5)} />
    </div>
  );
}

Object.assign(window, { Icon, StatusDot, Badge, Button, AgentAvatar, STATUS, MC_PROJECTS, projectOf, hexA, ProjectIcon, addProject, PROJECT_ICON_CHOICES, IconPicker });
