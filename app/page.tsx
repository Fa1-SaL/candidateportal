import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { parsePublicSnapshot } from "@/lib/portal/model";
import { inspectSnapshotRead, snapshotReadDiagnostic } from "@/lib/portal/snapshot-read";
import { containsAuthParameters } from "@/lib/auth/redirects";
import { authenticationUnavailable } from "@/lib/auth/errors";
import PortalDashboard from "./portal-dashboard";
import SessionBoundary from "./session-boundary";
import Maintenance from "./maintenance";
import { PORTAL_UNDER_MAINTENANCE } from "@/lib/portal/maintenance";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requestedProject = Array.isArray(params.project) ? params.project[0] : params.project;
  // Old emails can land on "/" with auth material. Never carry it into links,
  // analytics or the dashboard URL; auth verification belongs on /auth/*.
  if (containsAuthParameters(Object.keys(params))) redirect(requestedProject ? "/?project=" + encodeURIComponent(requestedProject) : "/");
  if (PORTAL_UNDER_MAINTENANCE) return <Maintenance />;
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authenticationUnavailable(authError)) throw new Error("Authentication service unavailable");
  if (!user) redirect("/login");
  const protect = (content: ReactNode) => <SessionBoundary key={user.id} expectedUserId={user.id}>{content}</SessionBoundary>;
  const email = user.email ?? "Your account";
  const { data: candidate, error: candidateError } = await supabase.from("candidates").select("id").eq("auth_user_id", user.id).maybeSingle();
  if (candidateError) throw new Error("Unable to load account");
  if (!candidate) return protect(<PortalDashboard email={email} name={null} snapshots={[]} />);

  // Security-invoker view + underlying ownership RLS. Never fall back to raw legacy
  // metrics/payments when this read contract is absent, malformed or unavailable.
  const { data, error, count } = await supabase.from("candidate_portal_snapshot")
    .select("assignment_id,revision,applied_at,verified_at,source_as_of,payload", { count: "exact" })
    .order("assignment_id", { ascending: true }).limit(51);
  const read = inspectSnapshotRead({ data, error, count }, parsePublicSnapshot);
  // A malformed published project must not quietly vanish from an apparently
  // complete project selector. Fail closed and let an operator reconcile it.
  if (!read.ok) {
    console.error(JSON.stringify(snapshotReadDiagnostic(read.reason, randomUUID())));
    return protect(<PortalDashboard email={email} name={null} snapshots={[]} unavailable />);
  }
  return protect(<PortalDashboard email={email} name={null} snapshots={read.snapshots} requestedProject={requestedProject} />);
}
