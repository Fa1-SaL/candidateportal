export const SESSION_ENDED_KEY = "portal:session-ended";
export const SESSION_CONCEAL_EVENT = "portal:conceal";
export const SESSION_RECHECK_EVENT = "portal:recheck";
export type SessionGuardState = "checking" | "ready" | "unavailable";
type VerifiedIdentity = { userId: string | null; unavailable: boolean };

/** Display protection supplements server auth/RLS; a late response cannot reveal
 * a signed-out, switched or disposed account. Matching auth events never reveal. */
export function createSessionGuard(options: {
  expectedUserId: string;
  verifyIdentity: () => Promise<VerifiedIdentity>;
  conceal: () => void;
  state: (state: SessionGuardState) => void;
  leave: () => void;
  timeoutMs?: number;
}) {
  let generation = 0;
  let disposed = false;
  let leaving = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  function pause() {
    if (disposed) return;
    generation++;
    options.conceal();
    options.state("checking");
  }
  function invalidate() {
    if (disposed || leaving) return;
    pause(); leaving = true; options.leave();
  }
  async function check(onVerified?: () => void) {
    if (disposed || leaving) return;
    pause();
    const request = generation;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const identity = await Promise.race([
        options.verifyIdentity(),
        new Promise<VerifiedIdentity>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Identity check timed out")), options.timeoutMs ?? 15000);
          timers.add(timer);
        }),
      ]);
      if (disposed || leaving || request !== generation) return;
      if (identity.unavailable) options.state("unavailable");
      else if (identity.userId !== options.expectedUserId) invalidate();
      else {
        options.state("ready");
        // Run follow-up work inside the winning identity check, not in a later
        // promise continuation that could race sign-out or page concealment.
        onVerified?.();
      }
    } catch {
      if (!disposed && !leaving && request === generation) options.state("unavailable");
    } finally {
      if (timer !== undefined) { clearTimeout(timer); timers.delete(timer); }
    }
  }
  return {
    check, pause, invalidate,
    // Synchronous callback: never call Supabase again while its event lock is held.
    authChanged(event: string, userId: string | null) {
      if (event === "SIGNED_OUT" || (userId !== null && userId !== options.expectedUserId) || (event === "INITIAL_SESSION" && userId === null)) invalidate();
    },
    dispose() {
      disposed = true; generation++;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}
