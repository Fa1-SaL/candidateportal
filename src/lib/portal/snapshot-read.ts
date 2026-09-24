import type { PortalSnapshot } from "./model";

export type SnapshotReadFailure =
  | "SNAPSHOT_QUERY_FAILED"
  | "SNAPSHOT_COUNT_UNAVAILABLE"
  | "SNAPSHOT_LIMIT_EXCEEDED"
  | "SNAPSHOT_ROWS_INVALID"
  | "SNAPSHOT_COUNT_MISMATCH"
  | "SNAPSHOT_PAYLOAD_INVALID";

type SnapshotReadResult =
  | { ok: true; snapshots: PortalSnapshot[] }
  | { ok: false; reason: SnapshotReadFailure };

// Keep database errors/payloads out of the result and operational log. A complete,
// candidate-scoped result is still required; diagnostic detail must not weaken it.
export function inspectSnapshotRead(
  result: { data: unknown; count: unknown; error: unknown },
  parse: (row: unknown) => PortalSnapshot | null,
): SnapshotReadResult {
  if (result.error) return { ok: false, reason: "SNAPSHOT_QUERY_FAILED" };
  if (typeof result.count !== "number" || !Number.isSafeInteger(result.count) || result.count < 0)
    return { ok: false, reason: "SNAPSHOT_COUNT_UNAVAILABLE" };
  if (result.count > 50) return { ok: false, reason: "SNAPSHOT_LIMIT_EXCEEDED" };
  if (!Array.isArray(result.data)) return { ok: false, reason: "SNAPSHOT_ROWS_INVALID" };
  if (result.count !== result.data.length) return { ok: false, reason: "SNAPSHOT_COUNT_MISMATCH" };
  const snapshots: PortalSnapshot[] = [];
  for (const row of result.data) {
    try {
      const snapshot = parse(row);
      if (!snapshot) return { ok: false, reason: "SNAPSHOT_PAYLOAD_INVALID" };
      snapshots.push(snapshot);
    } catch {
      return { ok: false, reason: "SNAPSHOT_PAYLOAD_INVALID" };
    }
  }
  return { ok: true, snapshots };
}

export function snapshotReadDiagnostic(reason: SnapshotReadFailure, correlationId: string) {
  return { event: "portal_snapshot_unavailable", reason, correlation_id: correlationId };
}
