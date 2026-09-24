import assert from "node:assert/strict";
import test from "node:test";
import { createSessionGuard } from "./session-guard.ts";
import { createSessionLifecycle } from "./session-lifecycle.ts";

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

function lifecycleHarness(verifyIdentity, initiallyVisible = true, timeoutMs = 1000) {
  let calls = 0; let refreshes = 0; let time = 1000;
  const h = harness(() => { calls++; return verifyIdentity(); }, timeoutMs);
  const lifecycle = createSessionLifecycle({
    guard: h.guard, initiallyVisible, now: () => time,
    refresh: () => { assert.equal(h.states.at(-1), "ready"); refreshes++; },
  });
  return { ...h, lifecycle, advance: ms => { time += ms; }, get calls() { return calls; }, get refreshes() { return refreshes; } };
}
test("initial load and ordinary focus coalesce identity checks without refreshing", async () => {
  const pending = deferred(); const h = lifecycleHarness(() => pending.promise);
  const first = h.lifecycle.start();
  assert.equal(h.lifecycle.focus(true), first);
  assert.equal(h.lifecycle.pageShow(false, true), first);
  assert.equal(h.lifecycle.visibilityChanged(true), first);
  assert.equal(h.calls, 1); assert.equal(h.refreshes, 0);
  pending.resolve(own); await first;
  await h.lifecycle.focus(true); await h.lifecycle.pageShow(false, true);
  assert.equal(h.calls, 1); assert.equal(h.refreshes, 0);
  h.advance(251); await h.lifecycle.focus(true);
  assert.equal(h.calls, 2); assert.equal(h.refreshes, 0);
  h.lifecycle.dispose();
});
test("one hidden-page return refreshes once only after matching identity, including delayed pageshow", async () => {
  const pending = deferred(); let identity = Promise.resolve(own);
  const h = lifecycleHarness(() => identity); await h.lifecycle.start();
  identity = pending.promise;
  h.lifecycle.visibilityChanged(false); h.lifecycle.pageHide();
  const resumed = h.lifecycle.visibilityChanged(true);
  assert.equal(h.states.at(-1), "checking"); assert.equal(h.refreshes, 0);
  assert.equal(h.lifecycle.focus(true), resumed);
  assert.equal(h.calls, 2);
  pending.resolve(own); await resumed;
  assert.equal(h.refreshes, 1);
  h.advance(1000); await h.lifecycle.pageShow(true, true);
  assert.equal(h.refreshes, 1);
  // Another real departure is never suppressed by the event coalescing window.
  h.lifecycle.pageHide(); await h.lifecycle.pageShow(true, true);
  assert.equal(h.refreshes, 2); h.lifecycle.dispose();
});
test("BFCache pageshow requests a refresh without requiring a visibility event", async () => {
  const h = lifecycleHarness(async () => own); await h.lifecycle.start();
  await h.lifecycle.pageShow(true, true);
  assert.equal(h.calls, 2); assert.equal(h.refreshes, 1);
  await h.lifecycle.focus(true); await h.lifecycle.visibilityChanged(true); await h.lifecycle.pageShow(true, true);
  assert.equal(h.calls, 2); assert.equal(h.refreshes, 1); h.lifecycle.dispose();
});
test("resuming with a missing or changed identity never refreshes", async () => {
  for (const userId of [null, "account-B"]) {
    let identity = own; const h = lifecycleHarness(async () => identity); await h.lifecycle.start();
    h.lifecycle.visibilityChanged(false); identity = { userId, unavailable: false };
    await h.lifecycle.visibilityChanged(true);
    assert.equal(h.refreshes, 0); assert.equal(h.states.at(-1), "checking");
    h.lifecycle.dispose();
  }
});
test("unavailable resume stays concealed and refreshes once after a successful retry", async () => {
  let unavailable = false; const h = lifecycleHarness(async () => ({ ...own, unavailable }));
  await h.lifecycle.start(); h.lifecycle.visibilityChanged(false); unavailable = true;
  await h.lifecycle.visibilityChanged(true);
  assert.equal(h.states.at(-1), "unavailable"); assert.equal(h.refreshes, 0);
  unavailable = false; await h.lifecycle.retry();
  assert.equal(h.refreshes, 1); h.lifecycle.dispose();
});
test("a page hidden again cancels its pending refresh and the next verified return wins", async () => {
  const pending = deferred(); let identity = Promise.resolve(own);
  const h = lifecycleHarness(() => identity); await h.lifecycle.start();
  h.lifecycle.visibilityChanged(false); identity = pending.promise;
  const obsolete = h.lifecycle.visibilityChanged(true); h.lifecycle.visibilityChanged(false);
  identity = Promise.resolve(own); await h.lifecycle.visibilityChanged(true);
  assert.equal(h.refreshes, 1);
  pending.resolve(own); await obsolete;
  assert.equal(h.refreshes, 1); assert.equal(h.states.at(-1), "ready"); h.lifecycle.dispose();
});
test("sign-out and disposal cancel pending resume refreshes", async () => {
  for (const cancel of [h => h.guard.authChanged("SIGNED_OUT", null), h => h.guard.authChanged("SIGNED_IN", "account-B"), h => h.lifecycle.dispose()]) {
    const pending = deferred(); let identity = Promise.resolve(own);
    const h = lifecycleHarness(() => identity); await h.lifecycle.start();
    h.lifecycle.visibilityChanged(false); identity = pending.promise;
    const resumed = h.lifecycle.visibilityChanged(true); cancel(h);
    pending.resolve(own); await resumed;
    assert.equal(h.refreshes, 0); assert.equal(h.states.at(-1), "checking"); h.lifecycle.dispose();
  }
});
test("sign-out concealment cannot be undone by focus before an explicit retry", async () => {
  const h = lifecycleHarness(async () => own); await h.lifecycle.start(); h.lifecycle.suspend();
  h.advance(1000); await h.lifecycle.focus(true); await h.lifecycle.pageShow(false, true);
  assert.equal(h.calls, 1); assert.equal(h.states.at(-1), "checking");
  await h.lifecycle.retry(); assert.equal(h.calls, 2); assert.equal(h.states.at(-1), "ready");
  assert.equal(h.refreshes, 0); h.lifecycle.dispose();
});
test("an initially hidden page waits for visibility and timed-out resumes never refresh", async () => {
  let identity = Promise.resolve(own); const h = lifecycleHarness(() => identity, false, 5);
  await h.lifecycle.start(); assert.equal(h.calls, 0);
  await h.lifecycle.visibilityChanged(true); assert.equal(h.refreshes, 1);
  h.lifecycle.visibilityChanged(false); identity = new Promise(() => {});
  await h.lifecycle.visibilityChanged(true);
  assert.equal(h.states.at(-1), "unavailable"); assert.equal(h.refreshes, 1); h.lifecycle.dispose();
});
