import assert from "node:assert/strict";
import test from "node:test";

import {
  getAppOrigin,
  getSafeRedirectPath,
} from "./redirects.ts";

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
    "https://candidate.crossinghurdles.com",
  );
  assert.equal(
    getAppOrigin(requestUrl, undefined, "production"),
    "https://candidate.crossinghurdles.com",
  );
});

test("allows local origins only outside production", () => {
  const localUrl = new URL("http://localhost:3000/auth/callback");

  assert.equal(getAppOrigin(localUrl, undefined, "development"), "http://localhost:3000");
  assert.equal(
    getAppOrigin(localUrl, undefined, "production"),
    "https://candidate.crossinghurdles.com",
  );
});
