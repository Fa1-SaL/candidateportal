import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAppOrigin } from "@/lib/auth/redirects";
import { authenticationUnavailable } from "@/lib/auth/errors";
import LoginForm from "./login-form";
import Maintenance from "../maintenance";
import { PORTAL_UNDER_MAINTENANCE } from "@/lib/portal/maintenance";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: {
  searchParams: Promise<{ auth_error?: string | string[] }>;
}) {
  if (PORTAL_UNDER_MAINTENANCE) return <Maintenance />;
  const params = await searchParams;
  const code = Array.isArray(params.auth_error) ? params.auth_error[0] : params.auth_error;
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (authenticationUnavailable(error)) throw new Error("Authentication service unavailable");
  if (user) redirect("/");
  // Configuration, not a forwarded/request host, chooses the email destination.
  const origin = getAppOrigin(new URL(process.env.NODE_ENV === "development" ? "http://localhost:3000" : "https://candidate.crossinghurdles.com"));
  return <main id="main-content" className="login-main"><LoginForm callbackUrl={origin + "/auth/callback"} authError={code === "verification_failed"} /></main>;
}
