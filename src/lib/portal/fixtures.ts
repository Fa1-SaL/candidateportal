// Synthetic fixtures. Imported only by the development-only preview route/tests.
import { parseSnapshot, type PortalSnapshot } from "./model";
const verifiedAt = "2026-09-01T06:00:00Z";
export function previewSnapshots(): PortalSnapshot[] {
  return ["Riga", "Terminus", "Rudder"].map((name, index) => {
    const revision = "synthetic-revision-1";
    const domain = (value: unknown, state = "verified") => ({ state, revision, verified_at: verifiedAt, source_as_of: "2026-08-31", value });
    const total = index ? 8 : 12; const accepted = index ? 4 : 8;
    const events = Array.from({ length: total }, (_, i) => ({ task_external_id: "DEMO-" + name.toUpperCase() + "-" + String(i + 1).padStart(3, "0"), status: i < accepted ? "accepted" : i === accepted ? "rejected" : i === accepted + 1 ? "rework" : "pending" }));
    const payment = (key: string, amount: number, month: string, status: string, paidOn: string | null, quantity: number | null, rate: number | null) => ({
      id: month + "-" + key, component_key: key, component_label: key === "review" ? "Review" : "Approved tasks",
      period_start: "2026-" + month + "-01", period_end: "2026-" + month + "-31",
      amount, currency: "INR", status, paid_on: paidOn, quantity, rate_amount: rate, rate_currency: "INR",
      gross_amount: amount, tds_amount: 0, breakdown: [{ key: "approved", label: "Per approved task", quantity, rate_amount: rate, rate_currency: "INR" }],
    });
    return parseSnapshot({
      assignment_id: "demo-" + name.toLowerCase(), revision, applied_at: "2026-09-01T06:05:00Z",
      verified_at: verifiedAt, source_as_of: "2026-08-31",
      payload: { schema_version: 1, domains: {
        assignment: domain({ project_name: name, vertical_name: index ? "Coding" : "STEM", client_name: "Snorkel", domain: index ? "Python" : "Research", rate_amount: index ? 8000 : 12000, rate_currency: "INR", rate_unit: "approved task" }),
        checks: domain({ contract_status: index ? null : "signed", springverify_status: "verified", remofirst_status: index ? "in progress" : "approved" }),
        metrics: domain({ submitted: total, accepted, rejected: 1, rework: 1, evaluation_pending: total - accepted - 2 }),
        task_events: domain({ complete: true, rows: events }),
        payments: domain([
          payment("task", 0, "08", "pending", null, null, null),
          payment("task", index ? 32000 : 96000, "07", "paid", "2026-09-01", accepted, index ? 8000 : 12000),
          ...(index ? [payment("review", 2000, "07", "paid", "2026-09-01", 2, 1000)] : []),
        ], index ? "held" : "verified"),
        terms: domain([{ id: "task", label: "Approved task", amount: index ? 8000 : 12000, currency: "INR", unit: "task", is_specified: true, display_order: 0 }, ...(index ? [{ id: "review", label: "Review", amount: 1000, currency: "INR", unit: "review", is_specified: true, display_order: 1 }] : [])]),
      } },
    })!;
  });
}
