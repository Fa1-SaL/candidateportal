"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { authenticationUnavailable } from "@/lib/auth/errors";
import { createSessionGuard, SESSION_CONCEAL_EVENT, SESSION_ENDED_KEY, SESSION_RECHECK_EVENT, type SessionGuardState } from "@/lib/auth/session-guard";
import { createSessionLifecycle } from "@/lib/auth/session-lifecycle";

export default function SessionBoundary({ expectedUserId, children }: { expectedUserId: string; children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<SessionGuardState>("checking");
  const content = useRef<HTMLDivElement>(null);
  const lifecycleRef = useRef<ReturnType<typeof createSessionLifecycle> | null>(null);
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
    const lifecycle = createSessionLifecycle({
      guard, refresh: () => router.refresh(), initiallyVisible: document.visibilityState === "visible",
    });
    lifecycleRef.current = lifecycle;
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => guard.authChanged(event, session?.user.id ?? null));
    const focus = () => { void lifecycle.focus(document.visibilityState === "visible"); };
    const visibility = () => { void lifecycle.visibilityChanged(document.visibilityState === "visible"); };
    const pageshow = (event: PageTransitionEvent) => { void lifecycle.pageShow(event.persisted, document.visibilityState === "visible"); };
    const pagehide = () => lifecycle.pageHide();
    const recheck = () => { void lifecycle.retry(); };
    const conceal = () => lifecycle.suspend();
    const ended = (event: StorageEvent) => { if (event.key === SESSION_ENDED_KEY && event.newValue) guard.invalidate(); };
    window.addEventListener("focus", focus);
    window.addEventListener("pageshow", pageshow);
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("storage", ended);
    window.addEventListener(SESSION_CONCEAL_EVENT, conceal);
    window.addEventListener(SESSION_RECHECK_EVENT, recheck);
    document.addEventListener("visibilitychange", visibility);
    void lifecycle.start();
    return () => {
      lifecycle.dispose(); subscription.unsubscribe(); lifecycleRef.current = null;
      window.removeEventListener("focus", focus);
      window.removeEventListener("pageshow", pageshow);
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("storage", ended);
      window.removeEventListener(SESSION_CONCEAL_EVENT, conceal);
      window.removeEventListener(SESSION_RECHECK_EVENT, recheck);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [expectedUserId, router]);
  return <>
    {state !== "ready" && <main className="portal-main"><section className="panel empty-state" aria-live="polite">
      <h1>{state === "unavailable" ? "Unable to confirm your session" : "Checking your session…"}</h1>
      {state === "unavailable" && <><p>Your dashboard is hidden until your account can be confirmed.</p><button className="primary-button" onClick={() => void lifecycleRef.current?.retry()}>Try again</button></>}
      <noscript>Enable JavaScript to securely view your dashboard.</noscript>
    </section></main>}
    <div ref={content} className="session-content" hidden={state !== "ready"}>{children}</div>
  </>;
}
