/* ============================================================
   /api/sales-agent — Vercel Serverless Function

   AI sales agent that receives HubSpot contact.creation +
   contact.propertyChange webhooks, fetches the contact's
   properties, classifies the lead with Claude using MARKETING.md
   as the system prompt, and writes a HubSpot CRM Note with a
   suggested follow-up email draft for Nick to review and send.

   ── Environment ───────────────────────────────────────────────
     HUBSPOT_TOKEN
       Private App access token. Scopes needed:
         crm.objects.contacts.read
         crm.objects.notes.read   (idempotency check)
         crm.objects.notes.write  (create the Note)
     SALES_AGENT_TOKEN
       The HubSpot-generated webhook client secret. Used as the
       HMAC SIGNING KEY for v3 signature verification. NOT a
       bearer token.
     ANTHROPIC_API_KEY
       Claude API key.
     PRICING_NOTES   (optional)
       Sensitive pricing detail the public MARKETING.md must not
       contain. Appended to the Claude system prompt at runtime.

   ── Contract ─────────────────────────────────────────────────
     POST /api/sales-agent
       Headers:
         X-HubSpot-Signature-v3:   base64 HMAC-SHA256 sig
         X-HubSpot-Request-Timestamp: ms-since-epoch
       Body: HubSpot v3 webhook payload (JSON array of events)
       Responses:
         200 { ok: true, processed: N, skipped: N }
         401 { ok: false, error: 'invalid_signature' }
         405 { ok: false, error: 'method_not_allowed' }
         500 { ok: false, error: 'server_misconfigured' }

   ── Codex Critical Fixes (all implemented below) ──────────────
     CB1: contact.creation webhook payload sends `objectId` ONLY,
          not the contact's properties. We fetch them via
          GET /crm/v3/objects/contacts/{id}?properties=... before
          deciding whether to process.
     CB2: PATCH on an existing contact does NOT trigger
          contact.creation. The HubSpot webhook subscription must
          ALSO include contact.propertyChange on `lead_source`.
          This handler treats both event types the same way.
     CB3: HMAC v3 signed string is
          `httpMethod + requestUrl + requestBody + timestamp`.
          The clientSecret is the HMAC SIGNING KEY, not prefixed
          to the signed string. Raw body is required — Vercel's
          bodyParser is disabled below so we read req as a stream.
     CB4: MARKETING.md lives at the repo root. From `api/`, that
          is `../MARKETING.md` — NOT `../../MARKETING.md`.
     CB5: Note idempotency uses
          GET /crm/v4/associations/contacts/notes/{contactId}
          to list associated note IDs, then GETs each note body
          to check for the `[sales-agent-v1]` marker. The v3
          query string form is not a valid HubSpot endpoint for
          this lookup.

   ── Bot/abuse posture ────────────────────────────────────────
     HMAC verification on every request. Anything that fails
     signature check returns 401 immediately with no processing.
     Lead source filter rejects anything not on the allowlist.
     Idempotency check prevents duplicate Notes on HubSpot retry.

   ============================================================ */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Vercel function config is attached to module.exports at the
// bottom of the file (after the handler is assigned) so the
// handler reassignment doesn't clobber it.

// Claude model. Update when migrating to a newer Sonnet release.
// Prompt caching depends on system prompt stability — MARKETING.md
// changes invalidate the cache, which is fine (deploys are rare).
const CLAUDE_MODEL = 'claude-sonnet-4-5';
const CLAUDE_API = 'https://api.anthropic.com/v1/messages';
const CLAUDE_VERSION = '2023-06-01';

// Hard allowlist of lead_source values the agent will process.
// Anything else (manual CRM entries, unknown sources, missing) is
// skipped without a Note. The filter cost is one string compare —
// we still fetch the contact (one API call) to find out the value.
const ALLOWED_LEAD_SOURCES = new Set([
  'course_waitlist',
  'prompt_library',
  'ai_brain_rate_card',
  'cto_services'
]);

// Marker we embed in the Note body to detect prior runs on retry.
// Bumping this version (e.g. v2) is how you re-process old leads
// without manually deleting notes.
const SALES_AGENT_MARKER = '[sales-agent-v1]';

// Reject anything larger than this — protects against malformed
// or hostile bodies. HubSpot's largest legitimate payload is a
// batch of property change events; 1 MB is far above that ceiling.
const MAX_BODY_BYTES = 1 * 1024 * 1024;

// Replay window: HubSpot signature timestamps older than this are
// rejected. 5 minutes is the standard value.
const SIGNATURE_REPLAY_WINDOW_MS = 5 * 60 * 1000;

// MARKETING.md read at module load. Module is reloaded on cold
// start; on warm starts the cached read is reused (faster).
let _marketingMdCache = null;
function loadMarketingMd() {
  if (_marketingMdCache) return _marketingMdCache;
  // CB4: ../MARKETING.md (one level up from api/), not ../../
  const p = path.join(__dirname, '..', 'MARKETING.md');
  _marketingMdCache = fs.readFileSync(p, 'utf8');
  return _marketingMdCache;
}

// ── Response helper ──────────────────────────────────────────
function jsonResponse(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
}

// ── Raw body reader (CB3) ────────────────────────────────────
// Returns the body as a UTF-8 string for HMAC verification.
// Throws if the body exceeds MAX_BODY_BYTES (defends against
// memory exhaustion).
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
// signed = httpMethod + requestUrl + requestBody + timestamp
// key    = clientSecret (SALES_AGENT_TOKEN)
// out    = base64(HMAC-SHA256(signed, key))
//
// HubSpot signs the FULL absolute URL including protocol + host.
// Vercel forwards the original host via x-forwarded-host /
// x-forwarded-proto. Reconstruct the URL using those headers
// rather than req.headers.host to survive any internal hop.
function verifyHubspotSignature(req, rawBody, secret) {
  const sig = req.headers['x-hubspot-signature-v3'];
  const ts = req.headers['x-hubspot-request-timestamp'];
  if (typeof sig !== 'string' || typeof ts !== 'string') return false;

  // Replay protection.
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

  // Timing-safe compare (lengths must match).
  if (sig.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch (_) {
    return false;
  }
}

// ── HubSpot: fetch contact properties (CB1) ──────────────────
// The webhook payload contains objectId only. We fetch the
// properties we need to classify and personalise. If the fetch
// fails, we propagate — the handler logs and skips that event.
async function fetchContact(contactId, token) {
  const props = ['firstname', 'lastname', 'email', 'company', 'message', 'lead_source', 'funding_stage', 'course_interest'];
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
// 1) GET /crm/v4/associations/contacts/notes/{contactId}
//    → returns the list of associated note IDs.
// 2) For each note ID, GET /crm/v3/objects/notes/{id}?properties=hs_note_body
//    → check the body for SALES_AGENT_MARKER.
// Returns true if a prior agent Note exists.
async function hasPriorAgentNote(contactId, token) {
  const assocUrl = `https://api.hubapi.com/crm/v4/associations/contacts/notes/${encodeURIComponent(contactId)}`;
  const assocRes = await fetch(assocUrl, {
    headers: { Authorization: 'Bearer ' + token }
  });
  if (assocRes.status === 404) return false; // no associations yet
  if (!assocRes.ok) {
    const err = new Error('hubspot_assoc_failed: ' + assocRes.status);
    err.status = assocRes.status;
    throw err;
  }
  const assocData = await assocRes.json().catch(() => ({}));
  const noteIds = (assocData.results || []).map(r => r.toObjectId).filter(Boolean);
  if (noteIds.length === 0) return false;

  // Fetch each note body. Sequential to keep request budget low.
  for (const noteId of noteIds) {
    const noteRes = await fetch(
      `https://api.hubapi.com/crm/v3/objects/notes/${encodeURIComponent(noteId)}?properties=hs_note_body`,
      { headers: { Authorization: 'Bearer ' + token } }
    );
    if (!noteRes.ok) continue; // skip notes we can't read
    const note = await noteRes.json().catch(() => ({}));
    const body = (note.properties && note.properties.hs_note_body) || '';
    if (body.includes(SALES_AGENT_MARKER)) return true;
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
        // See https://developers.hubspot.com/docs/api/crm/associations
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

// ── Claude API call ──────────────────────────────────────────
// System prompt = MARKETING.md (+ optional PRICING_NOTES).
// User content wraps lead fields in <lead_data> XML tags to
// structurally isolate user-supplied content from instructions
// (prompt injection mitigation, T14).
//
// Prompt caching: MARKETING.md is stable across requests, so we
// mark it cache_control: ephemeral. 5-minute TTL — consecutive
// webhook firings within 5 minutes get a cache hit.
async function callClaude(properties) {
  const marketingMd = loadMarketingMd();
  const pricingNotes = process.env.PRICING_NOTES;
  const systemText = pricingNotes
    ? `${marketingMd}\n\n## Pricing Notes (Private — do not quote prices directly)\n\n${pricingNotes}`
    : marketingMd;

  // XML-tagged user content (T14). The tag wrap is what makes
  // injection attempts in `message` show up as quoted user input
  // rather than as instructions the model executes.
  const firstname = properties.firstname || '';
  const company = properties.company || '';
  const email = properties.email || '';
  const message = properties.message || '';
  const leadSource = properties.lead_source || '';
  const fundingStage = properties.funding_stage || '';

  const userMessage = [
    '<lead_data>',
    `<firstname>${escapeXml(firstname)}</firstname>`,
    `<company>${escapeXml(company)}</company>`,
    `<email>${escapeXml(email)}</email>`,
    `<lead_source>${escapeXml(leadSource)}</lead_source>`,
    `<funding_stage>${escapeXml(fundingStage)}</funding_stage>`,
    `<message>${escapeXml(message)}</message>`,
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

  const res = await fetch(CLAUDE_API, {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': CLAUDE_VERSION,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      system: [
        {
          type: 'text',
          text: systemText,
          cache_control: { type: 'ephemeral' }
        }
      ],
      messages: [{ role: 'user', content: userMessage }]
    })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error('claude_call_failed: ' + res.status);
    err.status = res.status;
    err.body = text;
    throw err;
  }

  const data = await res.json();
  const textBlock = (data.content || []).find(b => b.type === 'text');
  const responseText = textBlock ? textBlock.text : '';
  return responseText;
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ── Parse Claude response with bounded fallback (T15) ────────
// If Claude returns valid JSON, return the parsed shape.
// If it returns prose or malformed JSON, return a bounded
// fallback: use the raw text as email_draft, icp=unknown,
// urgency=3. The Note still gets written so Nick sees the lead.
function parseClaudeResponse(text) {
  if (!text || !text.trim()) {
    return { ok: false, reason: 'empty_response' };
  }
  // Strip common markdown JSON fences if Claude added them.
  const stripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(stripped);
    if (
      typeof parsed === 'object' &&
      parsed &&
      typeof parsed.icp === 'string' &&
      typeof parsed.urgency === 'number' &&
      typeof parsed.email_draft === 'string'
    ) {
      return { ok: true, value: parsed };
    }
  } catch (_) { /* fall through to fallback */ }

  return {
    ok: false,
    reason: 'unparseable',
    fallback: {
      icp: 'unknown',
      urgency: 3,
      email_draft: text.slice(0, 1500)
    }
  };
}

// ── Format the Note body Nick reads in HubSpot ───────────────
function formatNoteBody({ icp, urgency, email_draft, error }) {
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

// ── Process one webhook event ────────────────────────────────
// Returns an outcome string for the response counter:
//   'processed' — Note created
//   'skipped_filter' — lead_source not in allowlist
//   'skipped_dupe' — prior Note exists
//   'error' — something failed; we logged it
async function processEvent(event, hubspotToken) {
  const contactId = event.objectId;
  if (!contactId) return 'skipped_no_id';

  // CB2: contact.propertyChange events can arrive for any property
  // we subscribed to. Defence in depth — also check propertyName
  // matches lead_source when present, even though HubSpot's
  // subscription should already filter.
  if (
    event.subscriptionType === 'contact.propertyChange' &&
    event.propertyName &&
    event.propertyName !== 'lead_source'
  ) {
    return 'skipped_wrong_property';
  }

  // CB1: fetch contact properties (webhook doesn't include them).
  let contact;
  try {
    contact = await fetchContact(contactId, hubspotToken);
  } catch (err) {
    console.error('[/api/sales-agent] fetch_contact_failed', contactId, err.status, err.body);
    return 'error';
  }

  const props = contact.properties || {};
  const leadSource = props.lead_source;

  if (!leadSource || !ALLOWED_LEAD_SOURCES.has(leadSource)) {
    return 'skipped_filter';
  }

  // CB5: idempotency before doing any expensive work.
  let prior;
  try {
    prior = await hasPriorAgentNote(contactId, hubspotToken);
  } catch (err) {
    console.error('[/api/sales-agent] idempotency_check_failed', contactId, err.status);
    // Be defensive — if we can't tell, prefer skipping over
    // duplicating. A missed lead is better than 5 duplicate notes.
    return 'error';
  }
  if (prior) return 'skipped_dupe';

  // Call Claude. On failure, write a Note recording the error so
  // Nick sees the lead even if the agent couldn't draft.
  let responseText;
  try {
    responseText = await callClaude(props);
  } catch (err) {
    console.error('[/api/sales-agent] claude_call_failed', contactId, err.status, err.body);
    try {
      await createNote(contactId, formatNoteBody({ error: 'Claude API call failed (' + (err.status || 'unknown') + ')' }), hubspotToken);
    } catch (noteErr) {
      console.error('[/api/sales-agent] error_note_write_failed', contactId, noteErr.status);
    }
    return 'error';
  }

  // T11: handle empty/unparseable Claude response explicitly.
  const parsed = parseClaudeResponse(responseText);
  let noteBody;
  if (parsed.ok) {
    noteBody = formatNoteBody(parsed.value);
  } else if (parsed.reason === 'empty_response') {
    noteBody = formatNoteBody({ error: 'Claude returned no response.' });
  } else {
    // Bounded fallback — still ship Nick something useful.
    noteBody = formatNoteBody(parsed.fallback);
  }

  try {
    await createNote(contactId, noteBody, hubspotToken);
  } catch (err) {
    console.error('[/api/sales-agent] note_create_failed', contactId, err.status, err.body);
    return 'error';
  }

  return 'processed';
}

// ── Handler ──────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  const startedAt = Date.now(); // T16: timing log

  if (req.method !== 'POST') {
    return jsonResponse(res, 405, { ok: false, error: 'method_not_allowed' });
  }

  const hubspotToken = process.env.HUBSPOT_TOKEN;
  const agentToken = process.env.SALES_AGENT_TOKEN;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!hubspotToken || !agentToken || !anthropicKey) {
    console.error('[/api/sales-agent] missing env var(s)', {
      hubspot: !!hubspotToken,
      sales_agent: !!agentToken,
      anthropic: !!anthropicKey
    });
    return jsonResponse(res, 500, { ok: false, error: 'server_misconfigured' });
  }

  // Read raw body once. HMAC needs the exact bytes HubSpot signed.
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

  // Parse events. HubSpot delivers an array; defensive handling
  // for a single-object payload just in case.
  let events;
  try {
    const parsed = JSON.parse(rawBody);
    events = Array.isArray(parsed) ? parsed : [parsed];
  } catch (err) {
    console.error('[/api/sales-agent] invalid_json', err);
    return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
  }

  // Sequential processing — webhooks usually carry 1-5 events and
  // Claude latency dominates. Parallelising would only matter on
  // large batch deliveries which HubSpot rarely sends.
  const counts = { processed: 0, skipped_filter: 0, skipped_dupe: 0, skipped_other: 0, error: 0 };
  for (const event of events) {
    const outcome = await processEvent(event, hubspotToken);
    if (outcome === 'processed') counts.processed++;
    else if (outcome === 'skipped_filter') counts.skipped_filter++;
    else if (outcome === 'skipped_dupe') counts.skipped_dupe++;
    else if (outcome === 'error') counts.error++;
    else counts.skipped_other++;
  }

  // T16: timing log. HubSpot webhook timeout is 20s; warn at 15s.
  const elapsed = Date.now() - startedAt;
  if (elapsed > 15000) {
    console.warn('[/api/sales-agent] slow_request', { elapsed_ms: elapsed, events: events.length });
  }
  console.log('[/api/sales-agent] done', { elapsed_ms: elapsed, ...counts });

  // Always return 200 on processed payloads (even with internal
  // errors) so HubSpot doesn't retry. We've already logged the
  // errors and, where possible, written error Notes.
  return jsonResponse(res, 200, { ok: true, ...counts });
};

// Vercel function config — set AFTER the handler assignment so
// it doesn't get wiped by `module.exports = handler`.
//   - bodyParser: false so we can read the raw bytes for HMAC.
//   - maxDuration: 60 (Pro plan). HubSpot webhook timeout is 20s
//     so the Claude call must complete inside that. Timing logs
//     above alert if we creep above 15s.
module.exports.config = {
  api: { bodyParser: false },
  maxDuration: 60
};
