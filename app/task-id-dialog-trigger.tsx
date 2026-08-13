"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";

export default function TaskIdDialogTrigger({
  children,
  count,
  label,
  taskIds,
  wide = false,
}: {
  children: ReactNode;
  count: number;
  label: string;
  taskIds: string[] | null;
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const available = count > 0 && taskIds !== null && taskIds.length === count;

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function showTaskIds() {
    if (available) {
      setOpen(true);
    }
  }

  function closeDialog() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <>
      <div
        ref={triggerRef}
        role={available ? "button" : undefined}
        tabIndex={available ? 0 : undefined}
        aria-haspopup={available ? "dialog" : undefined}
        aria-label={available ? `View ${label} task IDs` : undefined}
        title={
          available
            ? `View ${label} task IDs`
            : count > 0
              ? "Task IDs are not available for this project yet"
              : undefined
        }
        onClick={showTaskIds}
        onKeyDown={(event) => {
          if (available && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={
          (wide ? "col-span-2 " : "") +
          (available
            ? "cursor-pointer rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6257dd]/45 focus-visible:ring-offset-2 sm:rounded-[9px]"
            : "")
        }
      >
        {children}
      </div>

      {open && taskIds ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-[#1b1b24]/35 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeDialog();
            }
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="flex max-h-[min(620px,calc(100vh-32px))] w-full max-w-[440px] flex-col overflow-hidden rounded-[8px] border border-[#e2e1e8] bg-white shadow-[0px_18px_50px_rgba(27,27,36,0.18)]"
          >
            <div className="flex items-start justify-between gap-4 border-b border-[#e2e1e8] px-5 py-4">
              <div>
                <h3
                  id={titleId}
                  className="text-[17px] font-semibold leading-[22px] text-[#1b1b24]"
                >
                  {label} Task IDs
                </h3>
                <p className="mt-1 text-[12px] leading-[17px] text-[#625f72]">
                  {count} {count === 1 ? "task" : "tasks"} in this project
                </p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                aria-label="Close task IDs"
                onClick={closeDialog}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-[6px] text-[#625f72] transition-colors hover:bg-[#f5f2ff] hover:text-[#3525cd] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6257dd]/45"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="size-[18px] fill-none stroke-current stroke-2"
                >
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <ol className="min-h-0 overflow-y-auto px-5 py-3">
              {taskIds.map((taskId, index) => (
                <li
                  key={`${taskId}-${index}`}
                  className="flex min-h-[38px] items-center gap-3 border-b border-[#efedf3] py-2 last:border-b-0"
                >
                  <span className="w-6 shrink-0 text-right text-[11px] font-medium tabular-nums text-[#898697]">
                    {index + 1}
                  </span>
                  <code className="select-all break-all text-[12px] font-medium leading-[17px] text-[#2d2b38]">
                    {taskId}
                  </code>
                </li>
              ))}
            </ol>
          </section>
        </div>
      ) : null}
    </>
  );
}
