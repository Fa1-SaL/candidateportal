import Maintenance from "./maintenance";
import { PORTAL_UNDER_MAINTENANCE } from "@/lib/portal/maintenance";

export default function Loading() {
  if (PORTAL_UNDER_MAINTENANCE) return <Maintenance />;
  return <main id="main-content" className="login-main" aria-busy="true">
    <section className="panel empty-state" role="status"><h1>Loading your verified records…</h1><p>No changes are being made to your information.</p></section>
  </main>;
}
