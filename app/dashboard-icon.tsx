import type { ReactNode } from "react";

// Preserve the inline artwork from the previously approved dashboard.
export default function DashboardIcon({ name, className = "" }: { name: string; className?: string }) {
  const paths: Record<string, ReactNode> = {
    person: <><circle cx="12" cy="8" r="3.25" /><path d="M5 20c.8-3.8 3.2-5.75 7-5.75s6.2 1.95 7 5.75" /></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>,
    business: <path d="M4 21V5h10v16M14 9h6v12M7 8h3M7 12h3M7 16h3M17 13h1M17 17h1" />,
    category: <><path d="m12 3 4 7H8l4-7Z" /><rect x="4" y="14" width="6" height="6" rx="1.5" /><circle cx="17" cy="17" r="3" /></>,
    description: <path d="M6 3h8l4 4v14H6V3ZM14 3v5h5M9 12h6M9 16h6" />,
    verified_user: <><path d="M12 3 5 6v5c0 4.4 2.8 8.4 7 10 4.2-1.6 7-5.6 7-10V6l-7-3Z" /><path d="m8.8 12.1 2.1 2.1 4.4-4.6" /></>,
    gpp_maybe: <path d="M12 3 5 6v5c0 4.4 2.8 8.4 7 10 4.2-1.6 7-5.6 7-10V6l-7-3ZM12 8v5M12 16.5h.01" />,
    info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 10.5v5M12 7.5h.01" /></>,
    task_alt: <><circle cx="12" cy="12" r="8" /><path d="m8.5 12.4 2.2 2.2 4.8-5.2" /></>,
    build: <path d="M22.61 18.99 13.8 10.18c.93-2.34.45-5.1-1.44-6.99-2.07-2.07-5.15-2.42-7.57-1.04l4.06 4.06-2.83 2.83-4.18-3.94C.46 7.52.81 10.6 2.88 12.67c1.89 1.89 4.65 2.37 6.99 1.44l8.81 8.81c.39.39 1.03.39 1.42 0l2.48-2.48c.42-.38.42-1.02.03-1.45Z" />,
  };
  const filled = ["check_circle", "cancel", "dot", "build"].includes(name);
  return <svg aria-hidden="true" viewBox="0 0 24 24" className={"dashboard-icon " + className}
    fill={filled ? "currentColor" : "none"} stroke={filled ? "none" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {name === "dot" ? <circle cx="12" cy="12" r="6" /> : name === "check_circle" || name === "cancel" ? <>
      <circle cx="12" cy="12" r="10" />
      <path d={name === "check_circle" ? "m7.5 12.4 2.8 2.8 6.2-6.5" : "m8.5 8.5 7 7M15.5 8.5l-7 7"} fill="none" stroke="white" strokeWidth="2.4" />
    </> : paths[name] ?? paths.category}
  </svg>;
}
