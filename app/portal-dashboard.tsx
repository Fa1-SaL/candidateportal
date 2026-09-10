import { formatDate, getTaskCounts, getTaskDetails, processStatus, record, text, type Domain, type PortalSnapshot, type TaskBucket } from "@/lib/portal/model";
import ProjectSwitcher from "./project-switcher";
import AccountActions from "./account-actions";
import TaskIdDialogTrigger from "./task-id-dialog-trigger";
import DashboardIcon from "./dashboard-icon";
import DashboardPopover from "./dashboard-popover";

function Freshness({ domain }: { domain: Domain }) {
  if (domain.state === "unavailable") return <p>Verified data is not available yet.</p>;
  return <p>{domain.state === "held" ? "Update under review; showing the previous verified values. " : "Verified snapshot. "}
    Verified {formatDate(domain.verifiedAt?.slice(0, 10) ?? null)}.
    {domain.sourceAsOf ? " Source through " + formatDate(domain.sourceAsOf) + "." : " Source cutoff unavailable."}</p>;
}

function InfoCard({ icon, label, value, subvalue, className = "" }: {
  icon: string; label: string; value: string; subvalue?: string; className?: string;
}) {
  return <section className={"dashboard-card dashboard-info " + className}>
    <div className="dashboard-label"><DashboardIcon name={icon} /><h2>{label}</h2></div>
    <div><p className="dashboard-value">{value}</p>{subvalue && <p className="dashboard-subvalue">{subvalue}</p>}</div>
  </section>;
}

function CheckCard({ icon, label, value, primary = false }: { icon: string; label: string; value: string; primary?: boolean }) {
  const positive = value === "Signed" || value === "Completed";
  const negative = value === "Not signed" || value === "Not completed";
  const display = value === "Completed" ? "Verified" : value === "Not completed" ? "Not Verified" : value === "Unavailable" ? "Not available" : value;
  return <section className="dashboard-card dashboard-check">
    <div className="dashboard-label"><DashboardIcon name={icon} /><h2>{label}</h2></div>
    <div className="dashboard-check-value"><p className="dashboard-value">{display}</p>
      <span className={"dashboard-verification-badge " + (positive ? primary ? "primary" : "success" : negative ? "error" : "neutral")}>
        {(positive && !primary || negative) && <DashboardIcon name={positive ? "check_circle" : "cancel"} />}
        {positive ? "Verified" : negative ? "Not Verified" : value === "In progress" ? "Pending" : "Unavailable"}
      </span>
    </div>
  </section>;
}

const taskTiles: { bucket: TaskBucket; label: string; icon?: string; tone: string }[] = [
  { bucket: "submitted", label: "Submitted", icon: "check_circle", tone: "primary" },
  { bucket: "accepted", label: "Accepted", icon: "task_alt", tone: "success" },
  { bucket: "rejected", label: "Rejected", icon: "cancel", tone: "error" },
  { bucket: "rework", label: "Requiring Rework", icon: "build", tone: "warning" },
  { bucket: "evaluationPending", label: "Evaluation Pending", tone: "neutral" },
];

export default function PortalDashboard({ email, name, snapshots, requestedProject, preview = false, unavailable = false }: {
  email: string; name: string | null; snapshots: PortalSnapshot[]; requestedProject?: string;
  preview?: boolean; unavailable?: boolean;
}) {
  const snapshot = snapshots.find(item => item.assignmentId === requestedProject) ?? snapshots[0];
  const projects = snapshots.map(item => { const assignment = record(item.domains.assignment.value); return { id: item.assignmentId, projectName: text(assignment.project_name) ?? "Project details unavailable", verticalName: text(assignment.vertical_name) ?? "Vertical unavailable" }; });
  const assignment = record(snapshot?.domains.assignment.value);
  const candidateName = name ?? text(assignment.full_name) ?? email;
  const domain = text(assignment.vertical_name) === "Coding" ? "Coding" : text(assignment.domain) ?? "Not available";
  const checks = record(snapshot?.domains.checks.value);
  const projectName = text(assignment.project_name) ?? "Not available";
  const counts = getTaskCounts(snapshot?.domains.metrics.value);
  const taskData = record(snapshot?.domains.task_events.value);
  // Retain the current revision and ID reconciliation gates, independent of styling.
  const compatibleTasks = !!snapshot && snapshot.domains.metrics.revision === snapshot.domains.task_events.revision;
  const taskDetails = getTaskDetails(taskData.rows, counts, taskData.complete === true && compatibleTasks);
  const active = text(assignment.assignment_status) === "active";
  return <div className="portal-shell portal-dashboard">
    <header className="dashboard-header"><div className="dashboard-header-inner">
      <a className="dashboard-brand" href={preview ? "/preview" : "/"}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/crossing-hurdles-logo.png" alt="Crossing Hurdles Logo" width="40" height="40" />
        <span>Candidate Portal</span>
      </a>
      <AccountActions preview={preview} />
      <DashboardPopover id="early-beta-popover" label="Early Beta" className="dashboard-beta" trigger="Early Beta">
        <h2>Early Beta</h2>
        <p>This portal is currently in its early beta stage. Some information may occasionally be inaccurate or incomplete.</p>
        <p>For ideas, suggestions, or corrections, please email <a href="mailto:faisal@crossinghurdles.com">faisal@crossinghurdles.com</a>.</p>
      </DashboardPopover>
    </div></header>
    <main id="main-content" className="dashboard-main">
      {preview && <p className="notice">Local test preview: entirely synthetic data; no live source or database connection.</p>}
      <section className="dashboard-hero"><h1>Hi {candidateName}</h1><p>Here is an overview of your current projects and tasks.</p></section>
      {!snapshot ? <section className="panel empty-state"><h2>{unavailable ? "Verified data is temporarily unavailable" : "Waiting for your verified snapshot"}</h2>
        <p>{unavailable ? "We could not load a published snapshot. Your information has not been changed. Use Refresh to try again." : "Your account is signed in, but no verified project snapshot has been published for it yet. Raw or incomplete data is not displayed."}</p>
        <p className="secondary-text">Signed in as {email}. Contact support if you expected to see a project.</p>
      </section> : <>
        <ProjectSwitcher projects={projects} selectedProjectId={snapshot.assignmentId} preview={preview} />
        {requestedProject && !snapshots.some(item => item.assignmentId === requestedProject) && <p role="status" className="notice">The requested project is unavailable. Showing {projectName}.</p>}
        <div className="dashboard-grid" key={snapshot.assignmentId + ":" + snapshot.revision}>
          <div className="dashboard-information" id="project-details">
            <div className="dashboard-info-grid">
              <InfoCard icon="person" label="Candidate" value={candidateName} />
              <InfoCard icon="mail" label="Email" value={email} />
              <InfoCard icon="business" label="Client" value={text(assignment.client_name) ?? "Not available"} className="dashboard-project-info" />
              <InfoCard icon="category" label="Project / Vertical" value={projectName} subvalue={text(assignment.vertical_name) ?? "Not available"} className="dashboard-project-info" />
            </div>
            <div className="dashboard-status-grid">
              <section className="dashboard-card dashboard-status"><h2 className="dashboard-field-label">Status</h2>
                <span className={"dashboard-status-chip " + (active ? "success" : "neutral")}>{active && <DashboardIcon name="dot" />}{active ? "Active" : "Not available"}</span>
              </section>
              <section className="dashboard-card dashboard-domain"><h2 className="dashboard-field-label">Domain</h2><p className="dashboard-value">{domain}</p></section>
            </div>
            <div className="dashboard-check-grid">
              <CheckCard icon="description" label="Contract Status" value={processStatus(checks.contract_status, "contract")} primary />
              <CheckCard icon="verified_user" label="SpringVerify Status" value={processStatus(checks.springverify_status, "check")} />
              <CheckCard icon="gpp_maybe" label="Remofirst Status" value={processStatus(checks.remofirst_status, "check")} />
            </div>
            {(snapshot.domains.assignment.state === "held" || snapshot.domains.checks.state === "held") && <p className="secondary-text">An update is under review. The previous verified profile values remain visible.</p>}
          </div>
          <aside className="dashboard-summary">
            <section className="dashboard-card dashboard-task-panel" aria-labelledby="tasks-heading">
              <h2 id="tasks-heading">Task Summary</h2>
              <DashboardPopover id="task-summary-update-note" label="Task Summary update information" className="dashboard-task-info" trigger={<DashboardIcon name="info" />}>
                <p>Showing the latest published snapshot.</p><Freshness domain={snapshot.domains.metrics} />
              </DashboardPopover>
              <div className="dashboard-task-grid">{taskTiles.map(({ bucket, label, icon, tone }) => <TaskIdDialogTrigger key={bucket}
                className={bucket === "evaluationPending" ? "dashboard-task-wide" : undefined}
                projectName={projectName} count={counts[bucket]} label={label} taskIds={taskDetails.lists?.[bucket] ?? null} notice={counts[bucket] === null ? "Not available" : "Details unavailable"}>
                {icon && <DashboardIcon name={icon} className={tone} />}
                <span className={"dashboard-task-number" + (counts[bucket] === null ? " unavailable" : "")}>{counts[bucket] ?? "Not available"}</span><span className="dashboard-task-label">{label}</span>
              </TaskIdDialogTrigger>)}</div>
            </section>
            {!taskDetails.lists && <p className="dashboard-task-note">{taskDetails.message}</p>}
          </aside>
        </div>
      </>}
    </main>
  </div>;
}
