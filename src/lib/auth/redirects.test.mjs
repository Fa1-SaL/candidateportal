import assert from "node:assert/strict";
import test from "node:test";
import { authenticationUnavailable } from "./errors.ts";

test("authentication outages do not masquerade as signed-out sessions", () => {
  assert.equal(authenticationUnavailable(null), false);
  for (const status of [400, 401, 403]) assert.equal(authenticationUnavailable({status}), false);
  for (const status of [0, 429, 500, undefined]) assert.equal(authenticationUnavailable({status}), true);
});

import {
  getAppOrigin,
  containsAuthParameters,
  getSafeRedirectPath,
} from "./redirects.ts";

test("strips credentials from redirects and retains a safe project selector", () => {
  assert.equal(containsAuthParameters(["project", "TOKEN_HASH"]), true);
  assert.equal(containsAuthParameters(["project"]), false);
  assert.equal(getSafeRedirectPath("/?project=one&token_hash=secret&code=x&type=email&next=/"), "/?project=one");
  assert.equal(getSafeRedirectPath("/#access_token=secret"), "/");
  assert.equal(getSafeRedirectPath("/?ACCESS_TOKEN=secret"), "/");
});

test("rejects unsafe configured production origins and credentials", () => {
  const request = new URL("https://attacker.example/auth/callback");
  for (const configured of ["http://example.com", "http://localhost:3000", "https://user:password@example.com", "https://example.com/other", "javascript:alert(1)"]) {
    assert.equal(getAppOrigin(request, configured, "production"), "https://candidate.crossinghurdles.com");
  }
  assert.equal(getAppOrigin(request, "https://staging.example.com", "production"), "https://staging.example.com");
});

test("accepts only same-origin relative redirect paths", () => {
  assert.equal(getSafeRedirectPath("/"), "/");
  assert.equal(getSafeRedirectPath("/dashboard?project=123#tasks"), "/dashboard?project=123#tasks");
  assert.equal(getSafeRedirectPath("//attacker.example"), "/");
  assert.equal(getSafeRedirectPath("/\\attacker.example"), "/");
  assert.equal(getSafeRedirectPath("https://attacker.example"), "/");
  assert.equal(getSafeRedirectPath(null), "/");
});

test("uses the configured canonical site instead of request host headers", () => {
  const requestUrl = new URL("https://attacker.example/auth/callback");

  assert.equal(
    getAppOrigin(requestUrl, "https://crossing-hurdles-candidate-portal.netlify.app", "production"),
    "https://crossing-hurdles-candidate-portal.netlify.app",
  );
  assert.equal(
    getAppOrigin(requestUrl, "", "production"),
    "https://candidate.crossinghurdles.com",
  );
});

test("allows local origins only outside production", () => {
  const localUrl = new URL("http://localhost:3000/auth/callback");

  assert.equal(getAppOrigin(localUrl, "", "development"), "http://localhost:3000");
  assert.equal(
    getAppOrigin(localUrl, "", "production"),
    "https://candidate.crossinghurdles.com",
  );
});
