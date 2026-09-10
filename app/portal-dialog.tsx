"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";

/** Native top-layer modality avoids card transforms and footer stacking. */
export default function PortalDialog({ open, onClose, title, description, children }: {
  open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = overflow;
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);

  return <dialog ref={dialogRef} className="portal-dialog" aria-labelledby={id + "-title"} onClose={onClose}
    aria-describedby={description ? id + "-description" : undefined}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose(); } }}
    onKeyDown={event => {
      if (event.key !== "Tab") return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')].filter(element => element.getClientRects().length > 0);
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
    {open && <div className="dialog-layout">
      <header className="dialog-header">
        <div><h2 id={id + "-title"}>{title}</h2>{description && <p id={id + "-description"}>{description}</p>}</div>
        <button ref={closeRef} type="button" className="icon-button" aria-label={"Close " + title} onClick={onClose}>×</button>
      </header>
      <div className="dialog-content">{children}</div>
    </div>}
  </dialog>;
}
