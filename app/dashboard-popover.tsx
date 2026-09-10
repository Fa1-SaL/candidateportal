"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

export default function DashboardPopover({ id, label, trigger, children, className = "" }: {
  id: string; label: string; trigger: ReactNode; children: ReactNode; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const hovered = useRef(false);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);
  return <div ref={container} className={"dashboard-popover " + className}
    onPointerEnter={event => { if (event.pointerType !== "touch") { hovered.current = true; setOpen(true); } }}
    onPointerLeave={event => { if (event.pointerType !== "touch") { hovered.current = false; setOpen(false); } }}
    onFocus={event => { if (event.target.matches(":focus-visible")) setOpen(true); }}
    onBlur={event => { if (!hovered.current && !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onKeyDown={event => { if (event.key === "Escape") { setOpen(false); event.stopPropagation(); } }}>
    <button type="button" className="dashboard-popover-trigger" aria-label={label} aria-expanded={open}
      aria-controls={id} onClick={event => setOpen(value => event.detail > 0 && hovered.current ? true : !value)}>{trigger}</button>
    <div id={id} className="dashboard-popover-panel" hidden={!open}>
      <div className="dashboard-popover-content">{children}</div>
    </div>
  </div>;
}
