"use client";
import Link, { useLinkStatus } from "next/link";

function ProjectLabel({ name, vertical }: { name: string; vertical: string }) {
  const { pending } = useLinkStatus();
  return <><span>{name} / {vertical}</span>{pending && <small className="project-switch-pending" role="status">Switching...</small>}</>;
}
export default function ProjectSwitcher({ projects, selectedProjectId, preview = false }: {
  projects: { id: string; projectName: string; verticalName: string }[]; selectedProjectId: string; preview?: boolean;
}) {
  if (projects.length < 2) return null;
  return <section className="dashboard-project-selector" aria-labelledby="project-switcher-label">
    <div className="dashboard-project-selector-heading"><h2 id="project-switcher-label">Your Projects</h2><span className="project-count">{projects.length} active</span></div>
    <nav className="project-navigation" aria-label="Your projects">{projects.map(project => <Link
    key={project.id} href={(preview ? "/preview" : "/") + "?project=" + encodeURIComponent(project.id)}
    prefetch={false} scroll={false} aria-current={selectedProjectId === project.id ? "page" : undefined}>
    <ProjectLabel name={project.projectName} vertical={project.verticalName} />
  </Link>)}</nav></section>;
}
