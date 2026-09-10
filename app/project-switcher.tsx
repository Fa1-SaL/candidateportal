"use client";
import Link, { useLinkStatus } from "next/link";

function ProjectLabel({ name, vertical }: { name: string; vertical: string }) {
  const { pending } = useLinkStatus();
  return <><span>{name}</span><small aria-live="polite">{pending ? "Loading project…" : vertical}</small></>;
}
export default function ProjectSwitcher({ projects, selectedProjectId, preview = false }: {
  projects: { id: string; projectName: string; verticalName: string }[]; selectedProjectId: string; preview?: boolean;
}) {
  if (projects.length < 2) return null;
  return <nav className="project-navigation" aria-label="Your projects">{projects.map(project => <Link
    key={project.id} href={(preview ? "/preview" : "/") + "?project=" + encodeURIComponent(project.id)}
    prefetch={false} scroll={false} aria-current={selectedProjectId === project.id ? "page" : undefined}>
    <ProjectLabel name={project.projectName} vertical={project.verticalName} />
  </Link>)}</nav>;
}
