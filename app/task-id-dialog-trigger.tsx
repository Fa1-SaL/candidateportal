"use client";
import { useState, type ReactNode } from "react";
import PortalDialog from "./portal-dialog";

export default function TaskIdDialogTrigger({ children, count, label, taskIds, projectName, notice, className = "" }: {
  children: ReactNode; count: number | null; label: string; taskIds: string[] | null; projectName: string; notice: string; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [copied, setCopied] = useState("");
  const available = count !== null && count > 0 && taskIds !== null && taskIds.length === count;
  const pageSize = 50; const pageCount = Math.ceil((taskIds?.length ?? 0) / pageSize);
  return <div className={"task-card " + className}>
    {available ? <button type="button" className="task-trigger" aria-haspopup="dialog" aria-expanded={open}
      aria-label={"View " + label.toLowerCase() + " task IDs for " + projectName} onClick={() => { setPage(0); setCopied(""); setOpen(true); }}>{children}<span className="text-link">View task IDs →</span></button> : <div className="task-trigger">{children}<span className="secondary-text">{count === 0 ? "No tasks in this status" : notice}</span></div>}
    <PortalDialog open={open} onClose={() => setOpen(false)} title={label + " task IDs"} description={projectName + " · " + (count ?? "Unknown") + " tasks"}>
      <button type="button" className="secondary-button" onClick={async () => {
        try { await navigator.clipboard.writeText((taskIds ?? []).join("\n")); setCopied("Task IDs copied."); }
        catch { setCopied("Could not copy. Select the task IDs below to copy them manually."); }
      }}>Copy all IDs</button><p role="status" className="secondary-text">{copied}</p>
      <ol className="task-id-list" start={page * pageSize + 1}>{taskIds?.slice(page * pageSize, (page + 1) * pageSize).map(id => <li key={id}><code>{id}</code></li>)}</ol>
      {pageCount > 1 && <nav className="pagination" aria-label="Task ID pages">
        <button type="button" className="secondary-button" disabled={page === 0} onClick={() => setPage(value => value - 1)}>Previous</button>
        <span role="status">Page {page + 1} of {pageCount}</span>
        <button type="button" className="secondary-button" disabled={page + 1 >= pageCount} onClick={() => setPage(value => value + 1)}>Next</button>
      </nav>}
    </PortalDialog>
  </div>;
}
