"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SESSION_CONCEAL_EVENT, SESSION_ENDED_KEY, SESSION_RECHECK_EVENT } from "@/lib/auth/session-guard";

export default function AccountActions({ preview = false }: { preview?: boolean }) {
  const router = useRouter(); const [pending, startTransition] = useTransition();
  const [signingOut, setSigningOut] = useState(false); const [message, setMessage] = useState("");
  return <div className="account-actions">
    <button type="button" className="secondary-button" disabled={pending || signingOut} onClick={() => startTransition(() => router.refresh())}>{pending ? "Refreshing…" : "Refresh"}</button>
    {!preview && <button type="button" className="secondary-button" disabled={signingOut || pending} onClick={async () => {
      setSigningOut(true); setMessage("");
      window.dispatchEvent(new Event(SESSION_CONCEAL_EVENT));
      try {
        const { error } = await createClient().auth.signOut({ scope: "local" }); if (error) throw error;
        try { window.localStorage.setItem(SESSION_ENDED_KEY, String(Date.now())); } catch { /* SDK broadcast and focus checks cover disabled storage. */ }
        window.location.replace("/login");
      }
      catch { setMessage("Could not sign out. Please try again."); setSigningOut(false); window.dispatchEvent(new Event(SESSION_RECHECK_EVENT)); }
    }}>{signingOut ? "Signing out…" : "Sign out"}</button>}
    <span role="status" className="secondary-text">{message || (pending ? "Loading the latest published snapshot." : "")}</span>
  </div>;
}
