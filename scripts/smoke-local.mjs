import assert from "node:assert/strict";

// Read-only production-build checks. Deliberately refuse non-loopback targets,
// never follow redirects, and never send cookies, emails or real auth material.
const base = new URL(process.env.PORTAL_SMOKE_URL ?? "http://127.0.0.1:3101");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname));
assert.equal(base.protocol, "http:");
assert.equal(base.username + base.password + base.search + base.hash, "");
const cases = [
  ["/preview", 404], ["/login", 200], ["/auth/callback", 307],
  ["/auth/confirm", 307], ["/?token_hash=synthetic-test-token&project=demo", 307],
];
for (const [path, status] of cases) {
  const response = await fetch(new URL(path, base), { redirect: "manual", signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, status, path);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(response.headers.get("cdn-cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  if (status === 307) {
    const location = new URL(response.headers.get("location"));
    assert.ok(!location.searchParams.has("token_hash"));
    if (path.startsWith("/?")) assert.equal(location.search, "?project=demo");
    else assert.equal(location.pathname, "/login");
  }
  await response.body?.cancel();
  console.log("PASS " + path.split("?")[0] + " HTTP " + status + " private/no-store");
}
