"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

type ProjectOption = {
  id: string;
  verticalName: string;
  projectName: string;
};

export default function ProjectSwitcher({
  projects,
  selectedProjectId,
}: {
  projects: ProjectOption[];
  selectedProjectId: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  if (projects.length < 2) {
    return null;
  }

  function selectProject(projectId: string) {
    if (projectId === selectedProjectId) {
      return;
    }

    const nextSearchParams = new URLSearchParams(searchParams.toString());
    nextSearchParams.set("project", projectId);

    startTransition(() => {
      router.replace(`${pathname}?${nextSearchParams.toString()}`, {
        scroll: false,
      });
    });
  }

  return (
    <section aria-labelledby="project-switcher-label">
      <div className="mb-[10px] flex items-center justify-between gap-4 sm:mb-[8px]">
        <p
          id="project-switcher-label"
          className="text-[12px] font-semibold uppercase leading-[15px] tracking-[0.05em] text-[#464555] sm:text-[11px] sm:leading-[12px]"
        >
          Your Projects
        </p>
        <p
          className={
            isPending
              ? "inline-flex min-h-[26px] items-center gap-[7px] rounded-full border border-[#b8b2e8] bg-[#f0ecff] px-[10px] text-[12px] font-semibold leading-[15px] text-[#3525cd] shadow-[0px_2px_6px_rgba(53,37,205,0.1)] sm:min-h-[23px] sm:px-[9px] sm:text-[11px] sm:leading-[12px]"
              : "text-[12px] font-medium leading-[15px] text-[#5f5d6d] sm:text-[11px] sm:leading-[12px]"
          }
          aria-live="polite"
        >
          {isPending ? (
            <>
              <span
                aria-hidden="true"
                className="size-[11px] shrink-0 animate-spin rounded-full border-2 border-[#b8b2e8] border-t-[#3525cd]"
              />
              Switching...
            </>
          ) : (
            `${projects.length} active`
          )}
        </p>
      </div>
      <div
        role="tablist"
        aria-labelledby="project-switcher-label"
        className="flex gap-[8px] overflow-x-auto pb-[2px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {projects.map((project) => {
          const selected = project.id === selectedProjectId;
          const label = `${project.projectName} / ${project.verticalName}`;

          return (
            <button
              key={project.id}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-label={`Show ${label}`}
              onClick={() => selectProject(project.id)}
              className={
                "inline-flex h-[36px] shrink-0 items-center rounded-[7px] border px-[12px] text-[13px] font-semibold leading-[18px] transition-[background-color,border-color,color,box-shadow,transform] duration-200 focus:outline-none focus:ring-2 focus:ring-[#d8d3ff] sm:h-[30px] sm:px-[10px] sm:text-[11px] sm:leading-[14px] " +
                (selected
                  ? "border-[#3525cd] bg-[#3525cd] text-white shadow-[0px_3px_8px_rgba(53,37,205,0.18)]"
                  : "border-[#e2e1e8] bg-white text-[#464555] hover:-translate-y-px hover:border-[#b8b2e8] hover:bg-[#f5f2ff] hover:text-[#3525cd]")
              }
              title={label}
            >
              {label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
