import assert from "node:assert/strict";
import test from "node:test";
import { inspectSnapshotRead, snapshotReadDiagnostic } from "./snapshot-read.ts";

const parse = row => row.valid ? { assignmentId: "synthetic" } : null;
const read = overrides => inspectSnapshotRead({ data: [], count: 0, error: null, ...overrides }, parse);

test("snapshot read preserves an explicit complete empty result", () => {
  assert.deepEqual(read({}), { ok: true, snapshots: [] });
});

test("snapshot read distinguishes failure reasons without exposing database detail", () => {
  const secretError = { message: "private@example.invalid", details: "credential=secret" };
  assert.deepEqual(read({ error: secretError }), { ok: false, reason: "SNAPSHOT_QUERY_FAILED" });
  for (const count of [null, undefined, -1, 1.5, NaN, "0"])
    assert.equal(read({ count }).reason, "SNAPSHOT_COUNT_UNAVAILABLE");
  assert.equal(read({ count: 51 }).reason, "SNAPSHOT_LIMIT_EXCEEDED");
  assert.equal(read({ data: null }).reason, "SNAPSHOT_ROWS_INVALID");
  assert.equal(read({ count: 1 }).reason, "SNAPSHOT_COUNT_MISMATCH");
});

test("a malformed row rejects the entire snapshot result without partial fallback", () => {
  assert.deepEqual(read({ count: 2, data: [{ valid: true }, { valid: false }] }),
    { ok: false, reason: "SNAPSHOT_PAYLOAD_INVALID" });
  assert.deepEqual(inspectSnapshotRead({ count: 1, data: [{}], error: null }, () => { throw new Error("private detail"); }),
    { ok: false, reason: "SNAPSHOT_PAYLOAD_INVALID" });
});

test("a complete supported result is returned after all rows validate", () => {
  const result = read({ count: 50, data: Array.from({ length: 50 }, () => ({ valid: true })) });
  assert.equal(result.ok, true);
  assert.equal(result.snapshots.length, 50);
});

test("diagnostics are restricted to event, reason and generated correlation identifier", () => {
  assert.deepEqual(snapshotReadDiagnostic("SNAPSHOT_QUERY_FAILED", "synthetic-correlation"), {
    event: "portal_snapshot_unavailable", reason: "SNAPSHOT_QUERY_FAILED", correlation_id: "synthetic-correlation",
  });
});
