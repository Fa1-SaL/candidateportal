import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const unifiedOutputUrl = new URL("../n8n/unified-portal-branches.selection.json", import.meta.url);
let existingNodes = [];
try {
  existingNodes = JSON.parse(readFileSync(unifiedOutputUrl, "utf8")).nodes ?? [];
} catch {
  existingNodes = [];
}
const existingNodeIds = new Map(existingNodes.map((node) => [node.name, node.id]));
const existingAssignmentIds = new Map(
  existingNodes.flatMap((node) =>
    (node.parameters?.assignments?.assignments ?? []).map((assignment) => [
      `${node.name}\u0000${assignment.name}`,
      assignment.id,
    ]),
  ),
);
const existingStandaloneIds = new Map();
for (const relativePath of [
  "../n8n/stem-july-2026-payments.selection.json",
  "../n8n/project-july-2026-payments.selection.json",
]) {
  try {
    const standalone = JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
    for (const node of standalone.nodes ?? []) existingStandaloneIds.set(node.name, node.id);
  } catch {
    // The standalone files are generated on the first run.
  }
}

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
    id: existingNodeIds.get(name) ?? randomUUID(),
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

function sheets(name, documentId, sheetName, position, options = {}) {
  return addNode(
    name,
    "n8n-nodes-base.googleSheets",
    4.5,
    position,
    {
      documentId: { __rl: true, value: documentId, mode: "id" },
      sheetName: { __rl: true, value: sheetName, mode: "name" },
      options,
    },
    googleCredential,
  );
}

function tag(name, source, position) {
  return addNode(name, "n8n-nodes-base.set", 3.4, position, {
    assignments: {
      assignments: [
        {
          id: existingAssignmentIds.get(`${name}\u0000_source`) ?? randomUUID(),
          name: "_source",
          value: source,
          type: "string",
        },
      ],
    },
    includeOtherFields: true,
    options: {},
  });
}

function code(name, jsCode, position) {
  return addNode(name, "n8n-nodes-base.code", 2, position, { jsCode });
}

function httpBody(name, rpc, jsonBody, position, timeout = 120000) {
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
      jsonBody,
      options: { timeout },
    },
    supabaseCredential,
  );
}

function http(name, rpc, position, timeout = 120000) {
  return httpBody(
    name,
    rpc,
    '={{ { "p_rows": $json.p_rows } }}',
    position,
    timeout,
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

const taskSnapshotBatchCode = `const rows = items.map((item) => item.json).filter((row) => row.p_email);
if (!rows.length) throw new Error('Task snapshot returned no active task rows');
const sourceKeys = [...new Set(rows.map((row) => row.p_source_key).filter(Boolean))];
const syncRunIds = [...new Set(rows.map((row) => row.p_sync_run_id).filter(Boolean))];
if (sourceKeys.length !== 1) throw new Error('Task snapshot must contain exactly one source key');
if (syncRunIds.length !== 1) throw new Error('Task snapshot must contain exactly one run ID');
const chunks = [];
for (let index = 0; index < rows.length; index += 50) {
  chunks.push({ json: {
    p_source_key: sourceKeys[0],
    p_sync_run_id: syncRunIds[0],
    p_rows: rows.slice(index, index + 50),
  } });
}
return chunks;`;

function taskSnapshotFinalizeCode(normalizerNodeName) {
  return `const rows = $(${JSON.stringify(normalizerNodeName)}).all().map((item) => item.json);
if (!rows.length) throw new Error('Cannot finalize an empty task snapshot');
const sourceKeys = [...new Set(rows.map((row) => row.p_source_key).filter(Boolean))];
const syncRunIds = [...new Set(rows.map((row) => row.p_sync_run_id).filter(Boolean))];
if (sourceKeys.length !== 1) throw new Error('Task snapshot has inconsistent source keys');
if (syncRunIds.length !== 1) throw new Error('Task snapshot has inconsistent run IDs');
return [{ json: {
  p_source_key: sourceKeys[0],
  p_sync_run_id: syncRunIds[0],
  p_expected_count: rows.length,
} }];`;
}

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
  skipped_rows: results
    .filter((row) => row?.out_status === 'skipped')
    .map((row) => ({
      email: row.out_email,
      project: row.out_project,
      component: row.out_component,
      reason: row.out_message,
      amount: row.out_amount,
    })),
} }];`;

const strictValidateCode = `const results = items.flatMap((item) => {
  if (Array.isArray(item.json)) return item.json;
  if (Array.isArray(item.json?.body)) return item.json.body;
  if (Array.isArray(item.json?.data)) return item.json.data;
  return [item.json];
});
const rejected = results.filter((row) => row?.out_status !== 'ok');
if (rejected.length) {
  throw new Error('Supabase did not accept ' + rejected.length + ' rows: ' + JSON.stringify(rejected.slice(0, 20)));
}
return [{ json: { processed: results.length, skipped: 0 } }];`;

const masterNormalizer = String.raw`const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Project membership must come from one authoritative roster. The Snorkel
// master owns Sentinel Ultra and Mojave; STEM, PaperBench, and the remaining
// coding projects are finalized from their dedicated live rosters.
const PROJECTS = {
  mojave: { vertical: 'Mojave', project: 'Mojave' },
  'sentinel ultra': { vertical: 'Coding', project: 'Sentinel Ultra' },
  'sentinal ultra': { vertical: 'Coding', project: 'Sentinel Ultra' },
  'sentinel ultra terminus': { vertical: 'Coding', project: 'Sentinel Ultra' },
  'sentinal ultra terminus': { vertical: 'Coding', project: 'Sentinel Ultra' },
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
function remofirst(value) {
  const status = text(value).toLowerCase();
  if (!status) return null;
  if (/approved|verified|complete|completed|signed/.test(status)) return 'approved';
  if (/not started|not received|rejected|declined/.test(status)) return 'not_received';
  if (/pending|sent|progress|processing|action required/.test(status)) return 'pending';
  return null;
}
function directContract(row) {
  const status = text(read(row, 'Contract Status', 'Contract Signed', 'Contracts Signed', 'Contract')).toLowerCase();
  if (/signed|complete|completed|yes|true/.test(status) && !/not signed/.test(status)) return 'signed';
  if (/not signed|not sent|not started|no/.test(status)) return 'not_signed';
  if (/sent|shared/.test(status)) return 'sent';
  return null;
}

// Read each completed branch directly. This prevents a partial Merge payload from
// silently downgrading signed candidates when the source sheets grow large.
const masterRows = $('Tag Snorkel Master').all().map((item) => item.json);
const sentRows = $('Tag Contracts Sent').all().map((item) => item.json);
const signedRows = $('Tag Contracts Signed').all().map((item) => item.json);
const springRows = $('Tag SpringVerify').all().map((item) => item.json);
if (!masterRows.length) throw new Error('Master User - Snorkel returned no rows');
if (!sentRows.length) throw new Error('Contracts Sent returned no rows');
if (!signedRows.length) throw new Error('contract signed returned no rows');
if (!springRows.length) throw new Error('SpringVerify Pull returned no rows');

const sent = new Set();
for (const row of sentRows) {
  const candidateEmail = email(row, 'Email', 'Recipient Email', 'Candidate Email', 'Email Address');
  const status = text(read(row, 'Action', 'Status', 'Contract Status')).toLowerCase();
  if (candidateEmail && (!status || /sent|shared/.test(status))) sent.add(candidateEmail);
}
const signed = new Set();
for (const row of signedRows) {
  const candidateEmail = email(row, 'Recipient Email', 'Email', 'Candidate Email', 'Email Address');
  const action = text(read(row, 'Action', 'Status', 'Contract Status')).toLowerCase();
  if (candidateEmail && (!action || /signed|complete|completed/.test(action))) signed.add(candidateEmail);
}
const spring = new Map();

for (const row of springRows) {
  const candidateEmail = email(row, 'Email', 'Candidate Email', 'Email Address');
  if (!candidateEmail) continue;
  const status = text(read(row, 'Overall Status')).toLowerCase();
  spring.set(candidateEmail,
    status === 'completed' ? 'done' :
    status === 'completed with exception' ? 'exception' :
    status ? 'awaited' : null
  );
}

const activeMasterEmails = new Set(
  masterRows
    .filter((row) => text(read(row, 'Status')).toLowerCase() === 'active')
    .map((row) => email(row, 'Email'))
    .filter(Boolean),
);
if (![...signed].some((candidateEmail) => activeMasterEmails.has(candidateEmail))) {
  throw new Error('contract signed has no overlap with active Master User candidates');
}

const output = [];
const syncRunId = String($execution.id);
for (const row of masterRows) {
  const candidateEmail = email(row, 'Email');
  if (!candidateEmail || text(read(row, 'Status')).toLowerCase() !== 'active') continue;

  const fullName = [text(read(row, 'First Name')), text(read(row, 'Last name', 'Last Name'))].filter(Boolean).join(' ');
  const sourceDomain = text(read(row, 'Domain'));
  const domain = /^(coding|stem|mojave)$/i.test(sourceDomain) ? null : sourceDomain;
  const contractStatus = signed.has(candidateEmail)
    ? 'signed'
    : sent.has(candidateEmail)
      ? 'sent'
      : directContract(row);
  const remofirstStatus = remofirst(read(
    row,
    'Snorkel KYC Check',
    'RemoFirst Check',
    'Remofirst Status',
    'RemoFirst Verification',
  ));
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
      p_remofirst_status: remofirstStatus,
      p_contract_status: contractStatus,
      p_source_key: 'snorkel-master-user',
      p_source_priority: 90,
      p_source_sheet: 'Snorkel MainSentinel Ultra Coding Projects (Internal) / Master User - Snorkel; Contracts Sent; contract signed; SpringVerify Pull',
      p_source_row: row.row_number || null,
      p_sync_run_id: syncRunId,
      p_membership_authoritative: true,
    } });
  }
}

return output;`;

const paperbenchNormalizer = String.raw`const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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
  if (status.includes('pending') || status.includes('sent') || status.includes('action required')) return 'pending';
  return null;
}
function contract(signed, sent) {
  const signedStatus = text(signed).toLowerCase();
  const sentStatus = text(sent).toLowerCase();
  if (/signed|complete|yes|true/.test(signedStatus)) return 'signed';
  if (/not sent|not started|no/.test(sentStatus)) return 'not_signed';
  if (/sent|shared/.test(sentStatus)) return 'sent';
  return null;
}
const output = [];
const syncRunId = String($execution.id);
for (const item of items) {
  const row = item.json;
  const candidateEmail = text(read(row, 'Email', 'Personal Email')).toLowerCase();
  if (!EMAIL_RE.test(candidateEmail) || text(read(row, 'Status')).toLowerCase() !== 'active') continue;
  const projects = text(read(row, 'Project'))
    .split(/[,;/]+/)
    .map((value) => value.trim().toLowerCase().replace(/\s+/g, ' '));
  if (!projects.some((project) => project === 'paperbench' || project === 'paper bench')) continue;
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
    p_source_priority: 100,
    p_source_sheet: 'Snorkel MainPaperBench Internal / PaperBench Live Candidates',
    p_source_row: row.row_number || null,
    p_sync_run_id: syncRunId,
    p_membership_authoritative: true,
  };
  output.push({ json: { ...common, p_vertical: 'Coding', p_project: 'PaperBench' } });
}
if (!output.length) throw new Error('PaperBench Live Candidates returned no active PaperBench candidates');
return output;`;

const sentinelTaskNormalizer = String.raw`const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function key(value) { return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''); }
function text(value) { return String(value ?? '').trim(); }
function read(row, ...names) {
  const entries = Object.entries(row || {});
  for (const name of names.map(key)) {
    const match = entries.find(([column, value]) => key(column) === name && value !== null && value !== undefined);
    if (match) return match[1];
  }
  return '';
}
function status(value) {
  const normalized = text(value).toLowerCase();
  if (['accepted', 'approved', 'provisionally accepted', 'completed'].includes(normalized)) return 'accepted';
  if (['rejected', 'invalid'].includes(normalized)) return 'rejected';
  if (['needs revision', 'needs_revision', 'rework', 'requiring rework'].includes(normalized)) return 'rework';
  if (['waiting for review', 'pending review', 'pending eval', 'pending evaluation', 'evaluation pending', 'evaluation_pending', 'submitted', 'in progress', 'assigned'].includes(normalized)) return 'evaluation_pending';
  if (['expired', 'skipped', 'offered'].includes(normalized)) return null;
  throw new Error('Sentinel Task Pull: unsupported status ' + JSON.stringify(value));
}
function timestamp(value) {
  const raw = text(value);
  if (!raw) return 0;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) throw new Error('Sentinel Task Pull: invalid Last Action At ' + JSON.stringify(value));
  return parsed;
}
const assignedEmails = new Set(
  $('Normalize Unified Candidate Assignments').all()
    .map((item) => item.json)
    .filter((row) => row.p_vertical === 'Coding' && row.p_project === 'Sentinel Ultra')
    .map((row) => row.p_email),
);
const syncRunId = String($execution.id);
const events = new Map();
for (const item of items) {
  const row = item.json;
  const email = text(read(row, 'Email')).toLowerCase();
  const taskId = text(read(row, 'Task ID'));
  const submissionId = text(read(row, 'Submission ID'));
  if (!email && !taskId) continue;
  if (!EMAIL_RE.test(email)) throw new Error('Sentinel Task Pull: invalid email ' + JSON.stringify(email));
  if (!taskId) throw new Error('Sentinel Task Pull: missing task ID for ' + email);
  if (!assignedEmails.has(email)) continue;
  const eventKey = ['sentinel-ultra', email, taskId.toLowerCase()].join('|');
  const actionAt = text(read(row, 'Last Action At'));
  const normalizedStatus = status(read(row, 'Status', 'Task Status'));
  const candidate = {
    _include: normalizedStatus !== null,
    _sort_at: timestamp(actionAt),
    p_event_key: eventKey,
    p_task_external_id: taskId,
    p_submission_external_id: submissionId || null,
    p_email: email,
    p_client: 'Snorkel',
    p_vertical: 'Coding',
    p_project_slug: 'Sentinel Ultra',
    p_project_name_raw: 'Sentinel Ultra',
    p_task_type: text(read(row, 'Task Type')) || null,
    p_status: normalizedStatus,
    p_submitted_at_source: actionAt || null,
    p_final_outcome: text(read(row, 'EC Valid (Fixable/Invalid/Valid-as-is)')) || null,
    p_source_sheet: 'Snorkel MainSentinel Ultra Coding Projects (Internal) / Sentinel Task Pull',
    p_source_key: 'task-source:sentinel-ultra',
    p_sync_run_id: syncRunId,
    p_allow_missing_assignment: false,
  };
  const existing = events.get(eventKey);
  if (!existing || candidate._sort_at > existing._sort_at) {
    events.set(eventKey, candidate);
  } else if (candidate._sort_at === existing._sort_at) {
    if (candidate._include && !existing._include) {
      events.set(eventKey, candidate);
    } else if (candidate._include === existing._include && candidate.p_status !== existing.p_status) {
      throw new Error('Sentinel Task Pull: ambiguous latest status for ' + eventKey);
    }
  }
}
const activeEvents = [...events.values()].filter((row) => row._include);
if (!activeEvents.length) throw new Error('Sentinel Task Pull returned no submitted tasks for active Sentinel Ultra candidates');
return activeEvents
  .sort((left, right) => left.p_event_key.localeCompare(right.p_event_key))
  .map(({ _include, _sort_at, ...row }) => ({ json: row }));`;

const paperTaskNormalizer = String.raw`const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function key(value) { return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''); }
function text(value) { return String(value ?? '').trim(); }
function read(row, ...names) {
  const entries = Object.entries(row || {});
  for (const name of names.map(key)) {
    const match = entries.find(([column, value]) => key(column) === name && value !== null && value !== undefined);
    if (match) return match[1];
  }
  return '';
}
function status(value) {
  const normalized = text(value).toLowerCase();
  if (['accepted', 'approved', 'provisionally accepted'].includes(normalized)) return 'accepted';
  if (['rejected', 'invalid'].includes(normalized)) return 'rejected';
  if (['needs revision', 'needs_revision', 'rework', 'requiring rework'].includes(normalized)) return 'rework';
  if (['waiting for review', 'pending review', 'evaluation pending', 'evaluation_pending'].includes(normalized)) return 'evaluation_pending';
  throw new Error('PaperBench CH-auto-import: unsupported status ' + JSON.stringify(value));
}
const assignedEmails = new Set(
  $('Normalize PaperBench Status - Unified').all()
    .map((item) => item.json)
    .filter((row) => row.p_vertical === 'Coding' && row.p_project === 'PaperBench')
    .map((row) => row.p_email),
);
const syncRunId = String($execution.id);
const events = new Map();
for (const item of items) {
  const row = item.json;
  const email = text(read(row, 'Assignee', 'Email')).toLowerCase();
  const taskId = text(read(row, 'Task ID'));
  if (!email && !taskId) continue;
  if (!EMAIL_RE.test(email)) throw new Error('PaperBench CH-auto-import: invalid email ' + JSON.stringify(email));
  if (!taskId) throw new Error('PaperBench CH-auto-import: missing task ID for ' + email);
  if (!assignedEmails.has(email)) continue;
  const eventKey = ['paperbench', email, taskId.toLowerCase()].join('|');
  if (events.has(eventKey)) throw new Error('PaperBench CH-auto-import: duplicate candidate/task pair ' + eventKey);
  events.set(eventKey, {
    p_event_key: eventKey,
    p_task_external_id: taskId,
    p_email: email,
    p_client: 'Snorkel',
    p_vertical: 'Coding',
    p_project_slug: 'PaperBench',
    p_project_name_raw: text(read(row, 'Project Name')) || 'PaperBench',
    p_task_type: text(read(row, 'Task Type')) || null,
    p_status: status(read(row, 'Task Status', 'Status')),
    p_created_at_source: text(read(row, 'Created At')) || null,
    p_submitted_at_source: text(read(row, 'Last Submitted At')) || null,
    p_bpo_source: text(read(row, 'BPO Source')) || null,
    p_final_outcome: text(read(row, 'Final Outcome')) || null,
    p_source_sheet: 'v.2 [EXTERNAL] Paperbench <> Crossing Hurdles Tracker / CH-auto-import',
    p_source_key: 'task-source:paperbench',
    p_sync_run_id: syncRunId,
    p_allow_missing_assignment: false,
  });
}
if (!events.size) throw new Error('PaperBench CH-auto-import returned no tasks for active PaperBench candidates');
return [...events.values()]
  .sort((left, right) => left.p_event_key.localeCompare(right.p_event_key))
  .map((row) => ({ json: row }));`;

const codingRosterNormalizer = String.raw`const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SOURCES = {
  terminus: {
    project: 'Terminus',
    sourceKey: 'coding-project-roster:terminus',
    sourceSheet: 'Snorkel MainTerminus Coding Projects - Internal Dhruv / Terminus 2nd Edition Live',
  },
  otter: {
    project: 'Otter',
    sourceKey: 'coding-project-roster:otter',
    sourceSheet: 'Snorkel MainOtter ML Experts - Internal Dhruv / MainOtter Live Candidates',
  },
  suitelife: {
    project: 'SuiteLife',
    sourceKey: 'coding-project-roster:suitelife',
    sourceSheet: 'Snorkel MainSuiteLife Internal / SuiteLife Live Candidates',
  },
  rudder: {
    project: 'Rudder',
    sourceKey: 'coding-project-roster:rudder',
    sourceSheet: 'Snorkel MainRudder Internal / Rudder Live Candidates',
  },
};

function key(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}
function text(value) {
  return String(value ?? '').trim();
}
function read(row, ...names) {
  const entries = Object.entries(row || {});
  for (const name of names.map(key)) {
    const exact = entries.find(([column, value]) => key(column) === name && text(value) !== '');
    if (exact) return exact[1];
  }
  return '';
}
function verification(value) {
  const status = text(value).toLowerCase();
  if (!status) return null;
  if (status.includes('exception')) return 'exception';
  if (/complete|verified|approved|green|done/.test(status)) return 'done';
  if (/pending|progress|await|not started|triggered|sent/.test(status)) return 'awaited';
  return null;
}
function verificationFromRow(row) {
  const acceptedKeys = ['chbackgroundcheck', 'springverifycheck', 'springverifypull', 'bgv'];
  for (const [column, value] of Object.entries(row || {})) {
    const columnKey = key(column);
    if (!acceptedKeys.some((candidate) => columnKey === candidate || columnKey.startsWith(candidate))) continue;
    const normalized = verification(value);
    if (normalized) return normalized;
  }
  return null;
}
function remofirst(value) {
  const status = text(value).toLowerCase();
  if (!status) return null;
  if (/approved|verified|complete/.test(status)) return 'approved';
  if (/not started|not received|rejected/.test(status)) return 'not_received';
  if (/pending|sent|progress/.test(status)) return 'pending';
  return null;
}
function contract(signedValue, sentValue) {
  const signed = text(signedValue).toLowerCase();
  const sent = text(sentValue).toLowerCase();
  if (/signed|complete|completed|yes|true/.test(signed)) return 'signed';
  if (/not sent|not started|no/.test(sent)) return 'not_signed';
  if (/sent|shared/.test(sent)) return 'sent';
  return null;
}

const syncRunId = String($execution.id);
const assignments = new Map();
for (const item of items) {
  const row = item.json;
  const source = SOURCES[text(row._source).toLowerCase()];
  if (!source) throw new Error('Unknown coding roster source: ' + JSON.stringify(row._source));

  const candidateEmail = text(read(row, 'Email', 'Personal Email')).toLowerCase();
  const status = text(read(row, 'Status')).toLowerCase();
  const bpo = key(read(row, 'BPO'));
  if (!candidateEmail && !status && !bpo) continue;
  if (status !== 'active' || bpo !== 'crossinghurdles') {
    continue;
  }
  if (!EMAIL_RE.test(candidateEmail)) {
    throw new Error(source.project + ': invalid active candidate email ' + JSON.stringify(candidateEmail));
  }

  const fullName = [text(read(row, 'First Name')), text(read(row, 'Last name', 'Last Name'))]
    .filter(Boolean)
    .join(' ');
  const sourceDomain = text(read(row, 'Domain'));
  const assignment = {
    p_email: candidateEmail,
    p_full_name: fullName || null,
    p_client: 'Snorkel',
    p_vertical: 'Coding',
    p_project: source.project,
    p_domain: /^(coding|stem|mojave)$/i.test(sourceDomain) ? null : sourceDomain || null,
    p_bgv_id_status: verificationFromRow(row),
    p_remofirst_status: remofirst(read(row, 'RemoFirst Check')),
    p_contract_status: contract(
      read(row, 'Contract Signed', 'Contracts Signed', 'Contract'),
      read(row, 'Contract Sent', 'Contracts Sent', 'Contract'),
    ),
    p_source_key: source.sourceKey,
    p_source_priority: 100,
    p_source_sheet: source.sourceSheet,
    p_source_row: row.row_number || null,
    p_sync_run_id: syncRunId,
    p_membership_authoritative: true,
  };
  const assignmentKey = source.sourceKey + '|' + candidateEmail;
  const existing = assignments.get(assignmentKey);
  if (!existing) {
    assignments.set(assignmentKey, assignment);
  } else {
    for (const field of ['p_full_name', 'p_domain', 'p_bgv_id_status', 'p_remofirst_status', 'p_contract_status']) {
      if (!existing[field] && assignment[field]) existing[field] = assignment[field];
    }
  }
}

for (const source of Object.values(SOURCES)) {
  const count = [...assignments.values()].filter((row) => row.p_source_key === source.sourceKey).length;
  if (count === 0) throw new Error('No active Crossing Hurdles rows found for ' + source.project);
}

return [...assignments.values()]
  .sort((left, right) => [left.p_project, left.p_email].join('|').localeCompare([right.p_project, right.p_email].join('|')))
  .map((row) => ({ json: row }));`;

const rosterSnapshotNormalizer = String.raw`const rows = $('Normalize Coding Project Rosters').all().map((item) => item.json);
const expectedSources = [
  'coding-project-roster:terminus',
  'coding-project-roster:otter',
  'coding-project-roster:suitelife',
  'coding-project-roster:rudder',
];
return expectedSources.map((sourceKey) => {
  const sourceRows = rows.filter((row) => row.p_source_key === sourceKey);
  if (!sourceRows.length) throw new Error('Cannot finalize empty roster snapshot: ' + sourceKey);
  const syncRunIds = [...new Set(sourceRows.map((row) => row.p_sync_run_id))];
  if (syncRunIds.length !== 1 || !syncRunIds[0]) throw new Error('Roster snapshot has inconsistent run IDs: ' + sourceKey);
  return { json: {
    p_source_key: sourceKey,
    p_sync_run_id: syncRunIds[0],
    p_expected_count: sourceRows.length,
  } };
});`;

const terminusTaskNormalizer = String.raw`const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function key(value) { return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''); }
function text(value) { return String(value ?? '').trim(); }
function read(row, ...names) {
  const entries = Object.entries(row || {});
  for (const name of names.map(key)) {
    const match = entries.find(([column, value]) => key(column) === name && value !== null && value !== undefined);
    if (match) return match[1];
  }
  return '';
}
function count(value, label, email) {
  const raw = text(value).replace(/[,\s]/g, '');
  if (!raw) return 0;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(email + ': invalid ' + label + ' count ' + JSON.stringify(value));
  return parsed;
}
const asOf = new Date().toISOString().slice(0, 10);
const assignedEmails = new Set(
  $('Normalize Coding Project Rosters').all()
    .map((item) => item.json)
    .filter((row) => row.p_source_key === 'coding-project-roster:terminus')
    .map((row) => row.p_email),
);
if (!assignedEmails.size) throw new Error('Terminus live roster returned no active candidates');
const metrics = new Map();
for (const item of items) {
  const row = item.json;
  if (key(read(row, 'SOURCE')) !== 'crossinghurdles') continue;
  const email = text(read(row, 'EMAIL')).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new Error('Terminus Task Pull: invalid email ' + JSON.stringify(email));
  if (!assignedEmails.has(email)) continue;
  if (metrics.has(email)) throw new Error('Terminus Task Pull: duplicate email ' + email);

  const submitted = count(read(row, 'TOTAL SUBMISSIONS'), 'submitted', email);
  const accepted = count(read(row, 'TOTAL ACCEPTED'), 'accepted', email);
  const rejected = count(read(row, 'REJECTED'), 'rejected', email);
  const rework = count(read(row, 'NEEDS REVISION'), 'rework', email);
  const evaluationPending = count(read(row, 'EVAL PENDING'), 'evaluation pending', email)
    + count(read(row, 'PENDING REVIEW'), 'pending review', email);
  if (submitted !== accepted + rejected + rework + evaluationPending) {
    throw new Error(email + ': Terminus totals do not reconcile');
  }
  metrics.set(email, { submitted, accepted, rejected, rework, evaluationPending });
}
for (const email of assignedEmails) {
  if (!metrics.has(email)) {
    metrics.set(email, { submitted: 0, accepted: 0, rejected: 0, rework: 0, evaluationPending: 0 });
  }
}
return [...metrics.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([email, metric]) => ({ json: {
  p_email: email,
  p_client: 'Snorkel',
  p_vertical: 'Coding',
  p_project_slug: 'Terminus',
  p_as_of: asOf,
  p_submitted: metric.submitted,
  p_accepted: metric.accepted,
  p_rejected: metric.rejected,
  p_rework: metric.rework,
  p_evaluation_pending: metric.evaluationPending,
  p_source_sheet: 'Snorkel MainTerminus Coding Projects - Internal Dhruv / Terminus Task Pull',
  p_metric_kind: 'cumulative',
  p_allow_missing_assignment: false,
} }));`;

const otterTaskNormalizer = String.raw`const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function key(value) { return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''); }
function text(value) { return String(value ?? '').trim(); }
function read(row, ...names) {
  const entries = Object.entries(row || {});
  for (const name of names.map(key)) {
    const exact = entries.find(([column, value]) => key(column) === name && value !== null && value !== undefined);
    if (exact) return exact[1];
    const partial = entries.find(([column, value]) => key(column).includes(name) && value !== null && value !== undefined);
    if (partial) return partial[1];
  }
  return '';
}
function status(value) {
  const normalized = text(value).toLowerCase();
  if (['accepted', 'approved', 'provisionally accepted', 'completed'].includes(normalized)) return 'accepted';
  if (['rejected', 'invalid', 'non fixable', 'non-fixable'].includes(normalized)) return 'rejected';
  if (['needs revision', 'needs_revision', 'rework', 'requiring rework', 'fixable'].includes(normalized)) return 'rework';
  if (['', 'waiting for review', 'pending review', 'evaluation pending', 'evaluation_pending', 'submitted', 'in progress', 'assigned'].includes(normalized)) return 'evaluation_pending';
  throw new Error('Otter Task ID Tracking: unsupported status ' + JSON.stringify(value));
}
const assignedEmails = new Set(
  $('Normalize Coding Project Rosters').all()
    .map((item) => item.json)
    .filter((row) => row.p_source_key === 'coding-project-roster:otter')
    .map((row) => row.p_email),
);
const syncRunId = String($execution.id);
const events = new Map();
for (const item of items) {
  const row = item.json;
  const taskId = text(read(row, 'Task ID'));
  const email = text(read(row, 'Contributor Email')).toLowerCase();
  if (!taskId && !email) continue;
  if (!taskId) throw new Error('Otter Task ID Tracking: missing task ID for ' + email);
  if (!EMAIL_RE.test(email)) throw new Error('Otter Task ID Tracking: invalid email ' + JSON.stringify(email));
  if (!assignedEmails.has(email)) continue;
  const eventKey = ['otter', email, taskId.toLowerCase()].join('|');
  if (events.has(eventKey)) throw new Error('Otter Task ID Tracking: duplicate candidate/task pair ' + eventKey);
  events.set(eventKey, {
    p_event_key: eventKey,
    p_task_external_id: taskId,
    p_email: email,
    p_client: 'Snorkel',
    p_vertical: 'Coding',
    p_project_slug: 'Otter',
    p_project_name_raw: 'Otter',
    p_task_type: text(read(row, 'Workflow')) || null,
    p_status: status(read(row, 'Current Status')),
    p_submitted_at_source: text(read(row, 'Latest Client Submission Timestamp')) || null,
    p_source_sheet: 'Snorkel MainOtter ML Experts - Internal Dhruv / Task ID Tracking',
    p_source_key: 'task-source:otter',
    p_sync_run_id: syncRunId,
    p_allow_missing_assignment: false,
  });
}
if (!events.size) throw new Error('Otter Task ID Tracking returned no tasks for active Otter candidates');
return [...events.values()].sort((left, right) => left.p_event_key.localeCompare(right.p_event_key)).map((row) => ({ json: row }));`;

const rudderTaskNormalizer = String.raw`const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function key(value) { return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''); }
function text(value) { return String(value ?? '').trim(); }
function read(row, ...names) {
  const entries = Object.entries(row || {});
  for (const name of names.map(key)) {
    const match = entries.find(([column, value]) => key(column) === name && value !== null && value !== undefined);
    if (match) return match[1];
  }
  return '';
}
function status(value) {
  const normalized = text(value).toLowerCase();
  if (['accepted', 'approved', 'provisionally accepted', 'completed'].includes(normalized)) return 'accepted';
  if (['rejected', 'invalid', 'non fixable', 'non-fixable'].includes(normalized)) return 'rejected';
  if (['needs revision', 'needs_revision', 'rework', 'requiring rework', 'fixable'].includes(normalized)) return 'rework';
  if (['', 'waiting for review', 'pending review', 'evaluation pending', 'evaluation_pending', 'submitted', 'in progress', 'assigned'].includes(normalized)) return 'evaluation_pending';
  throw new Error('Rudder Task Raw Pull: unsupported status ' + JSON.stringify(value));
}
const assignedEmails = new Set(
  $('Normalize Coding Project Rosters').all()
    .map((item) => item.json)
    .filter((row) => row.p_source_key === 'coding-project-roster:rudder')
    .map((row) => row.p_email),
);
const syncRunId = String($execution.id);
const events = new Map();
const hasBpoSourceColumn = items.some((item) =>
  Object.keys(item.json || {}).some((column) => key(column) === 'bposource')
);
for (const item of items) {
  const row = item.json;
  const taskId = text(read(row, 'Task ID'));
  if (!taskId) continue;
  const bpoSource = text(read(row, 'BPO Source'));
  if (hasBpoSourceColumn && key(bpoSource) !== 'crossinghurdles') continue;
  const email = text(read(row, 'Assignee', 'User Email', 'Email')).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new Error('Rudder Task Raw Pull: invalid email ' + JSON.stringify(email));
  if (!assignedEmails.has(email)) continue;
  const eventKey = ['rudder', email, taskId.toLowerCase()].join('|');
  if (events.has(eventKey)) throw new Error('Rudder Task Raw Pull: duplicate candidate/task pair ' + eventKey);
  events.set(eventKey, {
    p_event_key: eventKey,
    p_task_external_id: taskId,
    p_email: email,
    p_client: 'Snorkel',
    p_vertical: 'Coding',
    p_project_slug: 'Rudder',
    p_project_name_raw: text(read(row, 'Project Name')) || 'Rudder',
    p_task_type: text(read(row, 'Task Type')) || null,
    p_status: status(read(row, 'Task Status', 'State Enum', 'Status')),
    p_created_at_source: text(read(row, 'Created At')) || null,
    p_submitted_at_source: text(read(row, 'Last Submitted At', 'Submitted At')) || null,
    p_bpo_source: bpoSource || null,
    p_source_sheet: 'Snorkel MainRudder Internal / Task Raw Pull',
    p_source_key: 'task-source:rudder',
    p_sync_run_id: syncRunId,
    p_allow_missing_assignment: false,
  });
}
if (!events.size) throw new Error('Rudder Task Raw Pull returned no tasks for active Rudder candidates');
return [...events.values()].sort((left, right) => left.p_event_key.localeCompare(right.p_event_key)).map((row) => ({ json: row }));`;

const stemPaymentNormalizer = String.raw`const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PROJECTS = {
  riga: 'Riga',
  rainier: 'Rainier',
  sequoia: 'Sequoia',
  starfish: 'Starfish',
};

function key(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}
function read(row, ...names) {
  const entries = Object.entries(row || {});
  for (const name of names.map(key)) {
    const match = entries.find(([column, value]) => key(column) === name && value !== null && value !== undefined);
    if (match) return match[1];
  }
  return '';
}
function text(value) {
  return String(value ?? '').trim();
}
function amount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = text(value).replace(/[^0-9.-]/g, '');
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}
function paymentStatus(value, paidOnValue) {
  const status = text(value).toLowerCase();
  if (!status) return text(paidOnValue) ? 'disbursed' : 'processing';
  if (/sent|paid|disbursed|completed/.test(status)) return 'disbursed';
  if (/proceed|process|pending|queued|approved/.test(status)) return 'processing';
  if (/reject|fail|cancel/.test(status)) return 'failed';
  throw new Error('Unknown payment status: ' + JSON.stringify(value));
}
function isoDate(value) {
  if (value === null || value === undefined || text(value) === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString().slice(0, 10);
  }
  const raw = text(value);
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return [iso[1], iso[2].padStart(2, '0'), iso[3].padStart(2, '0')].join('-');
  const slash = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slash) return [slash[3], slash[2].padStart(2, '0'), slash[1].padStart(2, '0')].join('-');
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid payment date: ' + JSON.stringify(value));
  return parsed.toISOString().slice(0, 10);
}

const grouped = new Map();
const projectCounts = new Map();
for (const item of items) {
  const row = item.json;
  const source = text(row._source).toLowerCase();
  const project = PROJECTS[source];
  if (!project) throw new Error('Unknown STEM payment source: ' + JSON.stringify(row._source));

  const rawEmail = text(read(row, 'Email Id', 'Email ID', 'Email')).toLowerCase();
  if (!rawEmail) continue;
  const rawAmount = amount(read(row, 'Final Amt'));
  if (!EMAIL_RE.test(rawEmail)) throw new Error(project + ': invalid email ' + JSON.stringify(rawEmail));
  if (rawAmount === null || rawAmount <= 0) throw new Error(project + ': invalid Final Amt for ' + rawEmail);

  const paidOnValue = read(row, 'Amount Sent Date', 'Payment Date');
  const status = paymentStatus(read(row, 'Status', 'Payment Status'), paidOnValue);
  const paidOn = status === 'disbursed' ? isoDate(paidOnValue) : null;
  const groupKey = [rawEmail, source, status].join('|');
  const current = grouped.get(groupKey) || { email: rawEmail, project, source, status, amount: 0, paidOn: null };
  current.amount += rawAmount;
  if (paidOn && (!current.paidOn || paidOn > current.paidOn)) current.paidOn = paidOn;
  grouped.set(groupKey, current);
  projectCounts.set(project, (projectCounts.get(project) || 0) + 1);
}

for (const project of Object.values(PROJECTS)) {
  if (!projectCounts.get(project)) throw new Error('No July 2026 payment rows found for ' + project);
}

const syncRunId = String($execution.id);
const pRows = [...grouped.values()]
  .sort((left, right) => [left.project, left.email, left.status].join('|').localeCompare([right.project, right.email, right.status].join('|')))
  .map((payment) => ({
    p_email: payment.email,
    p_client: 'Snorkel',
    p_vertical: 'STEM',
    p_project: payment.project,
    p_amount: payment.amount,
    p_currency: 'INR',
    p_status: payment.status,
    p_paid_on: payment.paidOn,
    p_reference: ['STEM', payment.project, 'July 2026', payment.status].join(' / '),
    p_source_key: 'stem-payments-july-2026',
    p_source_sheet: payment.project + ' payment workbook / July - 2026 / Final Amt',
    p_sync_run_id: syncRunId,
  }));

return [{ json: { p_rows: pRows } }];`;

const projectPaymentNormalizer = String.raw`const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SOURCES = {
  mojave: {
    vertical: 'Mojave', project: 'Mojave', componentKey: 'mojave_total',
    componentLabel: 'Task + Review', sourceSheet: 'SnorkelxMojave - Sub Contracting Payment / July - 2026',
  },
  terminus_task: {
    vertical: 'Coding', project: 'Terminus', componentKey: 'task',
    componentLabel: 'Approved Tasks', sourceSheet: 'SnorkelxTerminus - Sub Contract Payment / July, 2026(Task)',
  },
  terminus_review: {
    vertical: 'Coding', project: 'Terminus', componentKey: 'review',
    componentLabel: 'Approved Reviews', sourceSheet: 'SnorkelxTerminus - Sub Contract Payment / July,2026(Review)',
  },
  otter_a: {
    vertical: 'Coding', project: 'Otter', componentKey: 'workflow_a',
    componentLabel: 'Workflow A', sourceSheet: 'SnorkelxOtter - Sub Contract Payment / July,2026(workflow A)',
  },
  otter_b: {
    vertical: 'Coding', project: 'Otter', componentKey: 'workflow_b',
    componentLabel: 'Workflow B', sourceSheet: 'SnorkelxOtter - Sub Contract Payment / July,2026(workflow B)',
  },
  sentinel_assessment: {
    vertical: 'Coding', project: 'Sentinel Ultra', componentKey: 'assessment',
    componentLabel: 'Assessment', sourceSheet: 'SnorkelxSentinel - Sub Contract Payment / July,2026(Assessment)',
  },
  sentinel_fixable: {
    vertical: 'Coding', project: 'Sentinel Ultra', componentKey: 'fixable',
    componentLabel: 'Fixable', sourceSheet: 'SnorkelxSentinel - Sub Contract Payment / July,2026(Fixable)',
  },
  sentinel_non_fixable: {
    vertical: 'Coding', project: 'Sentinel Ultra', componentKey: 'non_fixable',
    componentLabel: 'Non Fixable', sourceSheet: 'SnorkelxSentinel - Sub Contract Payment / July,2026(N.Fixable)',
  },
};

function key(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}
function read(row, ...names) {
  const entries = Object.entries(row || {});
  const wanted = names.map(key).filter(Boolean);
  for (const name of wanted) {
    const exact = entries.find(([column, value]) => key(column) === name && value !== null && value !== undefined);
    if (exact) return exact[1];
  }
  for (const name of wanted) {
    const partial = entries.find(([column, value]) => {
      const candidate = key(column);
      return value !== null && value !== undefined && name.length >= 6 &&
        (candidate.includes(name) || name.includes(candidate));
    });
    if (partial) return partial[1];
  }
  return '';
}
function text(value) {
  return String(value ?? '').trim();
}
function amount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = text(value).replace(/[^0-9.-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}
function paymentStatus(value, paidOnValue) {
  const status = text(value).toLowerCase();
  if (!status) return text(paidOnValue) ? 'disbursed' : 'processing';
  if (/sent|paid|disbursed|completed/.test(status)) return 'disbursed';
  if (/proceed|process|pending|queued|approved/.test(status)) return 'processing';
  if (/reject|fail|cancel/.test(status)) return 'failed';
  throw new Error('Unknown payment status: ' + JSON.stringify(value));
}
function combineStatus(left, right) {
  if (left === 'failed' || right === 'failed') return 'failed';
  if (left === 'processing' || right === 'processing') return 'processing';
  return 'disbursed';
}
function isoDate(value) {
  if (value === null || value === undefined || text(value) === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString().slice(0, 10);
  }
  const raw = text(value);
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return [iso[1], iso[2].padStart(2, '0'), iso[3].padStart(2, '0')].join('-');
  const slash = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slash) return [slash[3], slash[2].padStart(2, '0'), slash[1].padStart(2, '0')].join('-');
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid payment date: ' + JSON.stringify(value));
  return parsed.toISOString().slice(0, 10);
}
function addNullable(left, right) {
  if (left === null && right === null) return null;
  return (left || 0) + (right || 0);
}
function mergeDetails(target, incoming) {
  for (const detail of incoming) {
    const current = target.find((candidate) => candidate.key === detail.key);
    if (!current) {
      target.push({ ...detail });
      continue;
    }
    current.quantity = addNullable(current.quantity, detail.quantity);
    if (current.rate_amount !== detail.rate_amount || current.rate_currency !== detail.rate_currency) {
      current.rate_amount = null;
      current.rate_currency = null;
    }
  }
}

const grouped = new Map();
const observedComponents = [...new Set(items
  .map((item) => SOURCES[text(item.json?._source).toLowerCase()]?.componentKey)
  .filter(Boolean))].sort();
const expectedComponents = [
  'assessment', 'fixable', 'mojave_total', 'non_fixable',
  'review', 'task', 'workflow_a', 'workflow_b',
];
if (JSON.stringify(observedComponents) !== JSON.stringify(expectedComponents)) {
  throw new Error('Project payment source snapshot is incomplete: ' + JSON.stringify(observedComponents));
}

for (const item of items) {
  const row = item.json;
  const sourceKey = text(row._source).toLowerCase();
  const source = SOURCES[sourceKey];
  if (!source) throw new Error('Unknown project payment source: ' + JSON.stringify(row._source));

  const email = text(read(row, 'Email Id', 'Email ID', 'EMAIL', 'Email')).toLowerCase();
  const finalAmount = amount(read(row, 'Final Amt', 'Final Amount'));
  if (!email && finalAmount === null) continue;
  if (!EMAIL_RE.test(email)) throw new Error(source.project + '/' + source.componentLabel + ': invalid email ' + JSON.stringify(email));
  if (finalAmount === null || finalAmount <= 0) continue;

  const paidOnValue = read(row, 'Amount Sent Date', 'Payment Date');
  const status = paymentStatus(read(row, 'Status', 'Payment Status'), paidOnValue);
  const paidOn = status === 'disbursed' ? isoDate(paidOnValue) : null;
  const tdsAmount = amount(read(row, 'TDS Deducted', 'TDS'));
  const grossFromSheet = amount(read(row, 'Payable Amt', 'Payable Amount'));
  const grossAmount = grossFromSheet ?? finalAmount + (tdsAmount || 0);
  let quantity = amount(read(row, 'Total Task completed', 'Total Task complete', 'Approved Task', 'Approved Review'));
  let rateAmount = amount(read(row, 'Candidate Rate', 'Candidates Rate Amt', 'Candidate Rate Amt'));
  let rateCurrency = rateAmount === null ? null : 'INR';
  const breakdown = [];

  if (sourceKey === 'mojave') {
    quantity = null;
    rateAmount = null;
    rateCurrency = null;
    const taskQuantity = amount(read(row, 'Total Task completed', 'Total Task complete'));
    const taskRate = amount(read(row, 'Candidates Rate Task USD', 'Candidate Rate Task', 'Candidates Rate Task'));
    const reviewQuantity = amount(read(row, 'Total Approved', 'Approved Review'));
    const reviewRate = amount(read(row, 'Candidates Rate USD', 'Candidate Rate Review', 'Candidates Rate Review'));
    if (taskQuantity !== null && taskRate !== null) {
      breakdown.push({ key: 'task', label: 'Approved Tasks', quantity: taskQuantity, rate_amount: taskRate, rate_currency: 'USD' });
    }
    if (reviewQuantity !== null && reviewRate !== null) {
      breakdown.push({ key: 'review', label: 'Approved Reviews', quantity: reviewQuantity, rate_amount: reviewRate, rate_currency: 'USD' });
    }
  }

  const groupKey = [email, sourceKey].join('|');
  const current = grouped.get(groupKey);
  if (!current) {
    grouped.set(groupKey, {
      email, source, status, paidOn, amount: finalAmount, grossAmount, tdsAmount,
      quantity, rateAmount, rateCurrency, breakdown,
    });
    continue;
  }

  current.amount += finalAmount;
  current.grossAmount = addNullable(current.grossAmount, grossAmount);
  current.tdsAmount = addNullable(current.tdsAmount, tdsAmount);
  current.quantity = addNullable(current.quantity, quantity);
  if (current.rateAmount !== rateAmount || current.rateCurrency !== rateCurrency) {
    current.rateAmount = null;
    current.rateCurrency = null;
  }
  current.status = combineStatus(current.status, status);
  if (paidOn && (!current.paidOn || paidOn > current.paidOn)) current.paidOn = paidOn;
  mergeDetails(current.breakdown, breakdown);
}

const syncRunId = String($execution.id);
const pRows = [...grouped.values()]
  .sort((left, right) => [left.source.project, left.email, left.source.componentKey].join('|')
    .localeCompare([right.source.project, right.email, right.source.componentKey].join('|')))
  .map((payment) => ({
    p_email: payment.email,
    p_client: 'Snorkel',
    p_vertical: payment.source.vertical,
    p_project: payment.source.project,
    p_component_key: payment.source.componentKey,
    p_component_label: payment.source.componentLabel,
    p_amount: payment.amount,
    p_currency: 'INR',
    p_status: payment.status,
    p_paid_on: payment.paidOn,
    p_quantity: payment.quantity,
    p_rate_amount: payment.rateAmount,
    p_rate_currency: payment.rateCurrency,
    p_gross_amount: payment.grossAmount,
    p_tds_amount: payment.tdsAmount,
    p_breakdown: payment.breakdown,
    p_reference: ['Snorkel', payment.source.project, 'July 2026', payment.source.componentLabel].join(' / '),
    p_source_key: 'project-payments-july-2026',
    p_source_sheet: payment.source.sourceSheet,
    p_sync_run_id: syncRunId,
    p_observed_components: observedComponents,
  }));

return [{ json: { p_rows: pRows } }];`;

const geraniumAssignmentNormalizer = String.raw`const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function key(value) { return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''); }
function text(value) { return String(value ?? '').trim(); }
function read(row, ...names) {
  const entries = Object.entries(row || {});
  for (const name of names.map(key)) {
    const match = entries.find(([column, value]) => key(column) === name && value !== null && value !== undefined);
    if (match) return match[1];
  }
  return '';
}
function verification(value) {
  const status = text(value).toLowerCase();
  if (/received and completed|completed|verified|approved/.test(status)) return 'done';
  if (status.includes('exception')) return 'exception';
  return 'awaited';
}
function remofirst(value) {
  const status = text(value).toLowerCase();
  if (/received and completed|completed|verified|approved/.test(status)) return 'approved';
  if (/not received|not started|rejected/.test(status)) return 'not_received';
  return 'pending';
}
function contract(value) {
  const status = text(value).toLowerCase();
  if (status && !/not signed/.test(status) && /signed|completed/.test(status)) return 'signed';
  if (!status || /not signed|not received|not sent|not started/.test(status)) return 'not_signed';
  if (/received|sent|shared/.test(status)) return 'sent';
  return 'not_signed';
}

const roster = new Map();
for (const item of items.filter((entry) => text(entry.json._source) === 'allocation_roster')) {
  const row = item.json;
  const email = text(read(row, 'Email')).toLowerCase();
  const sector = text(read(row, 'Sector'));
  if (!email && !sector) continue;
  if (!EMAIL_RE.test(email)) throw new Error('Allocation Roster: invalid email ' + JSON.stringify(email));
  if (!sector) throw new Error('Allocation Roster: missing Sector for ' + email);
  if (roster.has(email) && roster.get(email) !== sector) {
    throw new Error('Allocation Roster: conflicting sectors for ' + email);
  }
  roster.set(email, sector);
}
if (!roster.size) throw new Error('Allocation Roster returned no candidates');

const syncRunId = String($execution.id);
const assignments = new Map();
for (const item of items.filter((entry) => text(entry.json._source) === 'allocated_ecs')) {
  const row = item.json;
  const email = text(read(row, 'Email')).toLowerCase();
  const project = text(read(row, 'Project'));
  const projectStatus = text(read(row, 'Project Status')).toLowerCase();
  if (!email && !project && !projectStatus) continue;
  if (project.toLowerCase() !== 'geranium' || projectStatus !== 'active') continue;
  if (!EMAIL_RE.test(email)) throw new Error('Allocated ECs: invalid active candidate email ' + JSON.stringify(email));
  if (assignments.has(email)) throw new Error('Allocated ECs: duplicate active candidate ' + email);

  const fullName = text(read(row, 'Name'));
  if (!fullName) throw new Error('Allocated ECs: missing candidate name for ' + email);
  const domain = roster.get(email) || text(read(row, 'Sector'));
  if (!domain) throw new Error('Geranium: missing domain for ' + email);

  assignments.set(email, {
    p_email: email,
    p_full_name: fullName,
    p_client: 'Snorkel',
    p_vertical: 'Geranium',
    p_project: 'Geranium',
    p_domain: domain,
    p_bgv_id_status: verification(read(row, 'Spring Verify')),
    p_remofirst_status: remofirst(read(row, 'RemoFirst Verification')),
    p_contract_status: contract(read(row, 'Contract')),
    p_source_key: 'geranium-allocated-ecs',
    p_source_priority: 120,
    p_source_sheet: 'Project Geranium / Allocated ECs; Geranium - Crossing Hurdles Tracker / Allocation Roster',
    p_source_row: row.row_number || null,
    p_sync_run_id: syncRunId,
    p_membership_authoritative: true,
  });
}
if (!assignments.size) throw new Error('Allocated ECs returned no active Geranium candidates');

const orphanedRosterEmails = [...roster.keys()].filter((email) => !assignments.has(email));
if (orphanedRosterEmails.length) {
  throw new Error('Allocation Roster contains candidates missing from active Allocated ECs: ' + orphanedRosterEmails.slice(0, 20).join(', '));
}

return [...assignments.values()]
  .sort((left, right) => left.p_email.localeCompare(right.p_email))
  .map((row) => ({ json: row }));`;

const geraniumSnapshotNormalizer = String.raw`const rows = $('Normalize Geranium Assignments').all().map((item) => item.json);
if (!rows.length) throw new Error('Cannot finalize an empty Geranium roster');
const syncRunIds = [...new Set(rows.map((row) => row.p_sync_run_id))];
if (syncRunIds.length !== 1 || !syncRunIds[0]) throw new Error('Geranium roster has inconsistent run IDs');
return [{ json: {
  p_source_key: 'geranium-allocated-ecs',
  p_sync_run_id: syncRunIds[0],
  p_expected_count: rows.length,
} }];`;

const geraniumTaskEventNormalizer = String.raw`const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function key(value) { return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''); }
function text(value) { return String(value ?? '').trim(); }
function read(row, ...names) {
  const entries = Object.entries(row || {});
  for (const name of names.map(key)) {
    const match = entries.find(([column, value]) => key(column) === name && value !== null && value !== undefined);
    if (match) return match[1];
  }
  return '';
}

const assignedEmails = new Set($('Normalize Geranium Assignments').all().map((item) => item.json.p_email));
const supportedStatuses = new Set(['provisionally accepted', 'waiting for review', 'needs revision', 'rejected']);
const syncRunId = String($execution.id);
const events = new Map();
for (const item of items) {
  const row = item.json;
  const taskId = text(read(row, 'Task ID'));
  const email = text(read(row, 'Assignee')).toLowerCase();
  if (!taskId && !email) continue;
  if (!taskId) throw new Error('Task Breakdown: missing task ID for ' + email);
  if (!EMAIL_RE.test(email)) throw new Error('Task Breakdown: invalid assignee ' + JSON.stringify(email));
  const hasActiveAssignment = assignedEmails.has(email);
  if (!hasActiveAssignment) continue;
  const status = text(read(row, 'Task Status')).toLowerCase();
  if (!supportedStatuses.has(status)) throw new Error('Task Breakdown: unsupported status ' + JSON.stringify(status));

  const eventKey = 'geranium|' + taskId.toLowerCase();
  if (events.has(eventKey)) throw new Error('Task Breakdown: duplicate task ID ' + taskId);
  events.set(eventKey, {
    p_event_key: eventKey,
    p_task_external_id: taskId,
    p_email: email,
    p_client: 'Snorkel',
    p_vertical: 'Geranium',
    p_project_slug: 'Geranium',
    p_project_name_raw: text(read(row, 'Project Name')) || 'Geranium',
    p_task_type: text(read(row, 'Task Type')) || null,
    p_status: text(read(row, 'Task Status')),
    p_created_at_source: text(read(row, 'Created At')) || null,
    p_submitted_at_source: text(read(row, 'Last Submitted At')) || null,
    p_bpo_source: text(read(row, 'BPO Source')) || null,
    p_source_sheet: 'Geranium - Crossing Hurdles Tracker / Task Breakdown',
    p_source_key: 'task-source:geranium',
    p_sync_run_id: syncRunId,
    p_allow_missing_assignment: false,
  });
}
if (!events.size) throw new Error('Task Breakdown returned no tasks for active Geranium candidates');
return [...events.values()]
  .sort((left, right) => left.p_event_key.localeCompare(right.p_event_key))
  .map((row) => ({ json: row }));`;

const geraniumMetricNormalizer = String.raw`const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function key(value) { return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''); }
function text(value) { return String(value ?? '').trim(); }
function read(row, ...names) {
  const entries = Object.entries(row || {});
  for (const name of names.map(key)) {
    const match = entries.find(([column, value]) => key(column) === name && value !== null && value !== undefined);
    if (match) return match[1];
  }
  return '';
}
function count(value, label, email) {
  const raw = text(value).replace(/[,\s]/g, '');
  if (!raw) return 0;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('Metrics per EC: invalid ' + label + ' for ' + email + ': ' + JSON.stringify(value));
  }
  return parsed;
}

const assignedEmails = new Set($('Normalize Geranium Assignments').all().map((item) => item.json.p_email));
const metrics = new Map();
for (const item of items) {
  const row = item.json;
  const email = text(read(row, 'Assignee')).toLowerCase();
  if (!email) continue;
  if (!EMAIL_RE.test(email)) throw new Error('Metrics per EC: invalid assignee ' + JSON.stringify(email));
  if (!assignedEmails.has(email)) continue;
  if (metrics.has(email)) throw new Error('Metrics per EC: duplicate candidate ' + email);

  const submitted = count(read(row, 'Total Tasks', 'Total Task'), 'Total Tasks', email);
  const accepted = count(read(row, 'Provisionally Accepted'), 'Provisionally Accepted', email);
  const rejected = count(read(row, 'Rejected'), 'Rejected', email);
  const rework = count(read(row, 'Needs Revision', 'Need Revision'), 'Needs Revision', email);
  const evaluationPending = count(read(row, 'Waiting For Review', 'Waiting for review'), 'Waiting For Review', email);
  if (submitted !== accepted + rejected + rework + evaluationPending) {
    throw new Error('Metrics per EC: task totals do not reconcile for ' + email);
  }
  metrics.set(email, { submitted, accepted, rejected, rework, evaluationPending });
}

const taskEmails = new Set(
  $('Normalize Geranium Task Events').all().map((item) => item.json.p_email),
);
const missingMetrics = [...assignedEmails].filter((email) => !metrics.has(email));
const missingWithTasks = missingMetrics.filter((email) => taskEmails.has(email));
if (missingWithTasks.length) {
  throw new Error(
    'Metrics per EC is missing ' + missingWithTasks.length +
    ' active candidate(s) that have Task Breakdown records',
  );
}
for (const email of missingMetrics) {
  metrics.set(email, {
    submitted: 0,
    accepted: 0,
    rejected: 0,
    rework: 0,
    evaluationPending: 0,
  });
}

const asOf = new Date().toISOString().slice(0, 10);
return [...metrics.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([email, metric]) => ({ json: {
    p_email: email,
    p_client: 'Snorkel',
    p_vertical: 'Geranium',
    p_project_slug: 'Geranium',
    p_as_of: asOf,
    p_submitted: metric.submitted,
    p_accepted: metric.accepted,
    p_rejected: metric.rejected,
    p_rework: metric.rework,
    p_evaluation_pending: metric.evaluationPending,
    p_source_sheet: 'Geranium - Crossing Hurdles Tracker / Metrics per EC',
    p_metric_kind: 'cumulative',
    p_allow_missing_assignment: false,
  } }));`;

const trigger = addNode(
  "Schedule Trigger - Unified Portal Data",
  "n8n-nodes-base.scheduleTrigger",
  1.2,
  [-2160, 1260],
  { rule: { interval: [{ field: "hours", hoursInterval: 6, triggerAtMinute: 0 }] } },
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
const batchSentinelTasks = code("Batch Sentinel Tasks - Unified", taskSnapshotBatchCode, [720, 1320]);
const upsertSentinelTasks = httpBody(
  "Upsert Sentinel Tasks - Unified",
  "stage_task_event_snapshot_batch",
  '={{ { "p_source_key": $json.p_source_key, "p_sync_run_id": $json.p_sync_run_id, "p_rows": $json.p_rows } }}',
  [960, 1320],
  30000,
);
const validateSentinelTasks = code("Validate Sentinel Tasks - Unified", strictValidateCode, [1200, 1320]);
const prepareSentinelTaskSnapshot = code(
  "Prepare Sentinel Task Snapshot Finalizer",
  taskSnapshotFinalizeCode("Normalize Sentinel Tasks - Unified"),
  [1440, 1320],
);
const finalizeSentinelTaskSnapshot = httpBody(
  "Finalize Sentinel Task Snapshot",
  "finalize_task_event_snapshot",
  '={{ { "p_source_key": $json.p_source_key, "p_sync_run_id": $json.p_sync_run_id, "p_expected_count": $json.p_expected_count } }}',
  [1680, 1320],
  30000,
);
const validateSentinelTaskSnapshot = code(
  "Validate Sentinel Task Snapshot",
  strictValidateCode,
  [1920, 1320],
);
connect(validateMaster, sentinelTasks); connect(sentinelTasks, normalizeSentinelTasks); connect(normalizeSentinelTasks, batchSentinelTasks); connect(batchSentinelTasks, upsertSentinelTasks); connect(upsertSentinelTasks, validateSentinelTasks);
connect(validateSentinelTasks, prepareSentinelTaskSnapshot);
connect(prepareSentinelTaskSnapshot, finalizeSentinelTaskSnapshot);
connect(finalizeSentinelTaskSnapshot, validateSentinelTaskSnapshot);

const paperTasks = sheets("Read PaperBench Activity - Unified", "1Tzgi8zIZddLkllQ5bYI6z8UNNdJTD8F1pbHACcygYuc", "CH-auto-import", [1440, 1120]);
const normalizePaperTasks = code("Normalize PaperBench Tasks - Unified", paperTaskNormalizer, [1680, 1120]);
const batchPaperTasks = code("Batch PaperBench Tasks - Unified", taskSnapshotBatchCode, [1920, 1120]);
const upsertPaperTasks = httpBody(
  "Upsert PaperBench Tasks - Unified",
  "stage_task_event_snapshot_batch",
  '={{ { "p_source_key": $json.p_source_key, "p_sync_run_id": $json.p_sync_run_id, "p_rows": $json.p_rows } }}',
  [2160, 1120],
  30000,
);
const validatePaperTasks = code("Validate PaperBench Tasks - Unified", strictValidateCode, [2400, 1120]);
const preparePaperTaskSnapshot = code(
  "Prepare PaperBench Task Snapshot Finalizer",
  taskSnapshotFinalizeCode("Normalize PaperBench Tasks - Unified"),
  [2640, 1120],
);
const finalizePaperTaskSnapshot = httpBody(
  "Finalize PaperBench Task Snapshot",
  "finalize_task_event_snapshot",
  '={{ { "p_source_key": $json.p_source_key, "p_sync_run_id": $json.p_sync_run_id, "p_expected_count": $json.p_expected_count } }}',
  [2880, 1120],
  30000,
);
const validatePaperTaskSnapshot = code(
  "Validate PaperBench Task Snapshot",
  strictValidateCode,
  [3120, 1120],
);
connect(validatePaperCandidates, paperTasks); connect(paperTasks, normalizePaperTasks); connect(normalizePaperTasks, batchPaperTasks); connect(batchPaperTasks, upsertPaperTasks); connect(upsertPaperTasks, validatePaperTasks);
connect(validatePaperTasks, preparePaperTaskSnapshot);
connect(preparePaperTaskSnapshot, finalizePaperTaskSnapshot);
connect(finalizePaperTaskSnapshot, validatePaperTaskSnapshot);

const refreshExistingTaskMetrics = httpBody(
  "Refresh Task Metrics From Events - Unified",
  "finalize_unified_rosters_and_refresh",
  '={{ { "p_assignment_ids": null } }}',
  [3360, 1220],
  30000,
);
connect(validateSentinelTaskSnapshot, refreshExistingTaskMetrics);
connect(validatePaperTaskSnapshot, refreshExistingTaskMetrics);

const codingSourcesTrigger = addNode(
  "Schedule Trigger - Coding Project Sources",
  "n8n-nodes-base.scheduleTrigger",
  1.2,
  [5280, 2680],
  { rule: { interval: [{ field: "hours", hoursInterval: 6, triggerAtMinute: 30 }] } },
);

const terminusRoster = sheets(
  "Read Terminus Live Candidates - Unified",
  "1R1A2wt0MGYjrbEwQOZRXV9LK_A_wN9QI1sUBdYbfBwI",
  "Terminus 2nd Edition Live",
  [5520, 2440],
);
const otterRoster = sheets(
  "Read Otter Live Candidates - Unified",
  "12OAfJTXkFvY6ti-WCPxzHBpbPcRW-8Tc-Fusz159m_k",
  "MainOtter Live Candidates",
  [5520, 2560],
);
const suiteLifeRoster = sheets(
  "Read SuiteLife Live Candidates - Unified",
  "1QVqmfGC39n9UooI1u32ltz3kiU1s7N06Ucz4-ECS5YM",
  "SuiteLife Live Candidates",
  [5520, 2680],
);
const rudderRoster = sheets(
  "Read Rudder Live Candidates - Unified",
  "1yuda2He61MSoIQnd63-dn3lr83z4pzrBrjTZ3oL3TIs",
  "Rudder Live Candidates",
  [5520, 2800],
);
const tagTerminusRoster = tag("Tag Terminus Roster", "terminus", [5760, 2440]);
const tagOtterRoster = tag("Tag Otter Roster", "otter", [5760, 2560]);
const tagSuiteLifeRoster = tag("Tag SuiteLife Roster", "suitelife", [5760, 2680]);
const tagRudderRoster = tag("Tag Rudder Roster", "rudder", [5760, 2800]);
const mergeTerminusOtterRosters = addNode("Merge Terminus + Otter Rosters", "n8n-nodes-base.merge", 3, [6000, 2500], {});
const mergeSuiteLifeRoster = addNode("Merge + SuiteLife Roster", "n8n-nodes-base.merge", 3, [6240, 2560], {});
const mergeRudderRoster = addNode(
  "Merge + Rudder Roster",
  "n8n-nodes-base.merge",
  3,
  [6480, 2620],
  { numberInputs: 3 },
);
const normalizeCodingRosters = code("Normalize Coding Project Rosters", codingRosterNormalizer, [6720, 2620]);
const batchCodingRosters = code("Batch Coding Project Rosters", assignmentBatchCode, [6960, 2620]);
const upsertCodingRosters = http("Upsert Coding Project Rosters", "upsert_portal_assignments_batch", [7200, 2620]);
const validateCodingRosters = code("Validate Coding Project Rosters", validateCode, [7440, 2620]);
const summarizeRosterSnapshots = code("Prepare Coding Roster Finalizers", rosterSnapshotNormalizer, [7680, 2620]);
const finalizeCodingRosters = httpBody(
  "Finalize Coding Roster Snapshots",
  "finalize_portal_assignment_snapshot",
  '={{ { "p_source_key": $json.p_source_key, "p_sync_run_id": $json.p_sync_run_id, "p_expected_count": $json.p_expected_count } }}',
  [7920, 2620],
  30000,
);
const validateRosterFinalizers = code("Validate Coding Roster Snapshots", validateCode, [8160, 2620]);

for (const source of [terminusRoster, otterRoster, suiteLifeRoster, rudderRoster]) {
  connect(codingSourcesTrigger, source);
}
connect(terminusRoster, tagTerminusRoster); connect(otterRoster, tagOtterRoster);
connect(suiteLifeRoster, tagSuiteLifeRoster); connect(rudderRoster, tagRudderRoster);
connect(tagTerminusRoster, mergeTerminusOtterRosters, 0); connect(tagOtterRoster, mergeTerminusOtterRosters, 1);
connect(mergeTerminusOtterRosters, mergeSuiteLifeRoster, 0); connect(tagSuiteLifeRoster, mergeSuiteLifeRoster, 1);
connect(mergeSuiteLifeRoster, mergeRudderRoster, 0); connect(tagRudderRoster, mergeRudderRoster, 1);
connect(mergeRudderRoster, normalizeCodingRosters); connect(normalizeCodingRosters, batchCodingRosters);
connect(batchCodingRosters, upsertCodingRosters); connect(upsertCodingRosters, validateCodingRosters);
connect(validateCodingRosters, summarizeRosterSnapshots); connect(summarizeRosterSnapshots, finalizeCodingRosters);
connect(finalizeCodingRosters, validateRosterFinalizers);

const terminusTasks = sheets(
  "Read Terminus Task Pull - Unified",
  "1R1A2wt0MGYjrbEwQOZRXV9LK_A_wN9QI1sUBdYbfBwI",
  "Terminus Task Pull",
  [8400, 2440],
);
const normalizeTerminusTasks = code("Normalize Terminus Tasks - Unified", terminusTaskNormalizer, [8640, 2440]);
const batchTerminusTasks = code("Batch Terminus Tasks - Unified", metricBatchCode, [8880, 2440]);
const upsertTerminusTasks = http("Upsert Terminus Tasks - Unified", "upsert_task_metrics_batch", [9120, 2440], 30000);
const validateTerminusTasks = code("Validate Terminus Tasks - Unified", validateCode, [9360, 2440]);

const otterTasks = sheets(
  "Read Otter Task IDs - Unified",
  "12OAfJTXkFvY6ti-WCPxzHBpbPcRW-8Tc-Fusz159m_k",
  "Task ID Tracking",
  [8400, 2620],
  {
    dataLocationOnSheet: {
      values: {
        rangeDefinition: "specifyRangeA1",
        range: "A2:O",
      },
    },
  },
);
const normalizeOtterTasks = code("Normalize Otter Tasks - Unified", otterTaskNormalizer, [8640, 2620]);
const batchOtterTasks = code("Batch Otter Tasks - Unified", taskSnapshotBatchCode, [8880, 2620]);
const upsertOtterTasks = httpBody(
  "Upsert Otter Tasks - Unified",
  "stage_task_event_snapshot_batch",
  '={{ { "p_source_key": $json.p_source_key, "p_sync_run_id": $json.p_sync_run_id, "p_rows": $json.p_rows } }}',
  [9120, 2620],
  30000,
);
const validateOtterTasks = code("Validate Otter Tasks - Unified", strictValidateCode, [9360, 2620]);
const prepareOtterTaskSnapshot = code(
  "Prepare Otter Task Snapshot Finalizer",
  taskSnapshotFinalizeCode("Normalize Otter Tasks - Unified"),
  [9600, 2560],
);
const finalizeOtterTaskSnapshot = httpBody(
  "Finalize Otter Task Snapshot",
  "finalize_task_event_snapshot",
  '={{ { "p_source_key": $json.p_source_key, "p_sync_run_id": $json.p_sync_run_id, "p_expected_count": $json.p_expected_count } }}',
  [9840, 2560],
  30000,
);
const validateOtterTaskSnapshot = code(
  "Validate Otter Task Snapshot",
  strictValidateCode,
  [10080, 2560],
);

const rudderTasks = sheets(
  "Read Rudder Task Raw Pull - Unified",
  "1yuda2He61MSoIQnd63-dn3lr83z4pzrBrjTZ3oL3TIs",
  "Task Raw Pull",
  [8400, 2800],
);
const normalizeRudderTasks = code("Normalize Rudder Tasks - Unified", rudderTaskNormalizer, [8640, 2800]);
const batchRudderTasks = code("Batch Rudder Tasks - Unified", taskSnapshotBatchCode, [8880, 2800]);
const upsertRudderTasks = httpBody(
  "Upsert Rudder Tasks - Unified",
  "stage_task_event_snapshot_batch",
  '={{ { "p_source_key": $json.p_source_key, "p_sync_run_id": $json.p_sync_run_id, "p_rows": $json.p_rows } }}',
  [9120, 2800],
  30000,
);
const validateRudderTasks = code("Validate Rudder Tasks - Unified", strictValidateCode, [9360, 2800]);
const prepareRudderTaskSnapshot = code(
  "Prepare Rudder Task Snapshot Finalizer",
  taskSnapshotFinalizeCode("Normalize Rudder Tasks - Unified"),
  [9600, 2860],
);
const finalizeRudderTaskSnapshot = httpBody(
  "Finalize Rudder Task Snapshot",
  "finalize_task_event_snapshot",
  '={{ { "p_source_key": $json.p_source_key, "p_sync_run_id": $json.p_sync_run_id, "p_expected_count": $json.p_expected_count } }}',
  [9840, 2860],
  30000,
);
const validateRudderTaskSnapshot = code(
  "Validate Rudder Task Snapshot",
  strictValidateCode,
  [10080, 2860],
);
const refreshCodingTaskMetrics = httpBody(
  "Refresh Coding Task Metrics - Unified",
  "refresh_task_metrics_from_events",
  '={{ { "p_assignment_ids": null } }}',
  [10320, 2710],
  30000,
);

for (const source of [terminusTasks, otterTasks, rudderTasks]) connect(validateRosterFinalizers, source);
connect(terminusTasks, normalizeTerminusTasks); connect(normalizeTerminusTasks, batchTerminusTasks);
connect(batchTerminusTasks, upsertTerminusTasks); connect(upsertTerminusTasks, validateTerminusTasks);
connect(otterTasks, normalizeOtterTasks); connect(normalizeOtterTasks, batchOtterTasks);
connect(batchOtterTasks, upsertOtterTasks); connect(upsertOtterTasks, validateOtterTasks);
connect(rudderTasks, normalizeRudderTasks); connect(normalizeRudderTasks, batchRudderTasks);
connect(batchRudderTasks, upsertRudderTasks); connect(upsertRudderTasks, validateRudderTasks);
connect(validateOtterTasks, prepareOtterTaskSnapshot);
connect(prepareOtterTaskSnapshot, finalizeOtterTaskSnapshot);
connect(finalizeOtterTaskSnapshot, validateOtterTaskSnapshot);
connect(validateRudderTasks, prepareRudderTaskSnapshot);
connect(prepareRudderTaskSnapshot, finalizeRudderTaskSnapshot);
connect(finalizeRudderTaskSnapshot, validateRudderTaskSnapshot);
connect(validateOtterTaskSnapshot, refreshCodingTaskMetrics);
connect(validateRudderTaskSnapshot, refreshCodingTaskMetrics);

const rigaPayments = sheets("Read Riga July Payments - Unified", "1yvitEtjut8zweM_FnXZNIMxRe6dcIS66A63aggYL1Xw", "July - 2026", [240, 1540]);
const rainierPayments = sheets("Read Rainier July Payments - Unified", "18lcLPsPe223WQ-fPxpwEdHY5klAIMn3RWaTowCO-K6A", "July - 2026", [240, 1660]);
const sequoiaPayments = sheets("Read Sequoia July Payments - Unified", "14oCalx2DT3YH1nVJ8_BJo0owwshxqfqku6mrpoubOEo", "July - 2026", [240, 1780]);
const starfishPayments = sheets("Read Starfish July Payments - Unified", "1en49pUNjs9d74-IulRYQE4ITz74F3RSlj_ANI91q4v0", "July - 2026", [240, 1900]);
const tagRigaPayments = tag("Tag Riga July Payments", "riga", [480, 1540]);
const tagRainierPayments = tag("Tag Rainier July Payments", "rainier", [480, 1660]);
const tagSequoiaPayments = tag("Tag Sequoia July Payments", "sequoia", [480, 1780]);
const tagStarfishPayments = tag("Tag Starfish July Payments", "starfish", [480, 1900]);
const mergeRigaRainierPayments = addNode("Merge Riga + Rainier Payments", "n8n-nodes-base.merge", 3, [720, 1600], {});
const mergeSequoiaPayments = addNode("Merge + Sequoia Payments", "n8n-nodes-base.merge", 3, [960, 1660], {});
const mergeStarfishPayments = addNode("Merge + Starfish Payments", "n8n-nodes-base.merge", 3, [1200, 1720], {});
const normalizeStemPayments = code("Normalize STEM July Payments - Unified", stemPaymentNormalizer, [1440, 1720]);
const upsertStemPayments = http("Sync STEM July Payments - Unified", "sync_stem_july_2026_payments", [1680, 1720], 30000);
const validateStemPayments = code("Validate STEM July Payments - Unified", validateCode, [1920, 1720]);

for (const source of [rigaPayments, rainierPayments, sequoiaPayments, starfishPayments]) connect(validateMaster, source);
connect(rigaPayments, tagRigaPayments); connect(rainierPayments, tagRainierPayments); connect(sequoiaPayments, tagSequoiaPayments); connect(starfishPayments, tagStarfishPayments);
connect(tagRigaPayments, mergeRigaRainierPayments, 0); connect(tagRainierPayments, mergeRigaRainierPayments, 1);
connect(mergeRigaRainierPayments, mergeSequoiaPayments, 0); connect(tagSequoiaPayments, mergeSequoiaPayments, 1);
connect(mergeSequoiaPayments, mergeStarfishPayments, 0); connect(tagStarfishPayments, mergeStarfishPayments, 1);
connect(mergeStarfishPayments, normalizeStemPayments); connect(normalizeStemPayments, upsertStemPayments); connect(upsertStemPayments, validateStemPayments);

const mojavePayments = sheets("Read Mojave July Payments - Unified", "1icVvzZeL2yR7Kj2O6KUcOUKYqpg0S1B2zFI7LRIUDEs", "July - 2026", [2160, 1540]);
const terminusTaskPayments = sheets("Read Terminus Task Payments - Unified", "1Y3IutxG-FM1cIqnnoesZ4xvkchM8vU-uXLcnL_Jw89o", "July, 2026(Task)", [2160, 1660]);
const terminusReviewPayments = sheets("Read Terminus Review Payments - Unified", "1Y3IutxG-FM1cIqnnoesZ4xvkchM8vU-uXLcnL_Jw89o", "July,2026(Review)", [2160, 1780]);
const otterWorkflowAPayments = sheets("Read Otter Workflow A Payments - Unified", "1sBTAySkgFm-GuRqOtwwNSxOyO2Tg94PfvzRyV36Kx1k", "July,2026(workflow A)", [2160, 1900]);
const otterWorkflowBPayments = sheets("Read Otter Workflow B Payments - Unified", "1sBTAySkgFm-GuRqOtwwNSxOyO2Tg94PfvzRyV36Kx1k", "July,2026(workflow B)", [2160, 2020]);
const sentinelAssessmentPayments = sheets("Read Sentinel Assessment Payments - Unified", "1v_z3qHfx9-970-rVgVp0NkT9RoMONcqAkjTVup5yL5U", "July,2026(Assessment)", [2160, 2140]);
const sentinelFixablePayments = sheets("Read Sentinel Fixable Payments - Unified", "1v_z3qHfx9-970-rVgVp0NkT9RoMONcqAkjTVup5yL5U", "July,2026(Fixable)", [2160, 2260]);
const sentinelNonFixablePayments = sheets("Read Sentinel Non Fixable Payments - Unified", "1v_z3qHfx9-970-rVgVp0NkT9RoMONcqAkjTVup5yL5U", "July,2026(N.Fixable)", [2160, 2380]);

for (const sourceName of [
  mojavePayments,
  terminusTaskPayments,
  terminusReviewPayments,
  otterWorkflowAPayments,
  otterWorkflowBPayments,
  sentinelAssessmentPayments,
  sentinelFixablePayments,
  sentinelNonFixablePayments,
]) nodes.find((node) => node.name === sourceName).alwaysOutputData = true;

const tagMojavePayments = tag("Tag Mojave July Payments", "mojave", [2400, 1540]);
const tagTerminusTaskPayments = tag("Tag Terminus Task Payments", "terminus_task", [2400, 1660]);
const tagTerminusReviewPayments = tag("Tag Terminus Review Payments", "terminus_review", [2400, 1780]);
const tagOtterWorkflowAPayments = tag("Tag Otter Workflow A Payments", "otter_a", [2400, 1900]);
const tagOtterWorkflowBPayments = tag("Tag Otter Workflow B Payments", "otter_b", [2400, 2020]);
const tagSentinelAssessmentPayments = tag("Tag Sentinel Assessment Payments", "sentinel_assessment", [2400, 2140]);
const tagSentinelFixablePayments = tag("Tag Sentinel Fixable Payments", "sentinel_fixable", [2400, 2260]);
const tagSentinelNonFixablePayments = tag("Tag Sentinel Non Fixable Payments", "sentinel_non_fixable", [2400, 2380]);

const mergeMojaveTerminusTask = addNode("Merge Mojave + Terminus Task Payments", "n8n-nodes-base.merge", 3, [2640, 1600], {});
const mergeTerminusReview = addNode("Merge + Terminus Review Payments", "n8n-nodes-base.merge", 3, [2880, 1660], {});
const mergeOtterWorkflowA = addNode("Merge + Otter Workflow A Payments", "n8n-nodes-base.merge", 3, [3120, 1720], {});
const mergeOtterWorkflowB = addNode("Merge + Otter Workflow B Payments", "n8n-nodes-base.merge", 3, [3360, 1780], {});
const mergeSentinelAssessment = addNode("Merge + Sentinel Assessment Payments", "n8n-nodes-base.merge", 3, [3600, 1840], {});
const mergeSentinelFixable = addNode("Merge + Sentinel Fixable Payments", "n8n-nodes-base.merge", 3, [3840, 1900], {});
const mergeSentinelNonFixable = addNode("Merge + Sentinel Non Fixable Payments", "n8n-nodes-base.merge", 3, [4080, 1960], {});
const normalizeProjectPayments = code("Normalize Project July Payments - Unified", projectPaymentNormalizer, [4320, 1960]);
const upsertProjectPayments = http("Sync Project July Payments - Unified", "sync_project_july_2026_payments", [4560, 1960], 30000);
const validateProjectPayments = code("Validate Project July Payments - Unified", validateCode, [4800, 1960]);

for (const source of [
  mojavePayments,
  terminusTaskPayments,
  terminusReviewPayments,
  otterWorkflowAPayments,
  otterWorkflowBPayments,
  sentinelAssessmentPayments,
  sentinelFixablePayments,
  sentinelNonFixablePayments,
]) connect(validateStemPayments, source);

connect(mojavePayments, tagMojavePayments); connect(terminusTaskPayments, tagTerminusTaskPayments);
connect(terminusReviewPayments, tagTerminusReviewPayments); connect(otterWorkflowAPayments, tagOtterWorkflowAPayments);
connect(otterWorkflowBPayments, tagOtterWorkflowBPayments); connect(sentinelAssessmentPayments, tagSentinelAssessmentPayments);
connect(sentinelFixablePayments, tagSentinelFixablePayments); connect(sentinelNonFixablePayments, tagSentinelNonFixablePayments);

connect(tagMojavePayments, mergeMojaveTerminusTask, 0); connect(tagTerminusTaskPayments, mergeMojaveTerminusTask, 1);
connect(mergeMojaveTerminusTask, mergeTerminusReview, 0); connect(tagTerminusReviewPayments, mergeTerminusReview, 1);
connect(mergeTerminusReview, mergeOtterWorkflowA, 0); connect(tagOtterWorkflowAPayments, mergeOtterWorkflowA, 1);
connect(mergeOtterWorkflowA, mergeOtterWorkflowB, 0); connect(tagOtterWorkflowBPayments, mergeOtterWorkflowB, 1);
connect(mergeOtterWorkflowB, mergeSentinelAssessment, 0); connect(tagSentinelAssessmentPayments, mergeSentinelAssessment, 1);
connect(mergeSentinelAssessment, mergeSentinelFixable, 0); connect(tagSentinelFixablePayments, mergeSentinelFixable, 1);
connect(mergeSentinelFixable, mergeSentinelNonFixable, 0); connect(tagSentinelNonFixablePayments, mergeSentinelNonFixable, 1);
connect(mergeSentinelNonFixable, normalizeProjectPayments); connect(normalizeProjectPayments, upsertProjectPayments); connect(upsertProjectPayments, validateProjectPayments);

const geraniumTrigger = addNode(
  "Schedule Trigger - Geranium Portal Data",
  "n8n-nodes-base.scheduleTrigger",
  1.2,
  [10080, 3600],
  { rule: { interval: [{ field: "hours", hoursInterval: 6, triggerAtMinute: 45 }] } },
);
const geraniumAllocationRoster = sheets(
  "Read Geranium Allocation Roster",
  "1Z1_5ShwWLN3wMg5fEZuTqFfUtLHZ_UCn-MJU3QGbHpk",
  "Allocation Roster",
  [10320, 3480],
);
const geraniumAllocatedEcs = sheets(
  "Read Geranium Allocated ECs",
  "1aHldihxZXYNAc1IVCbxfP9x51gR31cC4i7PK-rr60yk",
  "Allocated ECs",
  [10320, 3660],
);
const tagGeraniumAllocationRoster = tag(
  "Tag Geranium Allocation Roster",
  "allocation_roster",
  [10560, 3480],
);
const tagGeraniumAllocatedEcs = tag(
  "Tag Geranium Allocated ECs",
  "allocated_ecs",
  [10560, 3660],
);
const mergeGeraniumSources = addNode(
  "Merge Geranium Allocation Sources",
  "n8n-nodes-base.merge",
  3,
  [10800, 3570],
  {},
);
const normalizeGeraniumAssignments = code(
  "Normalize Geranium Assignments",
  geraniumAssignmentNormalizer,
  [11040, 3570],
);
const batchGeraniumAssignments = code(
  "Batch Geranium Assignments",
  assignmentBatchCode,
  [11280, 3570],
);
const upsertGeraniumAssignments = http(
  "Upsert Geranium Assignments",
  "upsert_portal_assignments_batch",
  [11520, 3570],
);
const validateGeraniumAssignments = code(
  "Validate Geranium Assignments",
  validateCode,
  [11760, 3570],
);
const prepareGeraniumSnapshot = code(
  "Prepare Geranium Roster Finalizer",
  geraniumSnapshotNormalizer,
  [12000, 3570],
);
const finalizeGeraniumSnapshot = httpBody(
  "Finalize Geranium Roster Snapshot",
  "finalize_portal_assignment_snapshot",
  '={{ { "p_source_key": $json.p_source_key, "p_sync_run_id": $json.p_sync_run_id, "p_expected_count": $json.p_expected_count } }}',
  [12240, 3570],
  30000,
);
const validateGeraniumSnapshot = code(
  "Validate Geranium Roster Snapshot",
  validateCode,
  [12480, 3570],
);
const geraniumTaskBreakdown = sheets(
  "Read Geranium Task Breakdown",
  "1Z1_5ShwWLN3wMg5fEZuTqFfUtLHZ_UCn-MJU3QGbHpk",
  "Task Breakdown",
  [12720, 3570],
  {
    dataLocationOnSheet: {
      values: {
        rangeDefinition: "specifyRangeA1",
        range: "A1:H",
      },
    },
  },
);
const normalizeGeraniumTaskEvents = code(
  "Normalize Geranium Task Events",
  geraniumTaskEventNormalizer,
  [12960, 3570],
);
const batchGeraniumTaskEvents = code(
  "Batch Geranium Task Events",
  taskSnapshotBatchCode,
  [13200, 3570],
);
const upsertGeraniumTaskEvents = httpBody(
  "Upsert Geranium Task Events",
  "stage_task_event_snapshot_batch",
  '={{ { "p_source_key": $json.p_source_key, "p_sync_run_id": $json.p_sync_run_id, "p_rows": $json.p_rows } }}',
  [13440, 3570],
  30000,
);
const validateGeraniumTaskEvents = code(
  "Validate Geranium Task Events",
  strictValidateCode,
  [13680, 3570],
);
const prepareGeraniumTaskSnapshot = code(
  "Prepare Geranium Task Snapshot Finalizer",
  taskSnapshotFinalizeCode("Normalize Geranium Task Events"),
  [13920, 3510],
);
const finalizeGeraniumTaskSnapshot = httpBody(
  "Finalize Geranium Task Snapshot",
  "finalize_task_event_snapshot",
  '={{ { "p_source_key": $json.p_source_key, "p_sync_run_id": $json.p_sync_run_id, "p_expected_count": $json.p_expected_count } }}',
  [14160, 3510],
  30000,
);
const validateGeraniumTaskSnapshot = code(
  "Validate Geranium Task Snapshot",
  strictValidateCode,
  [14400, 3510],
);
const geraniumMetrics = sheets(
  "Read Geranium Metrics per EC",
  "1Z1_5ShwWLN3wMg5fEZuTqFfUtLHZ_UCn-MJU3QGbHpk",
  "Metrics per EC",
  [14640, 3570],
);
const normalizeGeraniumMetrics = code(
  "Normalize Geranium Metrics",
  geraniumMetricNormalizer,
  [14880, 3570],
);
const batchGeraniumMetrics = code(
  "Batch Geranium Metrics",
  metricBatchCode,
  [15120, 3570],
);
const upsertGeraniumMetrics = http(
  "Upsert Geranium Metrics",
  "upsert_task_metrics_batch",
  [15360, 3570],
  30000,
);
const validateGeraniumMetrics = code(
  "Validate Geranium Metrics",
  validateCode,
  [15600, 3570],
);

for (const sourceName of [
  geraniumAllocationRoster,
  geraniumAllocatedEcs,
  geraniumTaskBreakdown,
  geraniumMetrics,
]) nodes.find((node) => node.name === sourceName).alwaysOutputData = true;

connect(geraniumTrigger, geraniumAllocationRoster);
connect(geraniumTrigger, geraniumAllocatedEcs);
connect(geraniumAllocationRoster, tagGeraniumAllocationRoster);
connect(geraniumAllocatedEcs, tagGeraniumAllocatedEcs);
connect(tagGeraniumAllocationRoster, mergeGeraniumSources, 0);
connect(tagGeraniumAllocatedEcs, mergeGeraniumSources, 1);
connect(mergeGeraniumSources, normalizeGeraniumAssignments);
connect(normalizeGeraniumAssignments, batchGeraniumAssignments);
connect(batchGeraniumAssignments, upsertGeraniumAssignments);
connect(upsertGeraniumAssignments, validateGeraniumAssignments);
connect(validateGeraniumAssignments, prepareGeraniumSnapshot);
connect(prepareGeraniumSnapshot, finalizeGeraniumSnapshot);
connect(finalizeGeraniumSnapshot, validateGeraniumSnapshot);
connect(validateGeraniumSnapshot, geraniumTaskBreakdown);
connect(geraniumTaskBreakdown, normalizeGeraniumTaskEvents);
connect(normalizeGeraniumTaskEvents, batchGeraniumTaskEvents);
connect(batchGeraniumTaskEvents, upsertGeraniumTaskEvents);
connect(upsertGeraniumTaskEvents, validateGeraniumTaskEvents);
connect(validateGeraniumTaskEvents, prepareGeraniumTaskSnapshot);
connect(prepareGeraniumTaskSnapshot, finalizeGeraniumTaskSnapshot);
connect(finalizeGeraniumTaskSnapshot, validateGeraniumTaskSnapshot);
connect(validateGeraniumTaskSnapshot, geraniumMetrics);
connect(geraniumMetrics, normalizeGeraniumMetrics);
connect(normalizeGeraniumMetrics, batchGeraniumMetrics);
connect(batchGeraniumMetrics, upsertGeraniumMetrics);
connect(upsertGeraniumMetrics, validateGeraniumMetrics);

const selection = {
  nodes,
  connections,
  pinData: {},
  meta: { templateCredsSetupCompleted: true },
};

writeFileSync(unifiedOutputUrl, `${JSON.stringify(selection, null, 2)}\n`);

const geraniumNodeNames = new Set([
  geraniumTrigger,
  geraniumAllocationRoster,
  geraniumAllocatedEcs,
  tagGeraniumAllocationRoster,
  tagGeraniumAllocatedEcs,
  mergeGeraniumSources,
  normalizeGeraniumAssignments,
  batchGeraniumAssignments,
  upsertGeraniumAssignments,
  validateGeraniumAssignments,
  prepareGeraniumSnapshot,
  finalizeGeraniumSnapshot,
  validateGeraniumSnapshot,
  geraniumTaskBreakdown,
  normalizeGeraniumTaskEvents,
  batchGeraniumTaskEvents,
  upsertGeraniumTaskEvents,
  validateGeraniumTaskEvents,
  prepareGeraniumTaskSnapshot,
  finalizeGeraniumTaskSnapshot,
  validateGeraniumTaskSnapshot,
  geraniumMetrics,
  normalizeGeraniumMetrics,
  batchGeraniumMetrics,
  upsertGeraniumMetrics,
  validateGeraniumMetrics,
]);
const geraniumSelection = {
  nodes: nodes.filter((node) => geraniumNodeNames.has(node.name)),
  connections: Object.fromEntries(
    Object.entries(connections).filter(([name]) => geraniumNodeNames.has(name)),
  ),
  pinData: {},
  meta: { templateCredsSetupCompleted: true },
};
writeFileSync(
  new URL("../n8n/geranium-portal-data.selection.json", import.meta.url),
  `${JSON.stringify(geraniumSelection, null, 2)}\n`,
);

const codingSourceNodeNames = new Set([
  codingSourcesTrigger,
  terminusRoster,
  otterRoster,
  suiteLifeRoster,
  rudderRoster,
  tagTerminusRoster,
  tagOtterRoster,
  tagSuiteLifeRoster,
  tagRudderRoster,
  mergeTerminusOtterRosters,
  mergeSuiteLifeRoster,
  mergeRudderRoster,
  normalizeCodingRosters,
  batchCodingRosters,
  upsertCodingRosters,
  validateCodingRosters,
  summarizeRosterSnapshots,
  finalizeCodingRosters,
  validateRosterFinalizers,
  terminusTasks,
  normalizeTerminusTasks,
  batchTerminusTasks,
  upsertTerminusTasks,
  validateTerminusTasks,
  otterTasks,
  normalizeOtterTasks,
  batchOtterTasks,
  upsertOtterTasks,
  validateOtterTasks,
  prepareOtterTaskSnapshot,
  finalizeOtterTaskSnapshot,
  validateOtterTaskSnapshot,
  rudderTasks,
  normalizeRudderTasks,
  batchRudderTasks,
  upsertRudderTasks,
  validateRudderTasks,
  prepareRudderTaskSnapshot,
  finalizeRudderTaskSnapshot,
  validateRudderTaskSnapshot,
  refreshCodingTaskMetrics,
]);
const codingSourceSelection = {
  nodes: nodes.filter((node) => codingSourceNodeNames.has(node.name)),
  connections: Object.fromEntries(
    Object.entries(connections).filter(([name]) => codingSourceNodeNames.has(name)),
  ),
  pinData: {},
  meta: { templateCredsSetupCompleted: true },
};
writeFileSync(
  new URL("../n8n/coding-project-sources.selection.json", import.meta.url),
  `${JSON.stringify(codingSourceSelection, null, 2)}\n`,
);

const stemPaymentNodeNames = new Set([
  rigaPayments,
  rainierPayments,
  sequoiaPayments,
  starfishPayments,
  tagRigaPayments,
  tagRainierPayments,
  tagSequoiaPayments,
  tagStarfishPayments,
  mergeRigaRainierPayments,
  mergeSequoiaPayments,
  mergeStarfishPayments,
  normalizeStemPayments,
  upsertStemPayments,
  validateStemPayments,
]);
const standaloneStemTrigger = {
  parameters: { rule: { interval: [{ field: "days", daysInterval: 3, triggerAtHour: 0, triggerAtMinute: 0 }] } },
  id: existingStandaloneIds.get("Schedule Trigger - STEM July Payments") ?? randomUUID(),
  name: "Schedule Trigger - STEM July Payments",
  type: "n8n-nodes-base.scheduleTrigger",
  typeVersion: 1.2,
  position: [0, 1720],
};
const stemPaymentConnections = Object.fromEntries(
  Object.entries(connections)
    .filter(([name]) => stemPaymentNodeNames.has(name))
    .map(([name, value]) => [name, value]),
);
stemPaymentConnections[standaloneStemTrigger.name] = {
  main: [[
    { node: rigaPayments, type: "main", index: 0 },
    { node: rainierPayments, type: "main", index: 0 },
    { node: sequoiaPayments, type: "main", index: 0 },
    { node: starfishPayments, type: "main", index: 0 },
  ]],
};
const stemPaymentSelection = {
  nodes: [standaloneStemTrigger, ...nodes.filter((node) => stemPaymentNodeNames.has(node.name))],
  connections: stemPaymentConnections,
  pinData: {},
  meta: { templateCredsSetupCompleted: true },
};
writeFileSync(new URL("../n8n/stem-july-2026-payments.selection.json", import.meta.url), `${JSON.stringify(stemPaymentSelection, null, 2)}\n`);

const projectPaymentNodeNames = new Set([
  mojavePayments,
  terminusTaskPayments,
  terminusReviewPayments,
  otterWorkflowAPayments,
  otterWorkflowBPayments,
  sentinelAssessmentPayments,
  sentinelFixablePayments,
  sentinelNonFixablePayments,
  tagMojavePayments,
  tagTerminusTaskPayments,
  tagTerminusReviewPayments,
  tagOtterWorkflowAPayments,
  tagOtterWorkflowBPayments,
  tagSentinelAssessmentPayments,
  tagSentinelFixablePayments,
  tagSentinelNonFixablePayments,
  mergeMojaveTerminusTask,
  mergeTerminusReview,
  mergeOtterWorkflowA,
  mergeOtterWorkflowB,
  mergeSentinelAssessment,
  mergeSentinelFixable,
  mergeSentinelNonFixable,
  normalizeProjectPayments,
  upsertProjectPayments,
  validateProjectPayments,
]);
const standaloneProjectPaymentTrigger = {
  parameters: { rule: { interval: [{ field: "days", daysInterval: 3, triggerAtHour: 0, triggerAtMinute: 15 }] } },
  id: existingStandaloneIds.get("Schedule Trigger - Project July Payments") ?? randomUUID(),
  name: "Schedule Trigger - Project July Payments",
  type: "n8n-nodes-base.scheduleTrigger",
  typeVersion: 1.2,
  position: [1920, 1960],
};
const projectPaymentConnections = Object.fromEntries(
  Object.entries(connections)
    .filter(([name]) => projectPaymentNodeNames.has(name))
    .map(([name, value]) => [name, value]),
);
projectPaymentConnections[standaloneProjectPaymentTrigger.name] = {
  main: [[
    { node: mojavePayments, type: "main", index: 0 },
    { node: terminusTaskPayments, type: "main", index: 0 },
    { node: terminusReviewPayments, type: "main", index: 0 },
    { node: otterWorkflowAPayments, type: "main", index: 0 },
    { node: otterWorkflowBPayments, type: "main", index: 0 },
    { node: sentinelAssessmentPayments, type: "main", index: 0 },
    { node: sentinelFixablePayments, type: "main", index: 0 },
    { node: sentinelNonFixablePayments, type: "main", index: 0 },
  ]],
};
const projectPaymentSelection = {
  nodes: [standaloneProjectPaymentTrigger, ...nodes.filter((node) => projectPaymentNodeNames.has(node.name))],
  connections: projectPaymentConnections,
  pinData: {},
  meta: { templateCredsSetupCompleted: true },
};
writeFileSync(new URL("../n8n/project-july-2026-payments.selection.json", import.meta.url), `${JSON.stringify(projectPaymentSelection, null, 2)}\n`);
