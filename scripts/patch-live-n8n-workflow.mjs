import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const [inputArgument, outputArgument] = process.argv.slice(2);
if (!inputArgument || !outputArgument) {
  throw new Error(
    "Usage: node scripts/patch-live-n8n-workflow.mjs <live-workflow.json> <output.json>",
  );
}

const inputPath = resolve(inputArgument);
const outputPath = resolve(outputArgument);
const generatedPath = new URL(
  "../n8n/unified-portal-branches.selection.json",
  import.meta.url,
);

const workflow = JSON.parse(readFileSync(inputPath, "utf8"));
const generated = JSON.parse(readFileSync(generatedPath, "utf8"));

const obsoleteNodes = new Set([
  // A task-history sheet must not create active project memberships.
  "Read Terminus Task Evidence - Unified",
  "Tag Terminus Task Evidence",

  // The Starfish tab was removed and this flag is not shown in the portal.
  "Prep Reset (starfish)",
  "Reset Flagged Tasks",
  "Starfish - Tasks to Review",
  "Extract Flagged Emails",
  "Batch Flagged Emails",
  "Set Review Flags",

  // IP addendum is not a portal field and these reads are no longer needed.
  "Sequoia - Onboarded ECs",
  "Sequoia - Signed IP List",
  "src: onboarded",
  "src: ip_list",
  "Merge IP sources",
  "Combine Sequoia IP Data",
  "Batch IP Addendum",
  "Set IP Addendum Status",
]);

function nodeByName(name) {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  if (!node) throw new Error(`Live workflow is missing required node: ${name}`);
  return node;
}

function replaceOrAddNode(node) {
  const index = workflow.nodes.findIndex((candidate) => candidate.name === node.name);
  if (index === -1) {
    workflow.nodes.push(node);
    return node;
  }

  const liveNode = workflow.nodes[index];
  workflow.nodes[index] = { ...node, id: liveNode.id };
  return workflow.nodes[index];
}

function addCodeNode(name, jsCode, position) {
  return replaceOrAddNode({
    parameters: { jsCode },
    id: randomUUID(),
    name,
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position,
  });
}

function addHttpNode(name, rpc, jsonBody, position) {
  const credential = nodeByName("Upsert Task Events").credentials;
  return replaceOrAddNode({
    parameters: {
      method: "POST",
      url: `https://imkiodmiaocumozdpplp.supabase.co/rest/v1/rpc/${rpc}`,
      authentication: "predefinedCredentialType",
      nodeCredentialType: "supabaseApi",
      sendBody: true,
      specifyBody: "json",
      jsonBody,
      options: { timeout: 120000 },
    },
    id: randomUUID(),
    name,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position,
    credentials: credential,
    retryOnFail: true,
    maxTries: 4,
    waitBetweenTries: 3000,
  });
}

function connect(from, ...targets) {
  workflow.connections[from] = {
    main: [targets.map((node) => ({ node, type: "main", index: 0 }))],
  };
}

// Overlay all generated unified/coding/payment/Geranium nodes while retaining
// the IDs of nodes already present in the live workflow.
for (const node of generated.nodes) replaceOrAddNode(node);
for (const [name, connection] of Object.entries(generated.connections)) {
  workflow.connections[name] = connection;
}

const stemTaskNormalizer = String.raw`const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FORMATS = {
  riga: {
    email: 'Assignee', status: 'Task Status', created: 'Created At',
    submitted: 'Last Submitted At', project: 'Project Name', taskId: 'Task ID',
    type: 'Task Type', bpo: 'BPO Source', outcome: 'Final Outcome',
    sheet: 'CH-auto-import', slug: 'riga', sourceKey: 'task-source:riga',
  },
  starfish: {
    email: 'User Email', status: 'State Enum', created: 'Created At',
    submitted: 'Submitted At', project: 'Project Name', taskId: 'Task ID',
    type: null, bpo: null, outcome: null, sheet: 'Task Details',
    slug: 'starfish', sourceKey: 'task-source:starfish',
  },
  rainier: {
    email: 'User Email', status: 'Status', created: 'Created At',
    submitted: 'Submitted At', project: 'Project Name', taskId: 'Task ID',
    type: null, bpo: null, outcome: null, sheet: 'Task Details',
    slug: 'rainier', sourceKey: 'task-source:rainier',
  },
};

function text(value) { return String(value ?? '').trim(); }
function key(value) { return text(value).toLowerCase().replace(/[^a-z0-9]/g, ''); }
function read(row, ...names) {
  const entries = Object.entries(row || {});
  for (const name of names.map(key)) {
    const match = entries.find(([column, value]) => key(column) === name && value !== null && value !== undefined);
    if (match) return match[1];
  }
  return '';
}
function status(value, source) {
  const normalized = text(value).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (['accepted', 'approved', 'provisionally accepted', 'completed', 'ready to deliver', 'delivered'].includes(normalized)) return 'accepted';
  if (['rejected', 'invalid'].includes(normalized)) return 'rejected';
  if (['need revision', 'needs revision', 'rework', 'requiring rework'].includes(normalized)) return 'rework';
  if (['waiting for review', 'pending review', 'evaluation pending', 'submitted', 'assigned', 'in progress', 'under review', 'ready for review'].includes(normalized)) return 'evaluation_pending';
  throw new Error(source + ': unsupported task status ' + JSON.stringify(value));
}
function count(value, label, email) {
  const raw = text(value).replace(/[\s,]/g, '');
  if (!raw) return 0;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(email + ': invalid ' + label + ' count ' + JSON.stringify(value));
  }
  return parsed;
}

const syncRunId = String($execution.id);
const events = new Map();
const cumulative = new Map();

for (const item of items) {
  const row = item.json;
  const source = text(row._src).toLowerCase();

  if (source === 'sequoia') {
    const email = text(read(row, 'EMAIL', 'Email')).toLowerCase();
    if (!email) continue;
    if (!EMAIL_RE.test(email)) throw new Error('Sequoia Crossing Hurdles Review: invalid email ' + JSON.stringify(email));
    if (cumulative.has(email)) throw new Error('Sequoia Crossing Hurdles Review: duplicate email ' + email);
    const submitted = count(read(row, 'TOTAL SUBMISSIONS HANDLED', 'TOTAL SUBMISSIONS'), 'submitted', email);
    const accepted = count(read(row, 'PROVISIONALLY ACCEPTED COUNT', 'ACCEPTED COUNT'), 'accepted', email);
    const rejected = count(read(row, 'REJECTED COUNT', 'REJECTED'), 'rejected', email);
    const rework = count(read(row, 'NEEDS REVISION COUNT', 'NEEDS REVISION'), 'rework', email);
    const evaluationPending = count(read(row, 'WAITING FOR REVIEW COUNT', 'EVAL PENDING', 'PENDING REVIEW'), 'evaluation pending', email);
    if (submitted !== accepted + rejected + rework + evaluationPending) {
      throw new Error(email + ': Sequoia task totals do not reconcile');
    }
    cumulative.set(email, {
      _kind: 'cumulative',
      p_email: email,
      p_client: 'Snorkel',
      p_vertical: 'STEM',
      p_project_slug: 'sequoia',
      p_as_of: new Date().toISOString().slice(0, 10),
      p_submitted: submitted,
      p_accepted: accepted,
      p_rejected: rejected,
      p_rework: rework,
      p_evaluation_pending: evaluationPending,
      p_source_sheet: 'Crossing Hurdles Review',
      p_metric_kind: 'cumulative',
      p_allow_missing_assignment: true,
    });
    continue;
  }

  const format = FORMATS[source];
  if (!format) throw new Error('Unknown STEM task source ' + JSON.stringify(source));
  const email = text(row[format.email]).toLowerCase();
  const taskId = text(row[format.taskId]);
  if (!email && !taskId) continue;
  if (!EMAIL_RE.test(email)) throw new Error(source + ': invalid task email ' + JSON.stringify(email));
  if (!taskId) throw new Error(source + ': missing task ID for ' + email);
  if (format.bpo && text(row[format.bpo]).toLowerCase().replace(/[^a-z0-9]/g, '') !== 'crossinghurdles') continue;

  const eventKey = [source, email, taskId.toLowerCase()].join('|');
  events.set(eventKey, {
    _kind: 'event',
    p_event_key: eventKey,
    p_email: email,
    p_client: 'Snorkel',
    p_vertical: 'STEM',
    p_project_slug: format.slug,
    p_task_external_id: taskId,
    p_project_name_raw: text(row[format.project]) || format.slug,
    p_task_type: format.type ? text(row[format.type]) || null : null,
    p_status: status(row[format.status], source),
    p_created_at_source: text(row[format.created]) || null,
    p_submitted_at_source: text(row[format.submitted]) || null,
    p_bpo_source: format.bpo ? text(row[format.bpo]) || null : null,
    p_final_outcome: format.outcome ? text(row[format.outcome]) || null : null,
    p_source_sheet: format.sheet,
    p_source_key: format.sourceKey,
    p_sync_run_id: syncRunId,
    p_allow_missing_assignment: true,
  });
}

if (!events.size) throw new Error('STEM task sources returned no event rows');
return [
  ...[...events.values()].sort((left, right) => left.p_event_key.localeCompare(right.p_event_key)),
  ...[...cumulative.values()].sort((left, right) => left.p_email.localeCompare(right.p_email)),
].map((row) => ({ json: row }));`;

const stemTaskBatcher = `const groups = new Map();
for (const item of items) {
  const row = item.json;
  if (!row.p_source_key || !row.p_sync_run_id) throw new Error('Task snapshot row is missing source metadata');
  const key = row.p_source_key + '\\u0000' + row.p_sync_run_id;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(row);
}
const output = [];
for (const [key, rows] of groups) {
  const [sourceKey, syncRunId] = key.split('\\u0000');
  for (let index = 0; index < rows.length; index += 50) {
    output.push({ json: {
      p_source_key: sourceKey,
      p_sync_run_id: syncRunId,
      p_rows: rows.slice(index, index + 50),
    } });
  }
}
return output;`;

const strictValidator = `const results = items.flatMap((item) => {
  if (Array.isArray(item.json)) return item.json;
  if (Array.isArray(item.json?.body)) return item.json.body;
  if (Array.isArray(item.json?.data)) return item.json.data;
  return [item.json];
});
const rejected = results.filter((row) => row?.out_status !== 'ok');
if (rejected.length) throw new Error('Supabase rejected rows: ' + JSON.stringify(rejected.slice(0, 20)));
return [{ json: { processed: results.length } }];`;

const prepareStemFinalizers = `const rows = $('Normalize All Task Metrics').all()
  .map((item) => item.json)
  .filter((row) => row._kind === 'event');
const groups = new Map();
for (const row of rows) {
  const key = row.p_source_key + '\\u0000' + row.p_sync_run_id;
  groups.set(key, (groups.get(key) || 0) + 1);
}
if (!groups.size) throw new Error('Cannot finalize an empty STEM task snapshot');
return [...groups.entries()].map(([key, count]) => {
  const [sourceKey, syncRunId] = key.split('\\u0000');
  return { json: {
    p_source_key: sourceKey,
    p_sync_run_id: syncRunId,
    p_expected_count: count,
  } };
});`;

const snapshotValidator = `const results = items.flatMap((item) => Array.isArray(item.json) ? item.json : [item.json]);
for (const row of results) {
  if (row?.out_status !== 'ok') throw new Error('Task snapshot failed: ' + JSON.stringify(row));
  if (Number(row.out_active_count) + Number(row.out_skipped_count || 0) !== Number(row.out_expected_count)) {
    throw new Error('Task snapshot count mismatch: ' + JSON.stringify(row));
  }
}
return results.map((row) => ({ json: row }));`;

const permissiveValidator = `const results = items.flatMap((item) => {
  if (Array.isArray(item.json)) return item.json;
  if (Array.isArray(item.json?.body)) return item.json.body;
  if (Array.isArray(item.json?.data)) return item.json.data;
  return [item.json];
});
const errors = results.filter((row) => row?.out_status === 'error');
if (errors.length) throw new Error('Supabase rejected rows: ' + JSON.stringify(errors.slice(0, 20)));
return [{ json: {
  processed: results.filter((row) => row?.out_status === 'ok').length,
  skipped: results.filter((row) => row?.out_status === 'skipped').length,
} }];`;

nodeByName("Schedule Trigger - STEM Candidates").parameters = {
  rule: { interval: [{ field: "hours", hoursInterval: 6, triggerAtMinute: 5 }] },
};
nodeByName("Schedule Trigger - External Trackers").parameters = {
  rule: { interval: [{ field: "hours", hoursInterval: 6, triggerAtMinute: 15 }] },
};
nodeByName("Normalize All Task Metrics").parameters.jsCode = stemTaskNormalizer;
nodeByName("Batch Task Events").parameters.jsCode = stemTaskBatcher;

const upsertTaskEvents = nodeByName("Upsert Task Events");
upsertTaskEvents.parameters.url =
  "https://imkiodmiaocumozdpplp.supabase.co/rest/v1/rpc/stage_task_event_snapshot_batch";
upsertTaskEvents.parameters.jsonBody =
  '={{ { "p_source_key": $json.p_source_key, "p_sync_run_id": $json.p_sync_run_id, "p_rows": $json.p_rows } }}';
upsertTaskEvents.parameters.options = { timeout: 120000 };
upsertTaskEvents.retryOnFail = true;
upsertTaskEvents.maxTries = 4;
upsertTaskEvents.waitBetweenTries = 3000;

addCodeNode("Validate STEM Task Snapshot Batches", strictValidator, [1024, 5088]);
addCodeNode("Prepare STEM Task Snapshot Finalizers", prepareStemFinalizers, [1248, 5088]);
addHttpNode(
  "Finalize STEM Task Snapshots",
  "finalize_task_event_snapshot",
  '={{ { "p_source_key": $json.p_source_key, "p_sync_run_id": $json.p_sync_run_id, "p_expected_count": $json.p_expected_count, "p_allow_missing_assignments": true } }}',
  [1472, 5088],
);
addCodeNode("Validate STEM Task Snapshots", snapshotValidator, [1696, 5088]);

nodeByName("Batch Cumulative Metrics").parameters.jsCode = `const rows = items.map((item) => item.json);
const output = [];
for (let index = 0; index < rows.length; index += 50) {
  output.push({ json: { p_rows: rows.slice(index, index + 50) } });
}
return output;`;
const cumulativeHttp = nodeByName("Upsert Cumulative Metrics");
cumulativeHttp.parameters.jsonBody = '={{ { "p_rows": $json.p_rows } }}';
cumulativeHttp.parameters.options = { timeout: 120000 };
cumulativeHttp.retryOnFail = true;
cumulativeHttp.maxTries = 4;
cumulativeHttp.waitBetweenTries = 3000;
addCodeNode("Validate STEM Cumulative Metrics", permissiveValidator, [1024, 5280]);

connect(
  "Schedule Trigger - External Trackers",
  "Riga - CH-auto-import",
  "Starfish - Task Details",
  "Rainier - Task Details",
  "Sequoia - CH Review",
);
connect("Batch Task Events", "Upsert Task Events");
connect("Upsert Task Events", "Validate STEM Task Snapshot Batches");
connect("Validate STEM Task Snapshot Batches", "Prepare STEM Task Snapshot Finalizers");
connect("Prepare STEM Task Snapshot Finalizers", "Finalize STEM Task Snapshots");
connect("Finalize STEM Task Snapshots", "Validate STEM Task Snapshots");
connect("Batch Cumulative Metrics", "Upsert Cumulative Metrics");
connect("Upsert Cumulative Metrics", "Validate STEM Cumulative Metrics");

workflow.nodes = workflow.nodes.filter((node) => !obsoleteNodes.has(node.name));
for (const name of obsoleteNodes) delete workflow.connections[name];
for (const connection of Object.values(workflow.connections)) {
  for (const lane of connection.main ?? []) {
    for (let index = lane.length - 1; index >= 0; index -= 1) {
      if (obsoleteNodes.has(lane[index].node)) lane.splice(index, 1);
    }
  }
}

const names = new Set(workflow.nodes.map((node) => node.name));
if (names.size !== workflow.nodes.length) throw new Error("Patched workflow has duplicate node names");
for (const [from, connection] of Object.entries(workflow.connections)) {
  if (!names.has(from)) throw new Error(`Connection starts at missing node: ${from}`);
  for (const lane of connection.main ?? []) {
    for (const edge of lane) {
      if (!names.has(edge.node)) {
        throw new Error(`Connection from ${from} targets missing node: ${edge.node}`);
      }
    }
  }
}

workflow.active = true;
workflow.settings = { ...workflow.settings, executionOrder: "v1" };

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(workflow, null, 2)}\n`);
console.log(`Wrote ${workflow.nodes.length} nodes to ${outputPath}`);
