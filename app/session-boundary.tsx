"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { authenticationUnavailable } from "@/lib/auth/errors";
import { createSessionGuard, SESSION_CONCEAL_EVENT, SESSION_ENDED_KEY, SESSION_RECHECK_EVENT, type SessionGuardState } from "@/lib/auth/session-guard";

export default function SessionBoundary({ expectedUserId, children }: { expectedUserId: string; children: ReactNode }) {
  const [state, setState] = useState<SessionGuardState>("checking");
  const content = useRef<HTMLDivElement>(null);
  const guardRef = useRef<ReturnType<typeof createSessionGuard> | null>(null);
  useEffect(() => {
    const client = createClient();
    const guard = createSessionGuard({
      expectedUserId,
      verifyIdentity: async () => {
        const { data, error } = await client.auth.getUser();
        return { userId: data.user?.id ?? null, unavailable: authenticationUnavailable(error) };
      },
      conceal: () => {
        // Top-layer dialogs must close before hiding their ancestor. Do this
        // synchronously, before navigation or a deferred React update can paint.
        content.current?.querySelectorAll<HTMLDialogElement>("dialog[open]").forEach(dialog => dialog.close());
        if (content.current) content.current.hidden = true;
      },
      state: next => {
        if (next === "ready" && content.current) content.current.hidden = false;
        setState(next);
      },
      leave: () => window.location.replace("/login"),
    });
    guardRef.current = guard;
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => guard.authChanged(event, session?.user.id ?? null));
    const recheck = () => { if (document.visibilityState === "visible") void guard.check(); else guard.pause(); };
    const conceal = () => guard.pause();
    const ended = (event: StorageEvent) => { if (event.key === SESSION_ENDED_KEY && event.newValue) guard.invalidate(); };
    window.addEventListener("focus", recheck);
    window.addEventListener("pageshow", recheck);
    window.addEventListener("pagehide", conceal);
    window.addEventListener("storage", ended);
    window.addEventListener(SESSION_CONCEAL_EVENT, conceal);
    window.addEventListener(SESSION_RECHECK_EVENT, recheck);
    document.addEventListener("visibilitychange", recheck);
    void guard.check();
    return () => {
      guard.dispose(); subscription.unsubscribe(); guardRef.current = null;
      window.removeEventListener("focus", recheck);
      window.removeEventListener("pageshow", recheck);
      window.removeEventListener("pagehide", conceal);
      window.removeEventListener("storage", ended);
      window.removeEventListener(SESSION_CONCEAL_EVENT, conceal);
      window.removeEventListener(SESSION_RECHECK_EVENT, recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [expectedUserId]);
  return <>
    {state !== "ready" && <main className="portal-main"><section className="panel empty-state" aria-live="polite">
      <h1>{state === "unavailable" ? "Unable to confirm your session" : "Checking your session…"}</h1>
      {state === "unavailable" && <><p>Your dashboard is hidden until your account can be confirmed.</p><button className="primary-button" onClick={() => void guardRef.current?.check()}>Try again</button></>}
      <noscript>Enable JavaScript to securely view your dashboard.</noscript>
    </section></main>}
    <div ref={content} className="session-content" hidden={state !== "ready"}>{children}</div>
  </>;
}
