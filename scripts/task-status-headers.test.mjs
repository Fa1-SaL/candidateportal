import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";

// Read generated Code-node bodies; never execute a builder, network node or workflow.
const selections = [
  "unified-portal-branches.selection.json",
  "coding-project-sources.selection.json",
].map(name => JSON.parse(readFileSync(new URL("../n8n/" + name, import.meta.url), "utf8")));
const builder = readFileSync(new URL("./build-unified-n8n-branches.mjs", import.meta.url), "utf8");
const email = "candidate@example.invalid";
const projects = [
  { name: "Otter", variable: "otterTaskNormalizer", identity: "Contributor Email", headers: ["Current Status"] },
  { name: "Rudder", variable: "rudderTaskNormalizer", identity: "Assignee", headers: ["Task Status", "State Enum", "Status"] },
];

function nodeCode(selection, project) {
  const code = selection.nodes.find(node => node.name === "Normalize " + project.name + " Tasks - Unified")?.parameters.jsCode;
  assert.equal(typeof code, "string");
  return code;
}

function normalize(project, rows) {
  const code = nodeCode(selections[0], project);
  const output = new Script("(function () {\n" + code + "\n})()").runInNewContext({
    items: rows.map(json => ({ json })),
    $execution: { id: "synthetic-status-header-test" },
    $: name => {
      assert.equal(name, "Normalize Coding Project Rosters");
      return { all: () => [{ json: { p_email: email, p_source_key: "coding-project-roster:" + project.name.toLowerCase() } }] };
    },
  }, { timeout: 1000 });
  return output.map(item => item.json);
}

function row(project, extra = {}) {
  return { "Task ID": "TASK-1", [project.identity]: email, ...extra };
}

for (const project of projects) {
  test(project.name + ": generated normalizer matches its builder and both selections", () => {
    const prefix = "const " + project.variable + " = String.raw`";
    const start = builder.indexOf(prefix);
    assert.notEqual(start, -1);
    const end = builder.indexOf("`;", start + prefix.length);
    assert.notEqual(end, -1);
    const source = builder.slice(start + prefix.length, end).replaceAll("\r\n", "\n");
    assert.ok(!source.includes("${"), "Template interpolation needs a reviewed extraction method");
    for (const selection of selections) assert.equal(nodeCode(selection, project), source);
  });

  test(project.name + ": an absent status header cannot create a pending task", () => {
    assert.throws(() => normalize(project, [row(project)]), /missing task status header/);
  });

  test(project.name + ": similarly named columns are not approved status headers", () => {
    assert.throws(() => normalize(project, [row(project, {
      ["Previous " + project.headers[0]]: "accepted",
      [project.headers[0] + " (latest)"]: "rejected",
    })]), /missing task status header/);
  });

  test(project.name + ": each existing approved alias and normalized spelling works", () => {
    for (const header of project.headers) {
      for (const spelling of [header, " " + header.toLowerCase().replaceAll(" ", "_") + " "]) {
        const [event] = normalize(project, [row(project, { [spelling]: "rejected" })]);
        assert.equal(event.p_status, "rejected");
        assert.equal(event.p_email, email);
        assert.equal(event.p_task_external_id, "TASK-1");
        assert.equal(event.p_project_slug, project.name);
      }
    }
  });

  test(project.name + ": present blank cells retain the existing pending policy", () => {
    for (const value of ["", " ", null, undefined]) {
      const [event] = normalize(project, [row(project, { [project.headers[0]]: value })]);
      assert.equal(event.p_status, "evaluation_pending");
    }
  });

  test(project.name + ": duplicate normalized headers fail even when one cell is blank", () => {
    for (const value of ["rejected", "accepted", ""]) {
      assert.throws(() => normalize(project, [row(project, {
        [project.headers[0]]: "accepted",
        [project.headers[0].toLowerCase().replaceAll(" ", "_")]: value,
      })]), /ambiguous task status headers/);
    }
  });

  test(project.name + ": one valid row does not hide a second row lacking status evidence", () => {
    assert.throws(() => normalize(project, [
      row(project, { [project.headers[0]]: "accepted" }),
      row(project, { "Task ID": "TASK-2" }),
    ]), /missing task status header/);
  });

  test(project.name + ": existing explicit status meanings and unknown rejection remain", () => {
    for (const [input, expected] of [
      ["accepted", "accepted"], ["rejected", "rejected"],
      ["non-fixable", "rejected"], ["needs revision", "rework"],
      ["fixable", "rework"], ["waiting for review", "evaluation_pending"],
    ]) {
      assert.equal(normalize(project, [row(project, { [project.headers[0]]: input })])[0].p_status, expected);
    }
    for (const input of ["not accepted", "unknown state"]) {
      assert.throws(() => normalize(project, [row(project, { [project.headers[0]]: input })]), /unsupported status/);
    }
  });

  test(project.name + ": existing roster exclusions do not gain synthetic task rows", () => {
    const output = normalize(project, [
      row(project, { [project.headers[0]]: "accepted" }),
      row(project, { "Task ID": "OTHER-1", [project.identity]: "outside@example.invalid" }),
    ]);
    assert.equal(output.length, 1);
    assert.equal(output[0].p_task_external_id, "TASK-1");
  });
}

test("Rudder: multiple approved status aliases are ambiguous even if their values agree", () => {
  const project = projects[1];
  for (const other of ["State Enum", "Status"]) {
    assert.throws(() => normalize(project, [row(project, { "Task Status": "accepted", [other]: "accepted" })]), /ambiguous task status headers/);
  }
});

test("Rudder: existing non-Crossing-Hurdles source exclusions are preserved", () => {
  const project = projects[1];
  const output = normalize(project, [
    row(project, { "BPO Source": "Crossing Hurdles", "Task Status": "accepted" }),
    row(project, { "BPO Source": "Other", "Task ID": "OTHER-1" }),
  ]);
  assert.equal(output.length, 1);
  assert.equal(output[0].p_task_external_id, "TASK-1");
});
