import assert from "node:assert/strict";
import test from "node:test";
import { numeric, isoDate, formatMoney, formatTimestamp, getDomainLabel, processStatus, getCheckPresentation, getTaskCounts, getTaskDetails, getPaymentPeriods, getTerms, parseSnapshot, parsePublicSnapshot } from "./model.ts";
import { fixturePreviewEnabled } from "./preview.ts";

const now = Date.parse("2026-09-08T12:00:00Z");
const payment = (overrides = {}) => ({
  id: "row-1", component_key: "task", component_label: "Tasks", amount: "100.10", currency: "INR",
  period_start: "2026-08-01", period_end: "2026-08-31", status: "pending", paid_on: null, ...overrides,
});
const period = (rows) => getPaymentPeriods(rows, "2026-09-08")[0];
const snapshot = (domainOverrides = {}, overrides = {}) => ({
  assignment_id: "assignment-test", revision: "run-1", applied_at: "2026-09-01T06:05:00Z",
  verified_at: "2026-09-01T06:01:00Z", source_as_of: "2026-08-31",
  payload: { schema_version: 1, domains: { metrics: {
    state: "verified", revision: "run-1", verified_at: "2026-09-01T06:00:00Z", source_as_of: "2026-08-31",
    value: { submitted: 2, accepted: 1, rejected: 0, rework: 0, evaluation_pending: 1 }, ...domainOverrides,
  } } }, ...overrides,
});

test("Rudder displays General without changing other project domains or source data", () => {
  const rudder = Object.freeze({ project_name: "Rudder", vertical_name: "Coding", domain: "Coding" });
  assert.equal(getDomainLabel(rudder), "General");
  assert.equal(getDomainLabel({ project_name: " Rudder ", vertical_name: "Coding" }), "General");
  assert.equal(rudder.domain, "Coding");
  for (const project_name of ["Terminus", "Otter", "Sentinel Ultra", "SuiteLife", "PaperBench"]) {
    assert.equal(getDomainLabel({ project_name, vertical_name: "Coding", domain: "Python" }), "Coding");
  }
  assert.equal(getDomainLabel({ project_name: "Riga", vertical_name: "STEM", domain: "Chemistry" }), "Chemistry");
  assert.equal(getDomainLabel({ project_name: "Geranium", domain: "Finance" }), "Finance");
  for (const value of [undefined, null, {}, { project_name: "Riga", vertical_name: "STEM" }]) {
    assert.equal(getDomainLabel(value), "Not available");
  }
});

test("strict numbers do not extract digits from corrupt text", () => {
  for (const input of ["", " ", "1O0", "1,00", "12 tasks", "1e3", true, null, Infinity, NaN]) assert.equal(numeric(input), null);
  assert.equal(numeric("0"), 0); assert.equal(numeric("-10.25"), -10.25);
});
test("calendar dates round-trip without timezone shifts", () => {
  assert.equal(isoDate("2026-08-07"), "2026-08-07");
  for (const input of ["07/08/2026", "2026-02-30", "2026-13-01", "2026-8-7", "2026-02-29"]) assert.equal(isoDate(input), null);
  assert.equal(isoDate("2028-02-29"), "2028-02-29");
});
test("unknown money/currency never becomes zero or INR", () => {
  assert.equal(formatMoney(null, "INR"), "Unavailable"); assert.equal(formatMoney(100, null), "Unavailable");
  assert.equal(formatMoney(100, "INVALID"), "Unavailable"); assert.match(formatMoney(0, "INR"), /0\.00/);
});
test("process statuses preserve unknown and explicit negation", () => {
  assert.equal(processStatus(null, "contract"), "Unavailable");
  assert.equal(processStatus("not signed", "contract"), "Not signed");
  assert.equal(processStatus("not verified", "check"), "Not completed");
  assert.equal(processStatus("maybe verified", "check"), "Under review");
  assert.equal(processStatus("awaited", "check"), "In progress");
  assert.equal(processStatus("not_received", "check"), "Not received");
  assert.equal(processStatus("action_required", "check"), "Action required");
});
test("known check results never receive a missing-data badge", () => {
  for (const [raw, expected] of [["not_received", "Not received"], ["action_required", "Action required"], ["exception", "Exception"], ["unrecognized source status", "Under review"]]) {
    const presentation = getCheckPresentation(raw, "check");
    assert.equal(presentation.label, expected);
    assert.equal(presentation.badge, expected);
    assert.equal(presentation.positive, false);
  }
  assert.equal(getCheckPresentation(null, "check").badge, "Unavailable");
  assert.equal(getCheckPresentation("awaited", "check").badge, "Pending");
  assert.equal(getCheckPresentation("signed", "contract").positive, true);
  assert.equal(getCheckPresentation("not_signed", "contract").negative, true);
});
test("SpringVerify awaiting input preserves the approved wording without implying completion or rejection", () => {
  for (const raw of ["Awaiting Input", "awaiting_input", "awaiting-input", "  AWAITING INPUT  "]) {
    assert.equal(processStatus(raw, "check"), "Awaiting input");
    assert.deepEqual(getCheckPresentation(raw, "check"), {
      label: "Awaiting input", badge: "Awaiting input", positive: false, negative: false,
    });
    const input = snapshot();
    input.payload.domains.checks = {
      state: "verified", revision: "run-1", verified_at: "2026-09-01T06:00:00Z", source_as_of: "2026-08-31",
      value: { springverify_status: raw },
    };
    const parsed = parsePublicSnapshot(input, now);
    assert.equal(parsed.domains.checks.value.springverify_status, raw);
    assert.equal(getCheckPresentation(parsed.domains.checks.value.springverify_status, "check").label, "Awaiting input");
  }
  assert.equal(processStatus("awaiting_input", "contract"), "Under review");
  assert.equal(processStatus("awaited", "check"), "In progress");
  assert.equal(processStatus("unknown input status", "check"), "Under review");
});
test("publication times preserve the instant and explicitly label UTC", () => {
  const utc = formatTimestamp("2026-09-17T18:45:12Z");
  assert.equal(formatTimestamp("2026-09-18T00:15:12+05:30"), utc);
  assert.match(utc, /17 Sept? 2026/);
  assert.match(utc, /18:45:12/);
  assert.match(utc, /UTC/);
  for (const value of [null, "", "2026-02-30T12:00:00Z", "2026-09-17"]) assert.equal(formatTimestamp(value), "Unavailable");
});
test("a held domain keeps its verification and cutoff when a later snapshot is published", () => {
  const parsed = parsePublicSnapshot(snapshot({ state: "held" }, {
    revision: "run-2", applied_at: "2026-09-08T06:05:00Z", verified_at: "2026-09-08T06:01:00Z",
  }), now);
  assert.equal(parsed.appliedAt, "2026-09-08T06:05:00Z");
  assert.equal(parsed.domains.metrics.state, "held");
  assert.equal(parsed.domains.metrics.verifiedAt, "2026-09-01T06:00:00Z");
  assert.equal(parsed.domains.metrics.sourceAsOf, "2026-08-31");
  assert.equal(parsed.domains.metrics.revision, "run-1");
});
test("missing counts are unknown and explicit zero is retained", () => {
  assert.equal(getTaskCounts({}).submitted, null);
  assert.equal(getTaskCounts({ accepted: 0 }).accepted, 0);
  for (const submitted of [-1, 1.5, "12 tasks", Number.MAX_SAFE_INTEGER + 1]) assert.equal(getTaskCounts({ submitted }).submitted, null);
});
test("inconsistent count totals are held", () => {
  assert.equal(getTaskCounts({ submitted: 1, accepted: 2 }).submitted, null);
  assert.equal(getTaskCounts({ submitted: 2, accepted: 1, rejected: 0, rework: 0, evaluation_pending: 0 }).accepted, null);
});
test("complete task IDs must reconcile and use explicit known statuses", () => {
  const counts = getTaskCounts({ submitted: 2, accepted: 1, rejected: 0, rework: 0, evaluation_pending: 1 });
  const rows = [{ task_external_id: "A", status: "accepted" }, { task_external_id: "B", status: "pending" }];
  assert.deepEqual(getTaskDetails(rows, counts, true).lists.submitted, ["A", "B"]);
  assert.equal(getTaskDetails(rows, counts, false).lists, null);
  assert.equal(getTaskDetails([rows[0], { task_external_id: "a", status: "pending" }], counts, true).lists, null);
  assert.equal(getTaskDetails([rows[0], { task_external_id: "B", status: "not accepted" }], counts, true).lists, null);
  assert.equal(getTaskDetails(rows.slice(0, 1), counts, true).lists, null);
});
test("August unpaid stays visible with an earning period and no transfer date", () => {
  const p = period([payment()]);
  assert.equal(p.start, "2026-08-01"); assert.equal(p.status, "Not sent");
  assert.equal(p.payable, 100.10); assert.equal(p.paid, 0); assert.equal(p.pending, 100.10); assert.equal(p.sentOn, null);
});
test("explicit zero and negative adjustments remain visible", () => {
  assert.equal(period([payment({ amount: 0 })]).payable, 0);
  assert.equal(period([payment({ amount: -20 })]).payable, -20);
});
test("monetary totals use minor units and separate currencies", () => {
  assert.equal(period([payment({ amount: "0.10" }), payment({ id: "row-2", component_key: "review", amount: "0.20" })]).payable, 0.30);
  assert.equal(getPaymentPeriods([payment(), payment({ currency: "USD" })], "2026-09-08").length, 2);
  assert.equal(period([payment({ currency: "JPY", amount: 1.1 })]).payable, null);
});
test("partial transfers do not imply a fully sent period", () => {
  const p = period([payment({ status: "paid", paid_on: "2026-09-01" }), payment({ id: "row-2", component_key: "review", amount: 20 })]);
  assert.equal(p.status, "Partially sent"); assert.equal(p.paid, 100.10); assert.equal(p.pending, 20); assert.equal(p.sentOn, null);
});
test("future, invalid, missing and conflicting transfer dates are held", () => {
  for (const paid_on of ["2028-08-07", "2026-02-30", null]) {
    const p = period([payment({ status: "paid", paid_on })]); assert.equal(p.payable, null); assert.equal(p.status, "Under review");
  }
  assert.equal(period([payment({ paid_on: "2026-09-01" })]).payable, null);
});
test("unknown periods, status, currency and malformed amount cannot produce totals", () => {
  for (const patch of [{ period_end: null }, { period_end: "2026-07-31" }, { status: "not paid yet maybe" }, { currency: null }, { amount: "1O0" }, { amount: 1.001 }]) {
    const p = period([payment(patch)]); assert.equal(p.payable, null); assert.ok(p.issues.length);
  }
});
test("missing or duplicate logical identities are held even with different row IDs", () => {
  assert.equal(period([payment({ component_key: null })]).payable, null);
  assert.equal(period([payment(), payment({ id: "other-row" })]).payable, null);
  assert.equal(period([payment(), payment({ component_key: "review" })]).payable, null);
});
test("gross and deduction must reconcile with net; missing pairs are not assumed zero", () => {
  assert.equal(period([payment({ amount: 90, gross_amount: 100, tds_amount: 10 })]).payable, 90);
  for (const patch of [{ gross_amount: 100 }, { tds_amount: 10 }, { gross_amount: 100, tds_amount: 10 }, { gross_amount: 100, tds_amount: -0.1 }]) assert.equal(period([payment(patch)]).payable, null);
});
test("malformed detail rates and quantities are held", () => {
  for (const patch of [{ quantity: "abc" }, { rate_amount: -1, rate_currency: "INR" }, { rate_amount: 5 }, { breakdown: [{ label: "Tasks", quantity: "bad" }] }]) assert.equal(period([payment(patch)]).payable, null);
});
test("overflowing totals are unavailable", () => {
  assert.equal(period([payment({ amount: Number.MAX_SAFE_INTEGER })]).payable, null);
});
test("snapshot contract is schema-versioned and never reads legacy values", () => {
  assert.equal(parseSnapshot({ task_metrics: { accepted: 10 } }, now), null);
  assert.equal(parseSnapshot(snapshot({}, { revision: "" }), now), null);
  assert.equal(parseSnapshot(snapshot({}, { payload: { schema_version: "1" } }), now), null);
  const p = parseSnapshot(snapshot(), now);
  assert.equal(p.domains.metrics.state, "verified"); assert.equal(p.domains.payments.state, "unavailable");
});
test("invalid or future publication and verification metadata is rejected", () => {
  for (const applied_at of ["2026-02-30T00:00:00Z", "2030-01-01T00:00:00Z", "2026-09-01T24:00:00Z"]) assert.equal(parseSnapshot(snapshot({}, { applied_at }), now), null);
  for (const patch of [{ verified_at: "2026-02-30T00:00:00Z" }, { verified_at: "2026-09-02T00:00:00Z" }, { revision: null }, { source_as_of: "2028-08-07" }, { source_as_of: "2026-02-30" }]) assert.equal(parseSnapshot(snapshot(patch), now).domains.metrics.state, "unavailable");
});
test("held domains require previous verified provenance; malformed domain values disappear", () => {
  assert.equal(parseSnapshot(snapshot({ state: "held" }), now).domains.metrics.state, "held");
  assert.equal(parseSnapshot(snapshot({ state: "held", verified_at: null }), now).domains.metrics.value, null);
  assert.equal(parseSnapshot(snapshot({ value: { submitted: 1, accepted: 2 } }), now).domains.metrics.state, "unavailable");
});
test("snapshot envelope verification and source cutoff must be valid and ordered", () => {
  for (const verified_at of [undefined, null, "", "2026-02-30T00:00:00Z", "2026-09-01T06:06:00Z"]) assert.equal(parseSnapshot(snapshot({}, { verified_at }), now), null);
  for (const source_as_of of ["2026-02-30", "2026-09-02", "yesterday"]) assert.equal(parseSnapshot(snapshot({}, { source_as_of }), now), null);
  assert.ok(parseSnapshot(snapshot({}, { source_as_of: null }), now));
  assert.equal(parseSnapshot(snapshot({ verified_at: "2026-09-01T06:02:00Z" }), now).domains.metrics.state, "unavailable");
});
test("invalid payment terms cannot be displayed as agreed rates", () => {
  const term = { label: "Task", amount: 100, currency: "INR", is_specified: true };
  assert.equal(getTerms([term]).length, 1);
  for (const patch of [{ amount: -1 }, { currency: null }, { minimum_amount: 100, maximum_amount: 200 }, { amount: null, minimum_amount: 200, maximum_amount: 100 }]) assert.deepEqual(getTerms([{ ...term, ...patch }]), []);
});
test("synthetic preview cannot bypass authentication in production", () => {
  assert.equal(fixturePreviewEnabled("development", "true"), true);
  for (const env of ["production", "test", undefined]) assert.equal(fixturePreviewEnabled(env, "true"), false);
  assert.equal(fixturePreviewEnabled("development", "false"), false);
});

test("public snapshots remove financial data before any page serialization", () => {
  const input = snapshot();
  const domain = (value) => ({ ...input.payload.domains.metrics, value });
  input.payload.domains.assignment = domain({ project_name: "Riga", full_name: "Test Candidate", email: "test@example.com", domain: "Chemistry", rate_amount: "private-rate", rate_currency: "INR", hidden: "private-extra" });
  input.payload.domains.checks = domain({ contract_status: "signed", springverify_status: "done", remofirst_status: "approved", payment_status: "private-status" });
  input.payload.domains.payments = domain([{ amount: "private-amount" }]);
  input.payload.domains.terms = domain([{ label: "private-terms" }]);
  input.payload.domains.task_events = domain({ complete: true, rows: [{ task_external_id: "A", status: "accepted", rate_amount: "private-task-rate" }] });
  input.extra = "private-envelope";
  const output = parsePublicSnapshot(input, now);
  assert.ok(output);
  assert.equal(output.domains.assignment.value.full_name, "Test Candidate");
  assert.equal(output.domains.assignment.value.domain, "Chemistry");
  assert.equal(output.domains.checks.value.contract_status, "signed");
  assert.equal(output.domains.payments.state, "unavailable");
  assert.equal(output.domains.terms.state, "unavailable");
  assert.doesNotMatch(JSON.stringify(output), /private-|rate_amount|rate_currency|payment_status/);
  assert.equal(input.payload.domains.assignment.value.rate_amount, "private-rate");
  input.payload.domains.assignment.value.domain = { amount: "private-nested-rate" };
  assert.doesNotMatch(JSON.stringify(parsePublicSnapshot(input, now)), /private-nested/);
});

test("public snapshot filtering does not relax publication validation", () => {
  assert.equal(parsePublicSnapshot(snapshot({}, { revision: "" }), now), null);
  assert.equal(parsePublicSnapshot(snapshot({}, { applied_at: "2030-01-01T00:00:00Z" }), now), null);
  assert.equal(parsePublicSnapshot(snapshot({ value: { submitted: 1, accepted: 2 } }), now).domains.metrics.state, "unavailable");
});
