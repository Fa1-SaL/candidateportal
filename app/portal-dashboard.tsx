import { formatDate, getTaskCounts, getTaskDetails, processStatus, record, text, TASK_LABELS, type Domain, type PortalSnapshot, type TaskBucket } from "@/lib/portal/model";
import ProjectSwitcher from "./project-switcher";
import AccountActions from "./account-actions";
import TaskIdDialogTrigger from "./task-id-dialog-trigger";

function Freshness({ domain }: { domain: Domain }) {
  if (domain.state === "unavailable") return <p className="domain-state">Verified data is not available yet.</p>;
  return <p className={"domain-state " + (domain.state === "held" ? "held" : "")}>
    {domain.state === "held" ? "Update under review · showing the previous verified values. " : "Verified snapshot. "}
    Verified {formatDate(domain.verifiedAt?.slice(0, 10) ?? null)}.
    {domain.sourceAsOf ? ` Source through ${formatDate(domain.sourceAsOf)}.` : " Source cutoff unavailable."}
  </p>;
}

export default function PortalDashboard({ email, name, snapshots, requestedProject, preview = false, unavailable = false }: {
  email: string; name: string | null; snapshots: PortalSnapshot[]; requestedProject?: string;
  preview?: boolean; unavailable?: boolean;
}) {
  const snapshot = snapshots.find(item => item.assignmentId === requestedProject) ?? snapshots[0];
  const projects = snapshots.map(item => { const assignment = record(item.domains.assignment.value); return { id: item.assignmentId, projectName: text(assignment.project_name) ?? "Project details unavailable", verticalName: text(assignment.vertical_name) ?? "Vertical unavailable" }; });
  const assignment = record(snapshot?.domains.assignment.value);
  const domain = text(assignment.vertical_name) === "Coding" ? "Coding" : text(assignment.domain) ?? "Unavailable";
  const checks = record(snapshot?.domains.checks.value);
  const projectName = text(assignment.project_name) ?? "Your project";
  const counts = getTaskCounts(snapshot?.domains.metrics.value);
  const taskData = record(snapshot?.domains.task_events.value);
  // Counts and IDs must share an explicitly compatible revision, not just matching totals.
  const compatibleTasks = !!snapshot && snapshot.domains.metrics.revision === snapshot.domains.task_events.revision;
  const taskDetails = getTaskDetails(taskData.rows, counts, taskData.complete === true && compatibleTasks);
  return <div className="portal-shell">
    <header className="portal-header"><a className="brand" href={preview ? "/preview" : "/"}>
      {/* Fixed-size local brand mark; no remote image transformation needed. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/crossing-hurdles-logo.png" alt="" width="36" height="36" />
      <span>Candidate Portal</span></a><AccountActions preview={preview} /></header>
    <main id="main-content" className="portal-main">
      {preview && <p className="notice">Local test preview · entirely synthetic data · no live source or database connection.</p>}
      <div className="page-heading"><div><p className="eyebrow">Your work</p><h1>Hello, {name ?? text(assignment.full_name) ?? email}</h1></div><a className="text-link" href="mailto:faisal@crossinghurdles.com">Help / report a discrepancy</a></div>
      {!snapshot ? <section className="panel empty-state"><h2>{unavailable ? "Verified data is temporarily unavailable" : "Waiting for your verified snapshot"}</h2>
        <p>{unavailable ? "We could not load a published snapshot. Your information has not been changed. Use Refresh to try again." : "Your account is signed in, but no verified project snapshot has been published for it yet. Raw or incomplete data is not displayed."}</p>
        <p className="secondary-text">Signed in as {email}. Contact support if you expected to see a project.</p>
      </section> : <>
        <ProjectSwitcher projects={projects} selectedProjectId={snapshot.assignmentId} preview={preview} />
        {requestedProject && !snapshots.some(item => item.assignmentId === requestedProject) && <p role="status" className="notice">The requested project is unavailable. Showing {projectName}.</p>}
        <div className="selected-heading"><h2>{projectName}</h2><p className="secondary-text">Published {formatDate(snapshot.appliedAt.slice(0, 10))}</p></div>
        <div className="work-grid" key={snapshot.assignmentId + ":" + snapshot.revision}>
          <section className="panel task-panel" aria-labelledby="tasks-heading"><div className="section-heading"><h2 id="tasks-heading">Task summary</h2><a className="text-link" href="#project-details">Project details ↓</a></div>
            <Freshness domain={snapshot.domains.metrics} />
            <div className="task-grid">{(Object.keys(TASK_LABELS) as TaskBucket[]).map(bucket => <TaskIdDialogTrigger key={bucket}
              projectName={projectName} count={counts[bucket]} label={TASK_LABELS[bucket]} taskIds={taskDetails.lists?.[bucket] ?? null} notice={counts[bucket] === null ? "Not available" : "Details unavailable"}>
              <span className={"task-number " + bucket}>{counts[bucket] ?? "—"}</span><span className="task-label">{TASK_LABELS[bucket]}</span>
            </TaskIdDialogTrigger>)}</div>
            <p className="secondary-text">{taskDetails.message}</p>
          </section>
        </div>
        <details id="project-details" className="panel project-details"><summary>Profile and project details</summary>
          <div className="details-grid"><section><h3>Project details</h3><Freshness domain={snapshot.domains.assignment} />
            <dl className="detail-list"><div><dt>Name</dt><dd>{name ?? text(assignment.full_name) ?? "Unavailable"}</dd></div><div><dt>Email</dt><dd>{email}</dd></div><div><dt>Client</dt><dd>{text(assignment.client_name) ?? "Unavailable"}</dd></div><div><dt>Vertical</dt><dd>{text(assignment.vertical_name) ?? "Unavailable"}</dd></div><div><dt>Domain</dt><dd>{domain}</dd></div><div><dt>Status</dt><dd>{text(assignment.assignment_status) === "active" ? "Active" : "Unavailable"}</dd></div></dl>
          </section><section><h3>Onboarding checks</h3><Freshness domain={snapshot.domains.checks} />
            <dl className="detail-list"><div><dt>Contract</dt><dd>{processStatus(checks.contract_status, "contract")}</dd></div><div><dt>SpringVerify</dt><dd>{processStatus(checks.springverify_status, "check")}</dd></div><div><dt>Remofirst</dt><dd>{processStatus(checks.remofirst_status, "check")}</dd></div></dl>
            <p className="secondary-text">These are process statuses, separate from whether the source data has been verified.</p>
          </section></div>
        </details>
      </>}
    </main>
  </div>;
}
