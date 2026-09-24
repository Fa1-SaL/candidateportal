import assert from "node:assert/strict";
import { PORTAL_UNDER_MAINTENANCE } from "../src/lib/portal/maintenance.ts";

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

if (PORTAL_UNDER_MAINTENANCE) {
  for (const path of ["/", "/?project=synthetic-maintenance-test", "/login"]) {
    const response = await fetch(new URL(path, base), { redirect: "manual", signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200, path);
    const html = await response.text();
    assert.match(html, /The candidate portal is currently under maintenance/);
    assert.match(html, /sandbox="allow-scripts"/);
    assert.match(html, /src="\/dino\/index.html"/);
    assert.doesNotMatch(html, /<input[^>]+type="email"|Task Summary|candidate_portal_snapshot/);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
    console.log("PASS maintenance screen and no candidate data: " + path);
  }
  for (const path of ["/dino/index.html", "/dino/offline.js", "/dino/offline-sprite-definitions.js", "/dino/embed.js", "/dino/sprite-1x.png", "/dino/sprite-2x.png"]) {
    const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200, path);
    if (path === "/dino/index.html") {
      assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
      assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'self'/);
      assert.match(response.headers.get("content-security-policy") ?? "", /connect-src 'none'/);
    }
    assert.ok((await response.arrayBuffer()).byteLength > 0, path);
    console.log("PASS game asset " + path);
  }
} else {
  function assertActiveResponse(response, html, path) {
    assert.match(response.headers.get("cache-control") ?? "", /no-store/, path);
    assert.equal(response.headers.get("cdn-cache-control"), "no-store", path);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer", path);
    assert.equal(response.headers.get("x-frame-options"), "DENY", path);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff", path);
    assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/, path);
    assert.doesNotMatch(html, /The candidate portal is currently under maintenance|src="\/dino\/index.html"/, path);
    assert.doesNotMatch(html, /Task Summary|candidate_portal_snapshot/, path);
  }

  for (const path of ["/", "/?project=synthetic-active-test"]) {
    const response = await fetch(new URL(path, base), { redirect: "manual", signal: AbortSignal.timeout(10000) });
    const html = await response.text();
    assertActiveResponse(response, html, path);
    let destination;
    if (response.status === 307) {
      destination = response.headers.get("location");
    } else {
      // app/loading.tsx can start streaming before Home redirects. Next then
      // returns HTTP 200 with an actual refresh meta tag, not a 307 header.
      assert.equal(response.status, 200, path);
      const redirects = [...html.matchAll(/<meta\b(?=[^>]*\bhttp-equiv="refresh")[^>]*\bcontent="([^"]*)"[^>]*>/gi)];
      assert.equal(redirects.length, 1, path + " must redirect anonymous visitors");
      destination = redirects[0][1].match(/^\s*\d+\s*;\s*url=(.+?)\s*$/i)?.[1];
    }
    assert.ok(destination, path + " must provide a login destination");
    assert.equal(new URL(destination, base).href, new URL("/login", base).href, path);
    console.log("PASS active anonymous login redirect and private/no-store: " + path);
  }

  const response = await fetch(new URL("/login", base), { redirect: "manual", signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200, "/login");
  const html = await response.text();
  assertActiveResponse(response, html, "/login");
  // Require the rendered form, not just its text inside a script, loading
  // fallback, or error page. This does not submit an OTP or authenticate.
  const form = html.match(/<form\b[^>]*\bclass="[^"]*\blogin-form\b[^"]*"[^>]*>[\s\S]*?<\/form>/)?.[0];
  assert.ok(form, "/login must render the sign-in form");
  assert.match(form, /<label\b[^>]*\bfor="email"[^>]*>Email address<\/label>/);
  assert.match(form, /<input\b(?=[^>]*\bname="email")(?=[^>]*\btype="email")[^>]*>/);
  assert.match(form, /<button\b[^>]*\btype="submit"[^>]*>Email me a sign-in link<\/button>/);
  console.log("PASS active login form and private/no-store; no maintenance or candidate data");
}
