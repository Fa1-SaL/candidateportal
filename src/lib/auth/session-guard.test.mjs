import assert from "node:assert/strict";
import test from "node:test";
import { createSessionGuard } from "./session-guard.ts";

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function harness(verifyIdentity, timeoutMs = 1000) {
  const states = []; let concealed = 0; let departures = 0;
  const guard = createSessionGuard({ expectedUserId: "account-A", verifyIdentity, timeoutMs,
    state: state => states.push(state), conceal: () => concealed++, leave: () => departures++ });
  return { guard, states, get concealed() { return concealed; }, get departures() { return departures; } };
}
const own = { userId: "account-A", unavailable: false };
test("only a fresh matching server identity reveals the dashboard", async () => {
  const h = harness(async () => own); await h.guard.check();
  assert.deepEqual(h.states, ["checking", "ready"]); assert.equal(h.concealed, 1); assert.equal(h.departures, 0); h.guard.dispose();
});
test("missing and switched identities leave without revealing", async () => {
  for (const userId of [null, "account-B"]) {
    const h = harness(async () => ({ userId, unavailable: false })); await h.guard.check();
    assert.equal(h.departures, 1); assert.ok(!h.states.includes("ready")); h.guard.dispose();
  }
});
test("network errors conceal without pretending the user signed out; retry recovers", async () => {
  let unavailable = true; const h = harness(async () => ({ ...own, unavailable }));
  await h.guard.check(); assert.equal(h.states.at(-1), "unavailable"); assert.equal(h.departures, 0);
  unavailable = false; await h.guard.check(); assert.equal(h.states.at(-1), "ready"); h.guard.dispose();
});
test("throwing and timed out identity checks remain hidden", async () => {
  for (const verify of [async () => { throw new Error("offline"); }, () => new Promise(() => {})]) {
    const h = harness(verify, 5); await h.guard.check();
    assert.equal(h.states.at(-1), "unavailable"); assert.equal(h.departures, 0); assert.ok(!h.states.includes("ready")); h.guard.dispose();
  }
});
test("sign-out and account switches synchronously conceal and invalidate late results", async () => {
  for (const [event, userId] of [["SIGNED_OUT", null], ["SIGNED_IN", "account-B"], ["INITIAL_SESSION", null]]) {
    const pending = deferred(); const h = harness(() => pending.promise); const checked = h.guard.check();
    h.guard.authChanged(event, userId); assert.equal(h.departures, 1); assert.equal(h.concealed, 2);
    pending.resolve(own); await checked; assert.ok(!h.states.includes("ready"));
    h.guard.authChanged(event, userId); assert.equal(h.departures, 1); h.guard.dispose();
  }
});
test("matching auth events never reveal or start asynchronous auth calls", () => {
  let calls = 0; const h = harness(async () => { calls++; return own; });
  for (const event of ["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED", "USER_UPDATED"]) h.guard.authChanged(event, "account-A");
  assert.equal(calls, 0); assert.deepEqual(h.states, []); h.guard.dispose();
});
test("page hiding invalidates an in-flight check until a fresh check passes", async () => {
  const pending = deferred(); let count = 0; const h = harness(() => ++count === 1 ? pending.promise : Promise.resolve(own));
  const checked = h.guard.check(); h.guard.pause(); pending.resolve(own); await checked;
  assert.ok(!h.states.includes("ready")); await h.guard.check(); assert.equal(h.states.at(-1), "ready"); h.guard.dispose();
});
test("newer check wins and a disposed controller cannot reveal content", async () => {
  const pending = deferred(); let count = 0; const h = harness(() => ++count === 1 ? pending.promise : Promise.resolve({ ...own, unavailable: true }));
  const first = h.guard.check(); await h.guard.check(); pending.resolve(own); await first;
  assert.equal(h.states.at(-1), "unavailable"); assert.ok(!h.states.includes("ready")); h.guard.dispose();
  const later = deferred(); const disposed = harness(() => later.promise); const checked = disposed.guard.check();
  disposed.guard.dispose(); later.resolve(own); await checked; assert.ok(!disposed.states.includes("ready"));
});
