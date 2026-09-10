"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm({ callbackUrl, authError }: { callbackUrl: string; authError: boolean }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(authError ? "This sign-in link could not be verified. Please request a new one." : "");
  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setLoading(true); setMessage("");
    try {
      const { error } = await createClient().auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        // Preserve existing admission semantics. Roster-only admission needs
        // an approved server-side policy, not a client-only signup switch.
        options: { emailRedirectTo: callbackUrl },
      });
      setMessage(error ? "We could not send a link. Please wait a moment and try again." : "If this address can sign in, a link will arrive shortly. Check your inbox and spam folder, and open it in this browser.");
    } catch {
      setMessage("The sign-in service could not be reached. Check your connection and try again.");
    } finally { setLoading(false); }
  }
  return <form className="panel login-form" onSubmit={handleLogin} aria-busy={loading}>
    <h1>Candidate Portal</h1>
    <p className="secondary-text">Use the email address registered with Crossing Hurdles to receive a secure sign-in link.</p>
    <label htmlFor="email">Email address</label>
    <input id="email" name="email" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} disabled={loading} />
    <button type="submit" className="primary-button" disabled={loading}>{loading ? "Sending…" : "Email me a sign-in link"}</button>
    <p role="status" aria-live="polite">{message}</p>
    <a className="text-link" href="mailto:faisal@crossinghurdles.com">Need help signing in?</a>
  </form>;
}
