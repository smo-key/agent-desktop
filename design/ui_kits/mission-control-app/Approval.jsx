/* ============================================================================
   Approval.jsx — the "manager, not micromanager" moment
   ============================================================================ */
function ApprovalRow({ mission, onApprove, onDeny }) {
  const a = mission.approval;
  if (!a) return null;
  return (
    <div className="appr">
      <div className="appr-row">
        <AgentAvatar size={32} className="appr-av" />
        <div className="appr-main">
          <div className="t" dangerouslySetInnerHTML={{ __html: '<b>' + mission.ticket + '</b> ' + a.summary }} />
          {a.command && (
            <div className="appr-cmd"><span className="c">$ </span>{a.command}</div>
          )}
        </div>
        <div className="appr-acts">
          <Button variant="ghost" sm onClick={() => onDeny(mission.id)}>Deny</Button>
          <Button variant="energy" sm icon="circle-check" onClick={() => onApprove(mission.id)}>Approve</Button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ApprovalRow });
