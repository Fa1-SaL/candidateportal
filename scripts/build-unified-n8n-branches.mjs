import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

const googleCredential = {
  googleSheetsOAuth2Api: {
    id: "Fwum6c17KC1w1Elo",
    name: "Google Sheets account 2",
  },
};

const supabaseCredential = {
  supabaseApi: {
    id: "6brp0rQoBpo3lhkv",
    name: "Supabase Snorkel",
  },
};

const nodes = [];
const connections = {};

function addNode(name, type, typeVersion, position, parameters, credentials) {
  const node = {
    parameters,
    id: randomUUID(),
    name,
    type,
    typeVersion,
    position,
  };
  if (credentials) node.credentials = credentials;
  if (type === "n8n-nodes-base.httpRequest") {
    node.retryOnFail = true;
    node.maxTries = 4;
    node.waitBetweenTries = 3000;
  }
  if (type === "n8n-nodes-base.googleSheets") {
    node.retryOnFail = true;
    node.maxTries = 5;
    node.waitBetweenTries = 15000;
  }
  nodes.push(node);
  return name;
}

function connect(from, to, input = 0) {
  connections[from] ??= { main: [[]] };
  connections[from].main[0].push({ node: to, type: "main", index: input });
}

function sheets(name, documentId, sheetName, position) {
  return addNode(
    name,
    "n8n-nodes-base.googleSheets",
    4.5,
    position,
    {
      documentId: { __rl: true, value: documentId, mode: "id" },
      sheetName: { __rl: true, value: sheetName, mode: "name" },
      options: {},
    },
    googleCredential,
  );
}

function tag(name, source, position) {
  return addNode(name, "n8n-nodes-base.set", 3.4, position, {
    assignments: {
      assignments: [
        { id: randomUUID(), name: "_source", value: source, type: "string" },
      ],
    },
    includeOtherFields: true,
    options: {},
  });
}

function code(name, jsCode, position) {
  return addNode(name, "n8n-nodes-base.code", 2, position, { jsCode });
}

function http(name, rpc, position, timeout = 120000) {
  return addNode(
    name,
    "n8n-nodes-base.httpRequest",
    4.2,
    position,
    {
      method: "POST",
      url: `https://imkiodmiaocumozdpplp.supabase.co/rest/v1/rpc/${rpc}`,
      authentication: "predefinedCredentialType",
      nodeCredentialType: "supabaseApi",
      sendBody: true,
      specifyBody: "json",
      jsonBody: '={{ { "p_rows": $json.p_rows } }}',
      options: { timeout },
    },
    supabaseCredential,
  );
}

function batchCode(size, sortAssignments = false) {
  return `const rows = items.map((item) => item.json).filter((row) => row.p_email);
${sortAssignments ? "rows.sort((left, right) => [left.p_email, left.p_vertical, left.p_project].join('\\u0000').localeCompare([right.p_email, right.p_vertical, right.p_project].join('\\u0000')));" : ""}
const chunks = [];
for (let index = 0; index < rows.length; index += ${size}) {
  chunks.push({ json: { p_rows: rows.slice(index, index + ${size}) } });
}
return chunks;`;
}

const assignmentBatchCode = batchCode(100, true);
const metricBatchCode = batchCode(50);

const validateCode = `const results = items.flatMap((item) => {
  if (Array.isArray(item.json)) return item.json;
  if (Array.isArray(item.json?.body)) return item.json.body;
  if (Array.isArray(item.json?.data)) return item.json.data;
  return [item.json];
});
const errors = results.filter((row) => row?.out_status === 'error');
if (errors.length) {
  throw new Error('Supabase rejected ' + errors.length + ' rows: ' + JSON.stringify(errors.slice(0, 20)));
}
return [{ json: {
  processed: results.filter((row) => row?.out_status === 'ok').length,
  skipped: results.filter((row) => row?.out_status === 'skipped').length,
} }];`;

const masterNormalizer = String.raw`const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PROJECTS = {
  riga: { vertical: 'STEM', project: 'Riga' },
  rainier: { vertical: 'STEM', project: 'Rainier' },
  sequoia: { vertical: 'STEM', project: 'Sequoia' },
  starfish: { vertical: 'STEM', project: 'Starfish' },
  mojave: { vertical: 'Mojave', project: 'Mojave' },
  terminus: { vertical: 'Coding', project: 'Terminus' },
  otter: { vertical: 'Coding', project: 'Otter' },
  'sentinel ultra': { vertical: 'Coding', project: 'Sentinel Ultra' },
  'sentinal ultra': { vertical: 'Coding', project: 'Sentinel Ultra' },
  'suite life': { vertical: 'Coding', project: 'SuiteLife' },
  suitelife: { vertical: 'Coding', project: 'SuiteLife' },
  rudder: { vertical: 'Coding', project: 'Rudder' },
  paperbench: { vertical: 'Coding', project: 'PaperBench' },
  'paper bench': { vertical: 'Coding', project: 'PaperBench' },
};

function key(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}
function read(row, ...names) {
  const entries = Object.entries(row || {});
  const wanted = names.map(key);
  for (const name of wanted) {
    const match = entries.find(([column, value]) => key(column) === name && value !== null && value !== undefined);
    if (match) return match[1];
  }
  return '';
}
function text(value) {
  return String(value ?? '').trim();
}
function email(row, ...names) {
  const value = text(read(row, ...names)).toLowerCase();
  return EMAIL_RE.test(value) ? value : '';
}

const masterRows = items.filter((item) => item.json._source === 'master').map((item) => item.json);
const sent = new Set(items.filter((item) => item.json._source === 'contract_sent').map((item) => email(item.json, 'Email', 'Recipient Email')).filter(Boolean));
const signed = new Set(items.filter((item) => item.json._source === 'contract_signed').map((item) => email(item.json, 'Recipient Email', 'Email')).filter(Boolean));
const spring = new Map();

for (const item of items.filter((entry) => entry.json._source === 'springverify')) {
  const row = item.json;
  const candidateEmail = email(row, 'Email');
  if (!candidateEmail) continue;
  const status = text(read(row, 'Overall Status')).toLowerCase();
  spring.set(candidateEmail,
    status === 'completed' ? 'done' :
    status === 'completed with exception' ? 'exception' :
    status ? 'awaited' : null
  );
}

const output = [];
const syncRunId = String($execution.id);
for (const row of masterRows) {
  const candidateEmail = email(row, 'Email');
  if (!candidateEmail || text(read(row, 'Status')).toLowerCase() !== 'active') continue;

  const fullName = [text(read(row, 'First Name')), text(read(row, 'Last name', 'Last Name'))].filter(Boolean).join(' ');
  const sourceDomain = text(read(row, 'Domain'));
  const domain = /^(coding|stem|mojave)$/i.test(sourceDomain) ? null : sourceDomain;
  const contractStatus = signed.has(candidateEmail) ? 'signed' : sent.has(candidateEmail) ? 'sent' : null;
  const projects = text(read(row, 'Project'))
    .split(/[,;/]+/)
    .map((value) => value.trim().toLowerCase().replace(/\s+/g, ' '))
    .filter(Boolean);

  for (const token of projects) {
    const project = PROJECTS[token];
    if (!project) continue;
    output.push({ json: {
      p_email: candidateEmail,
      p_full_name: fullName || null,
      p_client: 'Snorkel',
      p_vertical: project.vertical,
      p_project: project.project,
      p_domain: domain || null,
      p_bgv_id_status: spring.get(candidateEmail) || null,
      p_contract_status: contractStatus,
      p_source_key: 'snorkel-master-user',
      p_source_priority: 90,
      p_source_sheet: 'Snorkel MainSentinel Ultra Coding Projects (Internal) / Master User - Snorkel',
      p_source_row: row.row_number || null,
      p_sync_run_id: syncRunId,
      p_membership_authoritative: true,
    } });
  }
}

return output;`;

const paperbenchNormalizer = String.raw`const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PROJECTS = {
  riga: { vertical: 'STEM', project: 'Riga' },
  rainier: { vertical: 'STEM', project: 'Rainier' },
  sequoia: { vertical: 'STEM', project: 'Sequoia' },
  starfish: { vertical: 'STEM', project: 'Starfish' },
  terminus: { vertical: 'Coding', project: 'Terminus' },
  paperbench: { vertical: 'Coding', project: 'PaperBench' },
  'paper bench': { vertical: 'Coding', project: 'PaperBench' },
  'sentinel ultra': { vertical: 'Coding', project: 'Sentinel Ultra' },
  'sentinal ultra': { vertical: 'Coding', project: 'Sentinel Ultra' },
};
function key(value) { return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''); }
function read(row, ...names) {
  const entries = Object.entries(row || {});
  for (const name of names.map(key)) {
    const match = entries.find(([column, value]) => key(column) === name && value !== null && value !== undefined);
    if (match) return match[1];
  }
  return '';
}
function text(value) { return String(value ?? '').trim(); }
function springverify(value) {
  const status = text(value).toLowerCase();
  if (status === 'complete' || status === 'completed' || status === 'verified' || status === 'approved') return 'done';
  if (status.includes('exception')) return 'exception';
  if (status) return 'awaited';
  return null;
}
function remofirst(value) {
  const status = text(value).toLowerCase();
  if (status.includes('approved') || status.includes('verified')) return 'approved';
  if (status.includes('not started') || status.includes('not received') || status.includes('rejected')) return 'not_received';
  if (status.includes('pending') || status.includes('sent')) return 'pending';
  return null;
}
function contract(signed, sent) {
  const signedStatus = text(signed).toLowerCase();
  const sentStatus = text(sent).toLowerCase();
  if (/signed|complete|yes|true/.test(signedStatus)) return 'signed';
  if (/sent|shared/.test(sentStatus)) return 'sent';
  if (/not sent|not started|no/.test(sentStatus)) return 'not_signed';
  return null;
}
const output = [];
const syncRunId = String($execution.id);
for (const item of items) {
  const row = item.json;
  const candidateEmail = text(read(row, 'Email', 'Personal Email')).toLowerCase();
  if (!EMAIL_RE.test(candidateEmail) || text(read(row, 'Status')).toLowerCase() !== 'active') continue;
  const fullName = [text(read(row, 'First Name')), text(read(row, 'Last name', 'Last Name'))].filter(Boolean).join(' ');
  const sourceDomain = text(read(row, 'Domain'));
  const domain = /^(coding|stem|mojave)$/i.test(sourceDomain) ? null : sourceDomain;
  const common = {
    p_email: candidateEmail,
    p_full_name: fullName || null,
    p_client: 'Snorkel',
    p_domain: domain || null,
    p_bgv_id_status: springverify(read(row, 'CH Background Check')),
    p_remofirst_status: remofirst(read(row, 'RemoFirst Check')),
    p_contract_status: contract(read(row, 'Contracts Signed'), read(row, 'Contract Sent')),
    p_source_key: 'paperbench-live-candidates',
    p_source_priority: 80,
    p_source_sheet: 'Snorkel MainPaperBench Internal / PaperBench Live Candidates',
    p_source_row: row.row_number || null,
    p_sync_run_id: syncRunId,
    p_membership_authoritative: true,
  };
  for (const token of text(read(row, 'Project')).split(/[,;/]+/).map((value) => value.trim().toLowerCase().replace(/\s+/g, ' '))) {
    const project = PROJECTS[token];
    if (project) output.push({ json: { ...common, p_vertical: project.vertical, p_project: project.project } });
  }
}
return output;`;

const sentinelTaskNormalizer = String.raw`const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function key(value) { return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''); }
function read(row, ...names) {
  const entries = Object.entries(row || {});
  for (const name of names.map(key)) {
    const match = entries.find(([column, value]) => key(column) === name && value !== null && value !== undefined);
    if (match) return match[1];
  }
  return '';
}
const byEmail = new Map();
for (const item of items) {
  const row = item.json;
  const email = String(read(row, 'Email')).trim().toLowerCase();
  if (!EMAIL_RE.test(email)) continue;
  const status = String(read(row, 'Status')).trim().toLowerCase();
  const metric = byEmail.get(email) || { submitted: 0, accepted: 0, rejected: 0, rework: 0, evaluation_pending: 0 };
  metric.submitted += 1;
  if (status === 'accepted' || status === 'approved') metric.accepted += 1;
  else if (status === 'rejected') metric.rejected += 1;
  else if (status === 'needs revision' || status === 'rework') metric.rework += 1;
  else metric.evaluation_pending += 1;
  byEmail.set(email, metric);
}
const asOf = new Date().toISOString().slice(0, 10);
return [...byEmail.entries()].map(([email, metric]) => ({ json: {
  p_email: email,
  p_client: 'Snorkel',
  p_vertical: 'Coding',
  p_project_slug: 'Sentinel Ultra',
  p_as_of: asOf,
  p_submitted: metric.submitted,
  p_accepted: metric.accepted,
  p_rejected: metric.rejected,
  p_rework: metric.rework,
  p_evaluation_pending: metric.evaluation_pending,
  p_source_sheet: 'Snorkel MainSentinel Ultra Coding Projects (Internal) / Sentinel Task Pull',
  p_metric_kind: 'cumulative',
  p_allow_missing_assignment: true,
} }));`;

const paperTaskNormalizer = String.raw`const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function key(value) { return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''); }
function read(row, ...names) {
  const entries = Object.entries(row || {});
  for (const name of names.map(key)) {
    const match = entries.find(([column, value]) => key(column) === name && value !== null && value !== undefined);
    if (match) return match[1];
  }
  return '';
}
function count(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parsed = Number(raw.replace(/[,\s]/g, ''));
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : null;
}
const asOf = new Date().toISOString().slice(0, 10);
const output = [];
for (const item of items) {
  const row = item.json;
  const email = String(read(row, 'email', 'Email')).trim().toLowerCase();
  if (!EMAIL_RE.test(email)) continue;
  output.push({ json: {
    p_email: email,
    p_client: 'Snorkel',
    p_vertical: 'Coding',
    p_project_slug: 'PaperBench',
    p_as_of: asOf,
    p_submitted: count(read(row, 'Task Count (All-Time)', 'Task Count (All Time)', 'Submitted')),
    p_accepted: count(read(row, 'Accepted')),
    p_rejected: count(read(row, 'Rejected')),
    p_rework: count(read(row, 'Needs Revision', 'Requiring Rework', 'Rework')),
    p_evaluation_pending: count(read(row, 'To Be Reviewed', 'Evaluation Pending')),
    p_source_sheet: 'v.2 [EXTERNAL] Paperbench <> Crossing Hurdles Tracker / Activity Tracker',
    p_metric_kind: 'cumulative',
    p_allow_missing_assignment: true,
  } });
}
return output;`;

const trigger = addNode(
  "Schedule Trigger - Unified Portal Data",
  "n8n-nodes-base.scheduleTrigger",
  1.2,
  [-2160, 1260],
  { rule: { interval: [{ field: "days", daysInterval: 3, triggerAtHour: 0, triggerAtMinute: 0 }] } },
);

const master = sheets("Read Snorkel Master User", "1v3kh9OvhoX7M2jADIeY8d1ihrrRqGz4_44TzEXSJXpk", "Master User - Snorkel", [-1920, 1120]);
const contractSent = sheets("Read Snorkel Contracts Sent", "1v3kh9OvhoX7M2jADIeY8d1ihrrRqGz4_44TzEXSJXpk", "Contracts Sent", [-1920, 1240]);
const contractSigned = sheets("Read Snorkel Contracts Signed", "1v3kh9OvhoX7M2jADIeY8d1ihrrRqGz4_44TzEXSJXpk", "contract signed", [-1920, 1360]);
const springverify = sheets("Read Snorkel SpringVerify", "1v3kh9OvhoX7M2jADIeY8d1ihrrRqGz4_44TzEXSJXpk", "SpringVerify Pull", [-1920, 1480]);
const tagMaster = tag("Tag Snorkel Master", "master", [-1680, 1120]);
const tagSent = tag("Tag Contracts Sent", "contract_sent", [-1680, 1240]);
const tagSigned = tag("Tag Contracts Signed", "contract_signed", [-1680, 1360]);
const tagSpring = tag("Tag SpringVerify", "springverify", [-1680, 1480]);
const mergeMasterSent = addNode("Merge Master + Contract Sent", "n8n-nodes-base.merge", 3, [-1440, 1180], {});
const mergeSigned = addNode("Merge + Contract Signed", "n8n-nodes-base.merge", 3, [-1200, 1240], {});
const mergeSpring = addNode("Merge + SpringVerify", "n8n-nodes-base.merge", 3, [-960, 1300], {});
const normalizeMaster = code("Normalize Unified Candidate Assignments", masterNormalizer, [-720, 1300]);
const batchMaster = code("Batch Unified Candidate Assignments", assignmentBatchCode, [-480, 1300]);
const upsertMaster = http("Upsert Unified Candidate Assignments", "upsert_portal_assignments_batch", [-240, 1300]);
const validateMaster = code("Validate Unified Candidate Assignments", validateCode, [0, 1300]);

for (const source of [master, contractSent, contractSigned, springverify]) connect(trigger, source);
connect(master, tagMaster); connect(contractSent, tagSent); connect(contractSigned, tagSigned); connect(springverify, tagSpring);
connect(tagMaster, mergeMasterSent, 0); connect(tagSent, mergeMasterSent, 1);
connect(mergeMasterSent, mergeSigned, 0); connect(tagSigned, mergeSigned, 1);
connect(mergeSigned, mergeSpring, 0); connect(tagSpring, mergeSpring, 1);
connect(mergeSpring, normalizeMaster); connect(normalizeMaster, batchMaster); connect(batchMaster, upsertMaster); connect(upsertMaster, validateMaster);

const paperCandidates = sheets("Read PaperBench Live Candidates - Unified", "1zgjIRlGOl2i7ZMFCufcxAIpU4SbSJgrQW1XBzJw2mQc", "PaperBench Live Candidates", [240, 1120]);
const normalizePaperCandidates = code("Normalize PaperBench Status - Unified", paperbenchNormalizer, [480, 1120]);
const batchPaperCandidates = code("Batch PaperBench Status - Unified", assignmentBatchCode, [720, 1120]);
const upsertPaperCandidates = http("Upsert PaperBench Status - Unified", "upsert_portal_assignments_batch", [960, 1120]);
const validatePaperCandidates = code("Validate PaperBench Status - Unified", validateCode, [1200, 1120]);
connect(validateMaster, paperCandidates); connect(paperCandidates, normalizePaperCandidates); connect(normalizePaperCandidates, batchPaperCandidates); connect(batchPaperCandidates, upsertPaperCandidates); connect(upsertPaperCandidates, validatePaperCandidates);

const sentinelTasks = sheets("Read Sentinel Task Pull - Unified", "1v3kh9OvhoX7M2jADIeY8d1ihrrRqGz4_44TzEXSJXpk", "Sentinel Task Pull", [240, 1320]);
const normalizeSentinelTasks = code("Normalize Sentinel Tasks - Unified", sentinelTaskNormalizer, [480, 1320]);
const batchSentinelTasks = code("Batch Sentinel Tasks - Unified", metricBatchCode, [720, 1320]);
const upsertSentinelTasks = http("Upsert Sentinel Tasks - Unified", "upsert_task_metrics_batch", [960, 1320], 30000);
const validateSentinelTasks = code("Validate Sentinel Tasks - Unified", validateCode, [1200, 1320]);
connect(validateMaster, sentinelTasks); connect(sentinelTasks, normalizeSentinelTasks); connect(normalizeSentinelTasks, batchSentinelTasks); connect(batchSentinelTasks, upsertSentinelTasks); connect(upsertSentinelTasks, validateSentinelTasks);

const paperTasks = sheets("Read PaperBench Activity - Unified", "1Tzgi8zIZddLkllQ5bYI6z8UNNdJTD8F1pbHACcygYuc", "Activity Tracker", [1440, 1120]);
const normalizePaperTasks = code("Normalize PaperBench Tasks - Unified", paperTaskNormalizer, [1680, 1120]);
const batchPaperTasks = code("Batch PaperBench Tasks - Unified", metricBatchCode, [1920, 1120]);
const upsertPaperTasks = http("Upsert PaperBench Tasks - Unified", "upsert_task_metrics_batch", [2160, 1120], 30000);
const validatePaperTasks = code("Validate PaperBench Tasks - Unified", validateCode, [2400, 1120]);
connect(validatePaperCandidates, paperTasks); connect(paperTasks, normalizePaperTasks); connect(normalizePaperTasks, batchPaperTasks); connect(batchPaperTasks, upsertPaperTasks); connect(upsertPaperTasks, validatePaperTasks);

const selection = {
  nodes,
  connections,
  pinData: {},
  meta: { templateCredsSetupCompleted: true },
};

writeFileSync(new URL("../n8n/unified-portal-branches.selection.json", import.meta.url), `${JSON.stringify(selection, null, 2)}\n`);
