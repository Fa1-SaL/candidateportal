/** Candidate-facing values come only from an explicitly published snapshot.
 * Unknown is never converted to zero, a negative process status, or a currency.
 * This module has no network/runtime dependencies so the contract is testable. */
export type DomainState = "verified" | "held" | "unavailable";
export type Domain = { state: DomainState; revision: string | null; verifiedAt: string | null; sourceAsOf: string | null; value: unknown };
export type TaskCounts = { submitted: number | null; accepted: number | null; rejected: number | null; rework: number | null; evaluationPending: number | null };
export type TaskBucket = keyof TaskCounts;
export type TaskLists = Record<TaskBucket, string[]>;
export type TaskDetails = { lists: TaskLists | null; message: string };
export type PaymentDetail = { key: string; label: string; quantity: number | null; rateAmount: number | null; rateCurrency: string | null };
export type PaymentLine = {
  key: string; label: string; amount: number | null; currency: string | null;
  status: string; paidOn: string | null; quantity: number | null;
  rateAmount: number | null; rateCurrency: string | null;
  grossAmount: number | null; tdsAmount: number | null; details: PaymentDetail[];
};
export type PaymentPeriod = {
  key: string; label: string; start: string | null; end: string | null; currency: string | null;
  payable: number | null; paid: number | null; pending: number | null;
  status: string; sentOn: string | null; lines: PaymentLine[]; issues: string[];
};
export type PaymentTerm = { id: string; label: string; amount: number | null; minimum_amount: number | null; maximum_amount: number | null; currency: string | null; unit: string | null; is_specified: boolean; display_order: number };
export type PortalSnapshot = {
  assignmentId: string; revision: string; appliedAt: string;
  domains: Record<"assignment" | "checks" | "metrics" | "task_events" | "payments" | "terms", Domain>;
};
export const TASK_LABELS: Record<TaskBucket, string> = { submitted: "Submitted", accepted: "Accepted", rejected: "Rejected", rework: "Rework", evaluationPending: "Evaluation pending" };

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
export function getDomainLabel(value: unknown): string {
  const assignment = record(value);
  if (text(assignment.project_name) === "Rudder") return "General";
  return text(assignment.vertical_name) === "Coding" ? "Coding" : text(assignment.domain) ?? "Not available";
}
export function numeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
export function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(time.getTime()) && time.toISOString().slice(0, 10) === value ? value : null;
}
function timestamp(value: unknown): string | null {
  const input = text(value);
  if (!input || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(input) || !isoDate(input.slice(0, 10))) return null;
  const parts = input.slice(11, 19).split(":").map(Number);
  return parts[0] < 24 && parts[1] < 60 && parts[2] < 60 && Number.isFinite(Date.parse(input)) ? input : null;
}
const currencies = new Set(Intl.supportedValuesOf("currency"));
export function currencyCode(value: unknown): string | null {
  const input = text(value)?.toUpperCase();
  return input && currencies.has(input) ? input : null;
}
export function formatMoney(amount: number | null, currency: string | null): string {
  const code = currencyCode(currency);
  if (amount === null || !Number.isFinite(amount) || !code) return "Unavailable";
  return new Intl.NumberFormat(code === "INR" ? "en-IN" : "en-US", { style: "currency", currency: code }).format(amount);
}
export function formatDate(value: string | null): string {
  const date = isoDate(value);
  return date ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`)) : "Unavailable";
}
export function processStatus(value: unknown, kind: "contract" | "check"): string {
  const input = text(value)?.toLowerCase().replace(/[_-]/g, " ");
  if (!input) return "Unavailable";
  const positives = kind === "contract" ? ["signed"] : ["done", "verified", "approved"];
  const negatives = kind === "contract" ? ["not signed", "unsigned"] : ["not verified", "not approved", "failed", "rejected"];
  if (positives.includes(input)) return kind === "contract" ? "Signed" : "Completed";
  if (negatives.includes(input)) return kind === "contract" ? "Not signed" : "Not completed";
  if (["pending", "in progress", "sent", "processing", "awaiting signature", "awaited"].includes(input)) return "In progress";
  if (kind === "check" && input === "not received") return "Not received";
  if (kind === "check" && input === "action required") return "Action required";
  return "Under review";
}
export function getTaskCounts(value: unknown): TaskCounts {
  const row = record(value);
  const count = (key: string) => { const n = numeric(row[key]); return n !== null && Number.isSafeInteger(n) && n >= 0 ? n : null; };
  const counts = { submitted: count("submitted"), accepted: count("accepted"), rejected: count("rejected"), rework: count("rework"), evaluationPending: count("evaluation_pending") };
  const parts = [counts.accepted, counts.rejected, counts.rework, counts.evaluationPending];
  const knownTotal = parts.reduce<number>((sum, n) => sum + (n ?? 0), 0);
  if (counts.submitted !== null && (knownTotal > counts.submitted || (parts.every(n => n !== null) && knownTotal !== counts.submitted))) {
    return { submitted: null, accepted: null, rejected: null, rework: null, evaluationPending: null };
  }
  return counts;
}
export function getTaskDetails(value: unknown, counts: TaskCounts, complete: boolean): TaskDetails {
  const unavailable = (message: string): TaskDetails => ({ lists: null, message });
  if (!complete || !Array.isArray(value)) return unavailable("Task-level details are unavailable for this snapshot. Your project may provide summary counts only.");
  const lists: TaskLists = { submitted: [], accepted: [], rejected: [], rework: [], evaluationPending: [] };
  const seen = new Set<string>();
  for (const item of value) {
    const row = record(item); const id = text(row.task_external_id); const status = text(row.status)?.toLowerCase();
    if (!id || seen.has(id.toLowerCase())) return unavailable("Task details are under review because their identities do not reconcile.");
    seen.add(id.toLowerCase()); lists.submitted.push(id);
    if (["accepted", "approved", "provisionally accepted"].includes(status ?? "")) lists.accepted.push(id);
    else if (["rejected", "invalid"].includes(status ?? "")) lists.rejected.push(id);
    else if (["needs revision", "needs_revision", "rework", "requiring rework"].includes(status ?? "")) lists.rework.push(id);
    else if (["pending", "submitted", "evaluation pending", "evaluation_pending", "in review", "in_review"].includes(status ?? "")) lists.evaluationPending.push(id);
    else return unavailable("Task details are under review because a status is not recognised.");
  }
  if ((Object.keys(lists) as TaskBucket[]).some(key => counts[key] === null || lists[key].length !== counts[key])) return unavailable("Task details are under review because the IDs and summary do not reconcile.");
  return { lists, message: "Task IDs reconcile with this published summary." };
}

function minorUnits(value: unknown, currency: string | null): number | null {
  const amount = numeric(value);
  if (amount === null || !currency) return null;
  const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  const scaled = amount * 10 ** digits; const rounded = Math.round(scaled);
  return Number.isSafeInteger(rounded) && Math.abs(scaled - rounded) < 0.000001 ? rounded : null;
}
function paymentStatus(value: unknown): string {
  const status = text(value)?.toLowerCase();
  if (["paid", "sent", "disbursed"].includes(status ?? "")) return "Sent";
  if (["pending", "unpaid", "not sent", "not_sent", "scheduled"].includes(status ?? "")) return "Not sent";
  if (["processing", "in progress"].includes(status ?? "")) return "Processing";
  if (["held", "on hold"].includes(status ?? "")) return "On hold";
  return "Under review";
}
export function getPaymentPeriods(value: unknown, today = new Date().toISOString().slice(0, 10)): PaymentPeriod[] {
  if (!Array.isArray(value)) return [];
  const groups = new Map<string, { period: PaymentPeriod; payable: number; paid: number; unsent: boolean; sent: boolean; invalid: boolean; keys: Set<string> }>();
  value.forEach((item, index) => {
    const row = record(item); const start = isoDate(row.period_start); const end = isoDate(row.period_end); const currency = currencyCode(row.currency);
    const validPeriod = !!start && !!end && start <= end;
    const key = `${start ?? "unknown"}:${end ?? "unknown"}:${currency ?? "unknown"}`;
    if (!groups.has(key)) groups.set(key, { period: { key, label: validPeriod ? `${formatDate(start)} – ${formatDate(end)}` : "Earning period unavailable", start, end, currency, payable: null, paid: null, pending: null, status: "Under review", sentOn: null, lines: [], issues: [] }, payable: 0, paid: 0, unsent: false, sent: false, invalid: false, keys: new Set() });
    const group = groups.get(key)!; const status = paymentStatus(row.status); const paidOn = isoDate(row.paid_on); const units = minorUnits(row.amount, currency);
    const component = text(row.component_key) ?? text(row.reference);
    const identityKeys = [text(row.id) ? "id:" + text(row.id) : null, component ? "component:" + component : null].filter((key): key is string => key !== null);
    const issue = (message: string) => { group.invalid = true; if (!group.period.issues.includes(message)) group.period.issues.push(message); };
    if (!validPeriod) issue("The earning period needs confirmation.");
    if (!currency) issue("The currency needs confirmation.");
    if (units === null) issue("An amount is missing or has unsupported precision.");
    if (status === "Under review") issue("A payment status needs confirmation.");
    if (!component) issue("A stable payment component identity needs confirmation.");
    if (identityKeys.some(identity => group.keys.has(identity))) issue("A duplicate payment component needs review.");
    identityKeys.forEach(identity => group.keys.add(identity));
    if (status === "Sent" && (!paidOn || paidOn > today)) issue("A sent payment needs a valid, non-future transfer date.");
    if (status !== "Sent" && row.paid_on != null && row.paid_on !== "") issue("The payment status and transfer date disagree.");
    if (units !== null) { group.payable += units; if (status === "Sent") group.paid += units; }
    if (!Number.isSafeInteger(group.payable) || !Number.isSafeInteger(group.paid) || !Number.isSafeInteger(group.payable - group.paid)) issue("The total exceeds the supported precision.");
    group.sent ||= status === "Sent"; group.unsent ||= status !== "Sent";
    if (status === "Sent" && paidOn && (!group.period.sentOn || paidOn > group.period.sentOn)) group.period.sentOn = paidOn;
    const gross = minorUnits(row.gross_amount, currency); const tds = minorUnits(row.tds_amount, currency);
    if ((row.gross_amount != null || row.tds_amount != null) && (gross === null || tds === null || units === null || tds < 0 || gross - tds !== units)) issue("Gross, deduction and net amounts do not reconcile.");
    const invalidOptionalNumber = (value: unknown, nonnegative = false) => value != null && (numeric(value) === null || Math.abs(numeric(value)!) > Number.MAX_SAFE_INTEGER || (nonnegative && numeric(value)! < 0));
    if (invalidOptionalNumber(row.quantity) || invalidOptionalNumber(row.rate_amount, true) || (row.rate_amount != null && !currencyCode(row.rate_currency))) issue("A quantity or rate needs confirmation.");
    const details = Array.isArray(row.breakdown) ? row.breakdown.flatMap((detail, i) => {
      const d = record(detail); const label = text(d.label);
      if (!label || invalidOptionalNumber(d.quantity) || invalidOptionalNumber(d.rate_amount, true) || (d.rate_amount != null && !currencyCode(d.rate_currency))) issue("A breakdown quantity or rate needs confirmation.");
      return label ? [{ key: text(d.key) ?? String(i), label, quantity: numeric(d.quantity), rateAmount: numeric(d.rate_amount), rateCurrency: currencyCode(d.rate_currency) }] : [];
    }) : [];
    group.period.lines.push({ key: `${component ?? "payment"}:${index}`, label: text(row.component_label) ?? text(row.reference) ?? "Payment", amount: numeric(row.amount), currency, status, paidOn, quantity: numeric(row.quantity), rateAmount: numeric(row.rate_amount), rateCurrency: currencyCode(row.rate_currency), grossAmount: numeric(row.gross_amount), tdsAmount: numeric(row.tds_amount), details });
  });
  return [...groups.values()].map(group => {
    const period = group.period;
    if (!group.invalid && period.currency) {
      const digits = new Intl.NumberFormat("en", { style: "currency", currency: period.currency }).resolvedOptions().maximumFractionDigits ?? 2;
      period.payable = group.payable / 10 ** digits; period.paid = group.paid / 10 ** digits; period.pending = (group.payable - group.paid) / 10 ** digits;
      period.status = group.sent && group.unsent ? "Partially sent" : group.sent ? "Sent" : period.lines.some(line => line.status === "On hold") ? "On hold" : period.lines.some(line => line.status === "Processing") ? "Processing" : "Not sent";
    }
    if (group.unsent || group.invalid) period.sentOn = null;
    return period;
  }).sort((a, b) => (b.end ?? "").localeCompare(a.end ?? "") || a.key.localeCompare(b.key));
}

const DOMAIN_NAMES = ["assignment", "checks", "metrics", "task_events", "payments", "terms"] as const;
// Release boundary: allow only non-financial fields before rendering or serialization.
// Stored financial domains remain intact and can be reintroduced after approval.
export function parsePublicSnapshot(value: unknown, now = Date.now()): PortalSnapshot | null {
  const row = record(value);
  const payload = record(row.payload);
  const raw = record(payload.domains);
  const pick = (value: unknown, fields: string[]) => Object.fromEntries(
    fields.filter(field => Object.hasOwn(record(value), field)).map(field => {
      const scalar = record(value)[field];
      return [field, scalar == null || ["string", "number", "boolean"].includes(typeof scalar) ? scalar : null];
    }),
  );
  const domain = (name: string, fields: string[]) => {
    const source = record(raw[name]);
    return { ...pick(source, ["state", "revision", "verified_at", "source_as_of"]), value: pick(source.value, fields) };
  };
  const tasks = domain("task_events", ["complete"]);
  const taskRows = record(record(raw.task_events).value).rows;
  tasks.value.rows = Array.isArray(taskRows) ? taskRows.map(task => pick(task, ["task_external_id", "status"])) : null;
  return parseSnapshot({
    ...pick(row, ["assignment_id", "revision", "applied_at", "verified_at", "source_as_of"]),
    payload: { schema_version: payload.schema_version, domains: {
      assignment: domain("assignment", ["project_name", "client_name", "vertical_name", "domain", "full_name", "email", "assignment_status"]),
      checks: domain("checks", ["contract_status", "springverify_status", "remofirst_status"]),
      metrics: domain("metrics", ["submitted", "accepted", "rejected", "rework", "evaluation_pending"]),
      task_events: tasks,
      payments: { state: "unavailable" }, terms: { state: "unavailable" },
    } },
  }, now);
}

export function parseSnapshot(value: unknown, now = Date.now()): PortalSnapshot | null {
  const row = record(value); const payload = record(row.payload); const appliedAt = timestamp(row.applied_at);
  const envelopeVerifiedAt = timestamp(row.verified_at);
  const envelopeCutoff = row.source_as_of == null ? null : isoDate(row.source_as_of);
  const assignmentId = text(row.assignment_id); const revision = text(row.revision);
  if (!assignmentId || !revision || !appliedAt || Date.parse(appliedAt) > now || !envelopeVerifiedAt || Date.parse(envelopeVerifiedAt) > Date.parse(appliedAt) || (row.source_as_of != null && (!envelopeCutoff || envelopeCutoff > new Date(envelopeVerifiedAt).toISOString().slice(0, 10))) || payload.schema_version !== 1) return null;
  const rawDomains = record(payload.domains);
  const domains = {} as PortalSnapshot["domains"];
  for (const name of DOMAIN_NAMES) {
    const raw = record(rawDomains[name]); const state = raw.state; const verifiedAt = timestamp(raw.verified_at); const domainRevision = text(raw.revision);
    const cutoff = raw.source_as_of == null ? null : isoDate(raw.source_as_of);
    const valid = (state === "verified" || state === "held") && verifiedAt && domainRevision && Date.parse(verifiedAt) <= Date.parse(envelopeVerifiedAt) && (raw.source_as_of == null || (cutoff && cutoff <= new Date(verifiedAt).toISOString().slice(0, 10))) && validDomainValue(name, raw.value);
    domains[name] = valid ? { state, revision: domainRevision, verifiedAt, sourceAsOf: isoDate(raw.source_as_of), value: raw.value ?? null } : { state: "unavailable", revision: null, verifiedAt: null, sourceAsOf: null, value: null };
  }
  return { assignmentId, revision, appliedAt, domains };
}
export function getTerms(value: unknown): PaymentTerm[] {
  return Array.isArray(value) && value.every(validTerm) ? value.map((item, i) => { const r = record(item); return { id: text(r.id) ?? String(i), label: text(r.label) ?? "Payment term", amount: numeric(r.amount), minimum_amount: numeric(r.minimum_amount), maximum_amount: numeric(r.maximum_amount), currency: currencyCode(r.currency), unit: text(r.unit), is_specified: r.is_specified === true, display_order: numeric(r.display_order) ?? i }; }).sort((a, b) => a.display_order - b.display_order) : [];
}

function validRate(value: unknown) {
  const n = numeric(value);
  return n !== null && n >= 0 && n <= Number.MAX_SAFE_INTEGER;
}
function validTerm(value: unknown): boolean {
  const r = record(value);
  if (!text(r.label) || typeof r.is_specified !== "boolean") return false;
  if (!r.is_specified) return true;
  if (!currencyCode(r.currency)) return false;
  const hasAmount = r.amount != null; const hasRange = r.minimum_amount != null || r.maximum_amount != null;
  if (hasAmount === hasRange) return false;
  return hasAmount ? validRate(r.amount) : validRate(r.minimum_amount) && validRate(r.maximum_amount) && numeric(r.minimum_amount)! <= numeric(r.maximum_amount)!;
}
function validDomainValue(name: typeof DOMAIN_NAMES[number], value: unknown): boolean {
  if (name === "payments") return Array.isArray(value);
  if (name === "terms") return Array.isArray(value) && value.every(validTerm);
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = record(value);
  if (name === "assignment") return !!text(r.project_name) && (r.rate_amount == null || (validRate(r.rate_amount) && !!currencyCode(r.rate_currency)));
  if (name === "metrics") {
    const counts = getTaskCounts(value);
    const mapping = { submitted: "submitted", accepted: "accepted", rejected: "rejected", rework: "rework", evaluationPending: "evaluation_pending" } as const;
    return (Object.keys(mapping) as TaskBucket[]).every(key => r[mapping[key]] == null || counts[key] !== null);
  }
  if (name === "task_events") return typeof r.complete === "boolean" && Array.isArray(r.rows);
  return true;
}
