import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { prepareGeraniumHeaderPatch } from "./prepare-geranium-header-patch.mjs";

// Synthetic nonpersonal code only. Production Code bodies are never invoked.
const fixture = `// Synthetic strict wrapper and identity hold must remain unchanged.
const strictInput = { items: [], lookup: () => [] };
const strictOutput = (function(items, $) {
function geraniumRead(row, field) { return row[field]; }
function geraniumComparable(value) { return String(value ?? '').trim().toLowerCase(); }
function geraniumAllocatedCheck(row, field, parser) {
  const aliases = { completed: 'completed', 'not received': 'not_received' };
  const value = geraniumRead(row, field);
  const key = geraniumComparable(value);
  return parser(value, key, aliases);
}
function strictStatus(value) {
  const key = geraniumComparable(value);
  if (!key) return null;
  if (key === 'completed') return 'completed';
  if (key === 'not received') return 'not_received';
  throw new Error('Synthetic Geranium parser: unsupported status');
}
// The existing callers and all downstream identity/status rules are retained.
return { geraniumAllocatedCheck, strictStatus };
})(strictInput.items, strictInput.lookup);
return strictOutput;
`;

function loadSynthetic(source = fixture) {
  return new Function(prepareGeraniumHeaderPatch(source))();
}

const fields = [
  ["Spring Verify", ["Spring Verify", "SpringVerify Status"]],
  ["RemoFirst Verification", ["RemoFirst Verification", "Remofirst Verification status"]],
  ["Contract", ["Contract"]],
];

test("Geranium patch: approved live and legacy aliases accept case and surrounding/repeated whitespace", () => {
  const { geraniumAllocatedCheck: read } = loadSynthetic();
  for (const [field, aliases] of fields) {
    for (const alias of aliases) {
      for (const header of [alias, "  " + alias.toUpperCase().replaceAll(" ", " \t ") + "  "]) {
        assert.equal(read({ [header]: "completed" }, field, value => value), "completed");
      }
    }
  }
});

test("Geranium patch: present null, blank and undefined cells remain exact parser inputs", () => {
  const { geraniumAllocatedCheck: read } = loadSynthetic();
  for (const [field, aliases] of fields) {
    for (const alias of aliases) {
      for (const value of [null, "", " \t ", undefined]) {
        assert.equal(read({ [alias]: value }, field, input => input), value);
      }
    }
  }
});

test("Geranium patch: missing headers and similar unapproved labels fail closed", () => {
  const { geraniumAllocatedCheck: read } = loadSynthetic();
  for (const [field, aliases] of fields) {
    for (const row of [{}, { [aliases[0] + " (latest)"]: "completed" }, { ["Old " + aliases[0]]: "completed" }]) {
      assert.throws(() => read(row, field, value => value), /missing check header/);
    }
  }
  assert.throws(() => read({ "Spring Verify Status": "completed" }, "Spring Verify", value => value), /missing check header/);
});

test("Geranium patch: both aliases are ambiguous even with equal or blank values", () => {
  const { geraniumAllocatedCheck: read } = loadSynthetic();
  for (const [field, aliases] of fields.filter(([, aliases]) => aliases.length > 1)) {
    for (const value of ["completed", "", null]) {
      assert.throws(() => read({ [aliases[0]]: value, [aliases[1]]: value }, field, value => value), /ambiguous check headers/);
    }
  }
  for (const [field, [alias]] of fields) {
    assert.throws(() => read({ [alias]: "completed", [" " + alias.toLowerCase()]: "completed" }, field, value => value), /ambiguous check headers/);
  }
});

test("Geranium patch: inherited fields, unknown logical fields and invalid rows cannot supply evidence", () => {
  const { geraniumAllocatedCheck: read } = loadSynthetic();
  assert.throws(() => read(Object.create({ Contract: "completed" }), "Contract", value => value), /missing check header/);
  for (const field of ["Unknown", "Project Status", "__proto__", undefined]) {
    assert.throws(() => read({ Contract: "completed" }, field, value => value), /unsupported check field/);
  }
  for (const row of [null, undefined, [], "completed", 1]) {
    assert.throws(() => read(row, "Contract", value => value), /invalid check row/);
  }
});

test("Geranium patch: existing known mappings and unknown-status rejection are unchanged", () => {
  const original = new Function(fixture)();
  const patched = loadSynthetic();
  for (const value of ["completed", "not received", "", null]) {
    assert.equal(patched.geraniumAllocatedCheck({ "SpringVerify Status": value }, "Spring Verify", patched.strictStatus),
      original.geraniumAllocatedCheck({ "Spring Verify": value }, "Spring Verify", original.strictStatus));
  }
  for (const value of ["Awaiting Input", "unknown status", "not completed"]) {
    assert.throws(() => original.geraniumAllocatedCheck({ "Spring Verify": value }, "Spring Verify", original.strictStatus), /unsupported status/);
    assert.throws(() => patched.geraniumAllocatedCheck({ "SpringVerify Status": value }, "Spring Verify", patched.strictStatus), /unsupported status/);
  }
});

test("Geranium patch: prefix, suffix and LF/CRLF conventions remain byte-for-byte unchanged", () => {
  const lookup = "  const value = geraniumRead(row, field);";
  for (const source of [fixture, fixture.replaceAll("\n", "\r\n"), "\uFEFF" + fixture]) {
    const start = source.indexOf(lookup);
    const patched = prepareGeraniumHeaderPatch(source);
    const prefix = source.slice(0, start);
    const suffix = source.slice(start + lookup.length);
    assert.ok(Buffer.from(patched.slice(0, prefix.length)).equals(Buffer.from(prefix)));
    assert.ok(Buffer.from(patched.slice(-suffix.length)).equals(Buffer.from(suffix)));
    assert.equal(patched.includes(lookup), false);
    if (source.includes("\r\n")) assert.equal(patched.replaceAll("\r\n", "").includes("\n"), false);
  }
});

test("Geranium approved opt-in: Awaiting Input is preserved only for Spring Verify", () => {
  const patched = new Function(prepareGeraniumHeaderPatch(fixture, { awaitingInput: true }))();
  for (const header of ["Spring Verify", "SpringVerify Status"]) {
    for (const value of ["Awaiting Input", "awaiting input", "  AWAITING INPUT  "]) {
      assert.equal(patched.geraniumAllocatedCheck({ [header]: value }, "Spring Verify", () => {
        throw new Error("The old parser must not collapse the approved state");
      }), "awaiting_input");
    }
  }
  for (const [field, aliases] of fields.filter(([field]) => field !== "Spring Verify")) {
    for (const header of aliases) {
      assert.throws(() => patched.geraniumAllocatedCheck({ [header]: "Awaiting Input" }, field, patched.strictStatus), /unsupported status/);
    }
  }
  for (const value of ["awaiting input maybe", "unknown status", "not completed"]) {
    assert.throws(() => patched.geraniumAllocatedCheck({ "SpringVerify Status": value }, "Spring Verify", patched.strictStatus), /unsupported status/);
  }
  for (const value of ["completed", "not received", "", null]) {
    assert.equal(patched.geraniumAllocatedCheck({ "SpringVerify Status": value }, "Spring Verify", patched.strictStatus), patched.strictStatus(value));
  }
});

test("Geranium approved opt-in: ambiguity guards run before approved status recognition", () => {
  const patched = new Function(prepareGeraniumHeaderPatch(fixture, { awaitingInput: true }))();
  assert.throws(() => patched.geraniumAllocatedCheck({ "Spring Verify": "Awaiting Input", "SpringVerify Status": "Awaiting Input" }, "Spring Verify", patched.strictStatus), /ambiguous check headers/);
  assert.throws(() => patched.geraniumAllocatedCheck({}, "Spring Verify", patched.strictStatus), /missing check header/);
  for (const awaitingInput of ["true", "false", 1, null]) {
    assert.throws(() => prepareGeraniumHeaderPatch(fixture, { awaitingInput }), /explicit boolean/);
  }
  const approved = prepareGeraniumHeaderPatch(fixture, { awaitingInput: true });
  assert.throws(() => prepareGeraniumHeaderPatch(approved, { awaitingInput: true }), /Geranium patch preparation:/);
});

test("Geranium patch: structural drift, duplicate markers and repeated application are rejected", () => {
  const cases = [
    fixture.replace("function geraniumAllocatedCheck(row, field, parser) {", "function geraniumAllocatedCheck(row, field) {"),
    fixture.replace("  const value = geraniumRead(row, field);", "  const value = geraniumRead(row, field, 'alternate');"),
    fixture.replace("  const key = geraniumComparable(value);", "  const key = String(value);"),
    fixture.replace("  const key = geraniumComparable(value);", "  // changed adjacency\n  const key = geraniumComparable(value);"),
    fixture + "\n// function geraniumAllocatedCheck(row, field, parser) {",
    fixture + "\n//   const value = geraniumRead(row, field);",
    fixture.replace("\n  const key =", "\r\n  const key ="),
    prepareGeraniumHeaderPatch(fixture),
  ];
  for (const source of cases) assert.throws(() => prepareGeraniumHeaderPatch(source), /Geranium patch preparation:/);
  assert.throws(() => prepareGeraniumHeaderPatch(null), /source must be text/);
});

test("Geranium patch: parse-only compilation catches syntax failure without executing the body", () => {
  assert.doesNotThrow(() => prepareGeraniumHeaderPatch("throw new Error('This must never execute');\n" + fixture));
  assert.throws(() => prepareGeraniumHeaderPatch(fixture + "\n}"), /patched code did not compile/);
});

test("Geranium patch: comment and template-literal lookalikes cannot stand in for executable statements", () => {
  const lookalike = `function geraniumAllocatedCheck(row, field, parser) {
  const value = geraniumRead(row, field);
  const key = geraniumComparable(value);
  return parser(value, key);
}`;
  const drifted = fixture
    .replace("function geraniumAllocatedCheck(row, field, parser) {", "function geraniumAllocatedCheck (row, field, parser) {")
    .replace("  const value = geraniumRead(row, field);", "  const value=geraniumRead(row, field);")
    .replace("  const key = geraniumComparable(value);", "  const key=geraniumComparable(value);");
  for (const decoy of ["/*\n" + lookalike + "\n*/\n", "const syntheticText = `" + lookalike + "`;\n"]) {
    for (const source of [decoy, decoy + drifted]) {
      assert.throws(() => prepareGeraniumHeaderPatch(source), /unique expected executable function/);
    }
  }
  // The verified live target is nested inside an existing strict wrapper; the
  // wrapper and its preceding value-vocabulary aliases are legitimate context.
  assert.doesNotThrow(() => prepareGeraniumHeaderPatch(fixture));
  const decoyInsideTarget = fixture.replace("  const value = geraniumRead(row, field);\n  const key = geraniumComparable(value);",
    "  /*\n  const value = geraniumRead(row, field);\n  const key = geraniumComparable(value);\n  */\n  const value=geraniumRead(row, field);\n  const key=geraniumComparable(value);");
  assert.throws(() => prepareGeraniumHeaderPatch(decoyInsideTarget), /exact executable const statement/);
  const duplicateExecutable = fixture + "\nfunction geraniumAllocatedCheck (row, field, parser) { return parser(row[field]); }";
  assert.throws(() => prepareGeraniumHeaderPatch(duplicateExecutable), /unique expected executable function/);
});

test("Geranium patch CLI: explicit paths, exclusive output and input preservation", () => {
  const directory = mkdtempSync(join(tmpdir(), "geranium-header-patch-test-"));
  const input = join(directory, "synthetic-input.js");
  const output = join(directory, "synthetic-review.js");
  const approvedOutput = join(directory, "synthetic-approved-review.js");
  const script = fileURLToPath(new URL("./prepare-geranium-header-patch.mjs", import.meta.url));
  const invoke = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  try {
    writeFileSync(input, fixture);
    assert.equal(invoke().status, 1);
    assert.equal(invoke("--input", input, "--output", input).status, 1);
    const prepared = invoke("--input", input, "--output", output);
    assert.equal(prepared.status, 0, prepared.stderr);
    assert.equal(readFileSync(output, "utf8"), prepareGeraniumHeaderPatch(fixture));
    assert.equal(readFileSync(input, "utf8"), fixture);
    assert.equal(invoke("--input", input, "--output", output).status, 1);
    assert.equal(readFileSync(output, "utf8"), prepareGeraniumHeaderPatch(fixture));
    assert.equal(invoke("--help").status, 0);
    assert.equal(invoke("--input", input, "--output", approvedOutput, "--unknown-option").status, 1);
    const approved = invoke("--input", input, "--output", approvedOutput, "--include-awaiting-input");
    assert.equal(approved.status, 0, approved.stderr);
    assert.match(approved.stdout, /Canonical-filter\/UI support must be released together/);
    assert.equal(readFileSync(approvedOutput, "utf8"), prepareGeraniumHeaderPatch(fixture, { awaitingInput: true }));
    assert.equal(readFileSync(input, "utf8"), fixture);
  } finally {
    // Only known, flat synthetic files exist here; no recursive deletion.
    for (const name of readdirSync(directory)) {
      assert.ok(["synthetic-input.js", "synthetic-review.js", "synthetic-approved-review.js"].includes(name));
      unlinkSync(join(directory, name));
    }
    rmdirSync(directory);
  }
});
