/* ============================================================
   /api/sales-agent — Vercel Serverless Function

   Two modes, dispatched upfront based on the HubSpot webhook
   event type:

   MODE 1 — Lead Qualification
     Trigger: contact.creation OR contact.propertyChange on lead_source
     Filter:  lead_source ∈ {course_waitlist, prompt_library,
                             ai_brain_rate_card, cto_services}
     Action:  classify lead, score urgency, draft follow-up email,
              write Note with [sales-agent-v1] marker.

   MODE 2 — Sprint Pipeline Auto-routing (E8)
     Trigger: contact.propertyChange on course_status = "graduated"
     Filter:  course_status === 'graduated' AND course_repo_url set
     Action:  read participant's repo (baseline.md + handover.md)
              via GitHub Contents API, classify Sprint-readiness,
              draft Sprint outreach email, write PRIVATE Note with
              [sprint-pipeline-v1] marker (students never see this).

   ── Environment ───────────────────────────────────────────────
     HUBSPOT_TOKEN
       Private App access token. Scopes needed:
         crm.objects.contacts.read
         crm.objects.notes.read   (idempotency check)
         crm.objects.notes.write  (create the Note)
     SALES_AGENT_TOKEN
       The HubSpot-generated webhook client secret. Used as the
       HMAC SIGNING KEY for v3 signature verification.
     ANTHROPIC_API_KEY
       Claude API key (consumed by lib/claude.js).
     GITHUB_COHORT_TOKEN  (optional — required only for MODE 2)
       Fine-grained PAT with Contents:Read + Metadata:Read on
       invited cohort participant repos. 90-day expiration.
       Missing token: MODE 1 still works; MODE 2 writes ERROR Note.
     PRICING_NOTES   (optional)
       Sensitive pricing detail the public MARKETING.md must not
       contain. Appended to the Claude system prompt at runtime
       via lib/claude.buildSystemPrompt.

   ── Contract ─────────────────────────────────────────────────
     POST /api/sales-agent
       Headers:
         X-HubSpot-Signature-v3:   base64 HMAC-SHA256 sig
         X-HubSpot-Request-Timestamp: ms-since-epoch
       Body: HubSpot v3 webhook payload (JSON array of events)
       Responses:
         200 { ok: true, lead_qualified: N, sprint_routed: N, ... }
         401 { ok: false, error: 'invalid_signature' }
         405 { ok: false, error: 'method_not_allowed' }
         500 { ok: false, error: 'server_misconfigured' }

   ── Codex Critical Fixes (all implemented) ───────────────────
     CB1: webhook payload sends objectId only — properties fetched
          via GET /crm/v3/objects/contacts/{id}?properties=...
     CB2: contact.propertyChange catches PATCH updates on
          lead_source AND course_status (two separate subscriptions
          in HubSpot, single handler routes by propertyName).
     CB3: HMAC v3 signed string = method + url + body + timestamp,
          clientSecret as signing key, raw body via bodyParser:false.
     CB4: MARKETING.md path delegated to lib/claude.loadMarketingMd
          which uses ../MARKETING.md relative to lib/.
     CB5: Note idempotency via
          GET /crm/v4/associations/contacts/notes/{contactId}
          + check each note body for marker. Marker is a parameter
          so MODE 1 and MODE 2 use distinct markers.

   ── Why the dispatch-upfront pattern (eng-review A1) ─────────
     processLeadQualification and processSprintPipeline are
     semantically distinct jobs with different filters, prompts,
     idempotency markers, and Note formats. Routing at the top of
     the event loop keeps each handler legible. Shared concerns
     (HMAC, raw body, contact fetch, Note create, lib/claude) stay
     common helpers below.
   ============================================================ */

const crypto = require('crypto');
const claude = require('../lib/claude.js');

// Shared constants
const SALES_AGENT_MARKER = '[sales-agent-v1]';
const SPRINT_PIPELINE_MARKER = '[sprint-pipeline-v1]';

// MODE 1 — Lead Qualification
// Hard allowlist of lead_source values the agent will process.
// Anything else (manual CRM entries, unknown sources, missing) is
// skipped without a Note.
const ALLOWED_LEAD_SOURCES = new Set([
  'course_waitlist',
  'prompt_library',
  'ai_brain_rate_card',
  'cto_services'
]);

// MODE 2 — Sprint Pipeline
// Only triggers on course_status flipping to this value.
const GRADUATED_STATUS = 'graduated';

// Reject anything larger than this — protects against malformed
// or hostile bodies.
const MAX_BODY_BYTES = 1 * 1024 * 1024;

// Replay window: HubSpot signature timestamps older than this are
// rejected. 5 minutes is the standard value.
const SIGNATURE_REPLAY_WINDOW_MS = 5 * 60 * 1000;

// ── Response helper ──────────────────────────────────────────
function jsonResponse(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
}

// ── Raw body reader (CB3) ────────────────────────────────────
async function readRawBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error('body_too_large');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// ── HMAC v3 verification (CB3) ───────────────────────────────
function verifyHubspotSignature(req, rawBody, secret) {
  const sig = req.headers['x-hubspot-signature-v3'];
  const ts = req.headers['x-hubspot-request-timestamp'];
  if (typeof sig !== 'string' || typeof ts !== 'string') return false;

  const tsNum = parseInt(ts, 10);
  if (!Number.isFinite(tsNum)) return false;
  if (Math.abs(Date.now() - tsNum) > SIGNATURE_REPLAY_WINDOW_MS) return false;

  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!host) return false;
  const url = `${proto}://${host}${req.url}`;

  const signedString = req.method + url + rawBody + ts;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(signedString, 'utf8')
    .digest('base64');

  if (sig.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch (_) {
    return false;
  }
}

// ── HubSpot: fetch contact properties (CB1) ──────────────────
// Both MODES need the full property set so we ask for everything
// either mode might use.
async function fetchContact(contactId, token) {
  const props = [
    'firstname', 'lastname', 'email', 'company',
    'message', 'lead_source', 'funding_stage',
    'course_interest', 'course_status', 'course_repo_url'
  ];
  const url = `https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(contactId)}?properties=${props.join(',')}`;
  const res = await fetch(url, {
    headers: { Authorization: 'Bearer ' + token }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error('hubspot_fetch_contact_failed: ' + res.status);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return res.json();
}

// ── HubSpot: idempotency check (CB5) ─────────────────────────
// Now parameterized on marker so MODE 1 and MODE 2 use distinct
// markers. Each mode is independent — a contact can have both a
// [sales-agent-v1] Note (from MODE 1 at signup) AND a
// [sprint-pipeline-v1] Note (from MODE 2 at graduation).
async function hasPriorAgentNote(contactId, token, marker) {
  const assocUrl = `https://api.hubapi.com/crm/v4/associations/contacts/notes/${encodeURIComponent(contactId)}`;
  const assocRes = await fetch(assocUrl, {
    headers: { Authorization: 'Bearer ' + token }
  });
  if (assocRes.status === 404) return false;
  if (!assocRes.ok) {
    const err = new Error('hubspot_assoc_failed: ' + assocRes.status);
    err.status = assocRes.status;
    throw err;
  }
  const assocData = await assocRes.json().catch(() => ({}));
  const noteIds = (assocData.results || []).map(r => r.toObjectId).filter(Boolean);
  if (noteIds.length === 0) return false;

  for (const noteId of noteIds) {
    const noteRes = await fetch(
      `https://api.hubapi.com/crm/v3/objects/notes/${encodeURIComponent(noteId)}?properties=hs_note_body`,
      { headers: { Authorization: 'Bearer ' + token } }
    );
    if (!noteRes.ok) continue;
    const note = await noteRes.json().catch(() => ({}));
    const body = (note.properties && note.properties.hs_note_body) || '';
    if (body.includes(marker)) return true;
  }
  return false;
}

// ── HubSpot: write a Note associated with the contact ────────
async function createNote(contactId, body, token) {
  const url = 'https://api.hubapi.com/crm/v3/objects/notes';
  const payload = {
    properties: {
      hs_note_body: body,
      hs_timestamp: Date.now()
    },
    associations: [
      {
        to: { id: String(contactId) },
        // 202 = note → contact association type id (CRM v3).
        types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }]
      }
    ]
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error('hubspot_note_create_failed: ' + res.status);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return res.json().catch(() => ({}));
}

// ── GitHub: fetch repo file contents (MODE 2 only) ───────────
// Parses a repo URL like https://github.com/owner/repo and calls
// the GitHub Contents API for each requested path. Returns a map
// of { path: content } or throws on auth failure.
//
// Permissions required on GITHUB_COHORT_TOKEN:
//   Contents: Read  (read file contents)
//   Metadata: Read  (default — implicit)
//
// Failure modes:
//   404 → file or repo missing → returns null for that path
//   403 → token expired/revoked OR not collaborator → throws
//   other → throws
function parseRepoUrl(repoUrl) {
  if (typeof repoUrl !== 'string') return null;
  const m = repoUrl.match(/github\.com\/([^/]+)\/([^/?#]+?)(?:\.git)?(?:[/?#]|$)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

async function fetchRepoFile(owner, repo, filePath, token) {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${filePath}`;
  const res = await fetch(url, {
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github.v3.raw',
      'User-Agent': 'cto-od-sales-agent'
    }
  });
  if (res.status === 404) return null;
  if (res.status === 403 || res.status === 401) {
    const err = new Error('github_auth_failed: ' + res.status);
    err.status = res.status;
    err.body = await res.text().catch(() => '');
    throw err;
  }
  if (!res.ok) {
    const err = new Error('github_fetch_failed: ' + res.status);
    err.status = res.status;
    throw err;
  }
  return await res.text();
}

// ── Note body formatters (one per mode) ──────────────────────
function formatLeadNoteBody({ icp, urgency, email_draft, error }) {
  if (error) {
    return [
      SALES_AGENT_MARKER,
      'ERROR: ' + error,
      '',
      'The agent processed this lead but could not produce an',
      'email draft. Please review the contact manually.'
    ].join('\n');
  }
  return [
    SALES_AGENT_MARKER,
    `ICP: ${icp}`,
    `Urgency: ${urgency}/5`,
    '',
    '--- SUGGESTED EMAIL DRAFT ---',
    '',
    email_draft
  ].join('\n');
}

function formatSprintNoteBody({ readiness, signals, email_draft, error }) {
  if (error) {
    return [
      SPRINT_PIPELINE_MARKER,
      'ERROR: ' + error,
      '',
      'The Sprint pipeline could not auto-draft outreach for this',
      'graduate. Review the participant manually before reaching out.'
    ].join('\n');
  }
  return [
    SPRINT_PIPELINE_MARKER,
    `Sprint-readiness: ${readiness}/5`,
    `Signals: ${Array.isArray(signals) ? signals.join(', ') : signals}`,
    '',
    '--- SUGGESTED SPRINT OUTREACH (private to Nick) ---',
    '',
    email_draft,
    '',
    '— Reminder: this note is internal only. Students never see it.'
  ].join('\n');
}

// ── MODE 1: Lead Qualification ───────────────────────────────
async function processLeadQualification(event, hubspotToken) {
  const contactId = event.objectId;
  if (!contactId) return 'skipped_no_id';

  // Defence in depth: if it's a property change, only react to lead_source.
  if (
    event.subscriptionType === 'contact.propertyChange' &&
    event.propertyName &&
    event.propertyName !== 'lead_source'
  ) {
    return 'skipped_wrong_property';
  }

  let contact;
  try {
    contact = await fetchContact(contactId, hubspotToken);
  } catch (err) {
    console.error('[/api/sales-agent] lead_q.fetch_contact_failed', contactId, err.status, err.body);
    return 'error';
  }

  const props = contact.properties || {};
  const leadSource = props.lead_source;

  if (!leadSource || !ALLOWED_LEAD_SOURCES.has(leadSource)) {
    return 'skipped_filter';
  }

  let prior;
  try {
    prior = await hasPriorAgentNote(contactId, hubspotToken, SALES_AGENT_MARKER);
  } catch (err) {
    console.error('[/api/sales-agent] lead_q.idempotency_failed', contactId, err.status);
    return 'error';
  }
  if (prior) return 'skipped_dupe';

  // Build prompts + call Claude
  const systemPrompt = claude.buildSystemPrompt({
    heading: 'Pricing Notes (Private — do not quote prices directly)',
    body: process.env.PRICING_NOTES
  });
  const userPrompt = [
    '<lead_data>',
    `<firstname>${claude.escapeXml(props.firstname || '')}</firstname>`,
    `<company>${claude.escapeXml(props.company || '')}</company>`,
    `<email>${claude.escapeXml(props.email || '')}</email>`,
    `<lead_source>${claude.escapeXml(leadSource)}</lead_source>`,
    `<funding_stage>${claude.escapeXml(props.funding_stage || '')}</funding_stage>`,
    `<message>${claude.escapeXml(props.message || '')}</message>`,
    '</lead_data>',
    '',
    'Classify this lead, score urgency, and draft a personalised',
    'follow-up email Nick can send. Respond with JSON ONLY (no',
    'preamble, no markdown fences). Schema:',
    '',
    '{',
    '  "icp": "cto_services" | "ai_brain" | "course",',
    '  "urgency": 1 | 2 | 3 | 4 | 5,',
    '  "email_draft": "the full email body as plain text, no signature"',
    '}'
  ].join('\n');

  let responseText;
  try {
    responseText = await claude.callClaude({ system: systemPrompt, user: userPrompt });
  } catch (err) {
    console.error('[/api/sales-agent] lead_q.claude_failed', contactId, err.status, err.body);
    try {
      await createNote(contactId, formatLeadNoteBody({ error: 'Claude API call failed (' + (err.status || 'unknown') + ')' }), hubspotToken);
    } catch (noteErr) {
      console.error('[/api/sales-agent] lead_q.error_note_failed', contactId, noteErr.status);
    }
    return 'error';
  }

  const parsed = claude.parseJsonResponse(responseText, ['icp', 'urgency', 'email_draft']);
  let noteBody;
  if (parsed.ok) {
    noteBody = formatLeadNoteBody(parsed.value);
  } else if (parsed.reason === 'empty_response') {
    noteBody = formatLeadNoteBody({ error: 'Claude returned no response.' });
  } else {
    // Bounded fallback — still ship Nick something useful.
    noteBody = formatLeadNoteBody({
      icp: 'unknown',
      urgency: 3,
      email_draft: (responseText || '').slice(0, 1500)
    });
  }

  try {
    await createNote(contactId, noteBody, hubspotToken);
  } catch (err) {
    console.error('[/api/sales-agent] lead_q.note_create_failed', contactId, err.status, err.body);
    return 'error';
  }
  return 'lead_qualified';
}

// ── MODE 2: Sprint Pipeline Auto-routing (E8) ────────────────
async function processSprintPipeline(event, hubspotToken, githubToken) {
  const contactId = event.objectId;
  if (!contactId) return 'skipped_no_id';

  // Only fire on course_status change events.
  if (event.subscriptionType !== 'contact.propertyChange' || event.propertyName !== 'course_status') {
    return 'skipped_wrong_property';
  }

  let contact;
  try {
    contact = await fetchContact(contactId, hubspotToken);
  } catch (err) {
    console.error('[/api/sales-agent] sprint.fetch_contact_failed', contactId, err.status, err.body);
    return 'error';
  }

  const props = contact.properties || {};
  if (props.course_status !== GRADUATED_STATUS) {
    return 'skipped_filter';
  }

  let prior;
  try {
    prior = await hasPriorAgentNote(contactId, hubspotToken, SPRINT_PIPELINE_MARKER);
  } catch (err) {
    console.error('[/api/sales-agent] sprint.idempotency_failed', contactId, err.status);
    return 'error';
  }
  if (prior) return 'skipped_dupe';

  // Env var gating — MODE 1 doesn't need GITHUB_COHORT_TOKEN, only MODE 2.
  if (!githubToken) {
    console.error('[/api/sales-agent] sprint.missing_github_token', contactId);
    try {
      await createNote(contactId, formatSprintNoteBody({ error: 'GITHUB_COHORT_TOKEN env var missing — cannot read repo.' }), hubspotToken);
    } catch (_) { /* swallow */ }
    return 'error';
  }

  const repoUrl = props.course_repo_url;
  const parsed = parseRepoUrl(repoUrl);
  if (!parsed) {
    console.warn('[/api/sales-agent] sprint.missing_or_invalid_repo_url', contactId, repoUrl);
    try {
      await createNote(contactId, formatSprintNoteBody({ error: `course_repo_url missing or invalid: ${repoUrl || '(unset)'}` }), hubspotToken);
    } catch (_) { /* swallow */ }
    return 'error';
  }

  // Read participant files from the private repo.
  let baseline = null;
  let handover = null;
  try {
    [baseline, handover] = await Promise.all([
      fetchRepoFile(parsed.owner, parsed.repo, 'baseline.md', githubToken),
      fetchRepoFile(parsed.owner, parsed.repo, 'handover.md', githubToken)
    ]);
  } catch (err) {
    console.error('[/api/sales-agent] sprint.github_fetch_failed', contactId, err.status, err.body);
    const reason = err.status === 403 || err.status === 401
      ? `GitHub access denied (${err.status}) — PAT may be expired/revoked or not a collaborator on ${parsed.owner}/${parsed.repo}.`
      : `GitHub fetch failed (${err.status || 'unknown'}).`;
    try {
      await createNote(contactId, formatSprintNoteBody({ error: reason }), hubspotToken);
    } catch (_) { /* swallow */ }
    return 'error';
  }

  if (!baseline && !handover) {
    try {
      await createNote(contactId, formatSprintNoteBody({ error: `Neither baseline.md nor handover.md found in ${parsed.owner}/${parsed.repo} — manual review needed.` }), hubspotToken);
    } catch (_) { /* swallow */ }
    return 'partial';
  }

  // Build Sprint-readiness prompt.
  const systemPrompt = claude.buildSystemPrompt([
    {
      heading: 'Pricing Notes (Private — do not quote prices directly)',
      body: process.env.PRICING_NOTES
    },
    {
      heading: 'Task Mode — Sprint Pipeline Auto-routing',
      body: [
        'You are evaluating a cohort graduate as a potential AI Brain Sprint',
        'client (£6,500). Graduates already paid £1,500 for the course; if',
        'they upgrade to Sprint, the £1,500 credits against the Sprint price.',
        '',
        'Score Sprint-readiness 1-5 based on the evidence in their baseline',
        'and handover files:',
        '  5 = clear pain, clear scope, named ROI, explicit upgrade intent',
        '  4 = clear pain + scope, ROI implied but not stated',
        '  3 = solid completion, no Sprint signal either way',
        '  2 = light completion, weak Sprint fit',
        '  1 = course was a poor fit; recommend NOT pursuing Sprint',
        '',
        'Draft a SHORT outreach email (3-5 sentences) Nick can adapt — not',
        'a sales pitch, a "saw what you built, want to talk about Sprint?"',
        'opener. Reference one specific thing from their repo.'
      ].join('\n')
    }
  ]);

  const userPrompt = [
    '<participant>',
    `<firstname>${claude.escapeXml(props.firstname || '')}</firstname>`,
    `<company>${claude.escapeXml(props.company || '')}</company>`,
    `<email>${claude.escapeXml(props.email || '')}</email>`,
    `<repo>${claude.escapeXml(`${parsed.owner}/${parsed.repo}`)}</repo>`,
    '</participant>',
    '',
    '<baseline_md>',
    claude.escapeXml(baseline || '(file missing)'),
    '</baseline_md>',
    '',
    '<handover_md>',
    claude.escapeXml(handover || '(file missing)'),
    '</handover_md>',
    '',
    'Respond with JSON ONLY (no preamble, no markdown fences). Schema:',
    '',
    '{',
    '  "readiness": 1 | 2 | 3 | 4 | 5,',
    '  "signals": ["short evidence bullet", "another", "another"],',
    '  "email_draft": "3-5 sentence outreach, no signature"',
    '}'
  ].join('\n');

  let responseText;
  try {
    responseText = await claude.callClaude({ system: systemPrompt, user: userPrompt });
  } catch (err) {
    console.error('[/api/sales-agent] sprint.claude_failed', contactId, err.status, err.body);
    try {
      await createNote(contactId, formatSprintNoteBody({ error: 'Claude API call failed (' + (err.status || 'unknown') + ')' }), hubspotToken);
    } catch (_) { /* swallow */ }
    return 'error';
  }

  const result = claude.parseJsonResponse(responseText, ['readiness', 'signals', 'email_draft']);
  let noteBody;
  if (result.ok) {
    noteBody = formatSprintNoteBody(result.value);
  } else if (result.reason === 'empty_response') {
    noteBody = formatSprintNoteBody({ error: 'Claude returned no response.' });
  } else {
    noteBody = formatSprintNoteBody({
      readiness: 3,
      signals: ['(parse_failed — see raw output below)'],
      email_draft: (responseText || '').slice(0, 1500)
    });
  }

  try {
    await createNote(contactId, noteBody, hubspotToken);
  } catch (err) {
    console.error('[/api/sales-agent] sprint.note_create_failed', contactId, err.status, err.body);
    return 'error';
  }
  return 'sprint_routed';
}

// ── Dispatch ─────────────────────────────────────────────────
// Decides which mode handles each event. The decision is cheap —
// no HubSpot API calls — so we can route precisely.
function dispatch(event) {
  if (event.subscriptionType === 'contact.creation') return 'lead_qualification';
  if (event.subscriptionType === 'contact.propertyChange') {
    if (event.propertyName === 'course_status') return 'sprint_pipeline';
    if (event.propertyName === 'lead_source') return 'lead_qualification';
    if (!event.propertyName) return 'lead_qualification'; // defensive fallback
  }
  return 'unknown';
}

// ── Handler ──────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  const startedAt = Date.now();

  if (req.method !== 'POST') {
    return jsonResponse(res, 405, { ok: false, error: 'method_not_allowed' });
  }

  const hubspotToken = process.env.HUBSPOT_TOKEN;
  const agentToken = process.env.SALES_AGENT_TOKEN;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  // GITHUB_COHORT_TOKEN is optional at handler level — only checked
  // inside processSprintPipeline. MODE 1 doesn't need it.
  const githubToken = process.env.GITHUB_COHORT_TOKEN;

  if (!hubspotToken || !agentToken || !anthropicKey) {
    console.error('[/api/sales-agent] missing env var(s)', {
      hubspot: !!hubspotToken,
      sales_agent: !!agentToken,
      anthropic: !!anthropicKey
    });
    return jsonResponse(res, 500, { ok: false, error: 'server_misconfigured' });
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    if (err.message === 'body_too_large') {
      return jsonResponse(res, 413, { ok: false, error: 'body_too_large' });
    }
    console.error('[/api/sales-agent] body_read_failed', err);
    return jsonResponse(res, 400, { ok: false, error: 'body_read_failed' });
  }

  if (!verifyHubspotSignature(req, rawBody, agentToken)) {
    console.warn('[/api/sales-agent] invalid_signature', {
      ip: req.headers['x-forwarded-for'] || 'unknown',
      ts: req.headers['x-hubspot-request-timestamp']
    });
    return jsonResponse(res, 401, { ok: false, error: 'invalid_signature' });
  }

  let events;
  try {
    const body = JSON.parse(rawBody);
    events = Array.isArray(body) ? body : [body];
  } catch (err) {
    console.error('[/api/sales-agent] invalid_json', err);
    return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
  }

  // Process events sequentially. Each event goes to exactly one
  // handler based on dispatch().
  const counts = {
    lead_qualified: 0,
    sprint_routed: 0,
    skipped_filter: 0,
    skipped_dupe: 0,
    skipped_other: 0,
    error: 0,
    partial: 0
  };

  for (const event of events) {
    const mode = dispatch(event);
    let outcome;
    if (mode === 'lead_qualification') {
      outcome = await processLeadQualification(event, hubspotToken);
    } else if (mode === 'sprint_pipeline') {
      outcome = await processSprintPipeline(event, hubspotToken, githubToken);
    } else {
      outcome = 'skipped_other';
    }

    if (outcome === 'lead_qualified') counts.lead_qualified++;
    else if (outcome === 'sprint_routed') counts.sprint_routed++;
    else if (outcome === 'skipped_filter') counts.skipped_filter++;
    else if (outcome === 'skipped_dupe') counts.skipped_dupe++;
    else if (outcome === 'error') counts.error++;
    else if (outcome === 'partial') counts.partial++;
    else counts.skipped_other++;
  }

  const elapsed = Date.now() - startedAt;
  if (elapsed > 15000) {
    console.warn('[/api/sales-agent] slow_request', { elapsed_ms: elapsed, events: events.length });
  }
  console.log('[/api/sales-agent] done', { elapsed_ms: elapsed, ...counts });

  return jsonResponse(res, 200, { ok: true, ...counts });
};

// Vercel function config — set AFTER the handler assignment.
module.exports.config = {
  api: { bodyParser: false },
  maxDuration: 60
};

// ── Test exports (only when imported, not via Vercel handler) ──
// Tests import individual functions directly. Vercel ignores this.
module.exports.__test = {
  dispatch,
  parseRepoUrl,
  verifyHubspotSignature,
  hasPriorAgentNote,
  formatLeadNoteBody,
  formatSprintNoteBody,
  ALLOWED_LEAD_SOURCES,
  SALES_AGENT_MARKER,
  SPRINT_PIPELINE_MARKER,
  GRADUATED_STATUS
};
