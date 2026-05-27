/* ============================================================
   /api/prompts — Vercel Serverless Function for the AI Brain
   Prompt Library gate.

   Mirrors the pattern in /api/book: bypass HubSpot Forms, write
   contacts straight to the HubSpot Contacts API using a Private
   App access token. Also issues + verifies an HMAC-signed access
   token so the prompts content is genuinely gated (the static
   /ai-brain/prompts/ page is a shell; content is served from
   this endpoint and only returned to clients with a valid token).

   Environment:
     HUBSPOT_TOKEN   — HubSpot Private App access token. Same one
                       /api/book uses. Scopes:
                       crm.objects.contacts.write + .read
     PROMPTS_SECRET  — Random string (>=32 chars) used to sign
                       access tokens. Generate with:
                       openssl rand -hex 32

   Contract:

     POST /api/prompts
       Content-Type: application/json
       Body: { name, email, _gotcha? }
       Response:
         200 { ok: true, token, sections, prompts }
         400 { ok: false, error: 'validation_error', fields: [...] }
         502 { ok: false, error: 'hubspot_error', status }
         500 { ok: false, error: 'server_error' | 'server_misconfigured' }

     GET /api/prompts?token=<t>
       Used by the prompts page to re-fetch content on revisit
       (no re-capture required if the token is still valid).
       Response:
         200 { ok: true, sections, prompts }
         401 { ok: false, error: 'invalid_token' | 'expired_token' }

   Token format:
     base64url(payload).base64url(sig)
     payload = JSON({ e: email, i: iat, x: exp })
     sig     = HMAC-SHA256(payload, PROMPTS_SECRET)

   Token lifetime: 30 days. Renewed automatically when a contact
   re-submits the form.

   Bot/abuse posture:
     - Honeypot: non-empty `_gotcha` returns 200 + token silently.
     - HubSpot portal-level rate limits are the backstop. Add edge
       rate limiting if abuse appears.
   ============================================================ */

const crypto = require('crypto');
const { SECTIONS, PROMPTS } = require('./prompts-data');

const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const REQUIRED_FIELDS = ['name', 'email'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function jsonResponse(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

function issueToken(secret, email) {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + TOKEN_TTL_SECONDS;
  const payload = JSON.stringify({ e: email.toLowerCase(), i: iat, x: exp });
  const payloadB64 = b64url(payload);
  const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest();
  return `${payloadB64}.${b64url(sig)}`;
}

function verifyToken(secret, token) {
  if (typeof token !== 'string' || !token.includes('.')) return { ok: false, error: 'invalid_token' };
  const [payloadB64, sigB64] = token.split('.', 2);
  if (!payloadB64 || !sigB64) return { ok: false, error: 'invalid_token' };

  const expected = crypto.createHmac('sha256', secret).update(payloadB64).digest();
  let provided;
  try {
    provided = b64urlDecode(sigB64);
  } catch (_) {
    return { ok: false, error: 'invalid_token' };
  }
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return { ok: false, error: 'invalid_token' };
  }

  let payload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8'));
  } catch (_) {
    return { ok: false, error: 'invalid_token' };
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.x !== 'number' || payload.x < now) {
    return { ok: false, error: 'expired_token' };
  }
  return { ok: true, email: payload.e };
}

function validatePost(body) {
  const errors = [];
  if (!body || typeof body !== 'object') {
    errors.push('body');
    return errors;
  }
  for (const f of REQUIRED_FIELDS) {
    if (typeof body[f] !== 'string' || !body[f].trim()) errors.push(f);
  }
  if (body.email && !EMAIL_RE.test(body.email)) {
    if (!errors.includes('email')) errors.push('email');
  }
  if (typeof body.name === 'string' && body.name.length > 200) errors.push('name_too_long');
  return errors;
}

async function upsertContact(token, fields) {
  const url = 'https://api.hubapi.com/crm/v3/objects/contacts';
  const stamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const noteLine = `Downloaded AI Brain Prompt Library (${stamp})`;
  const payload = {
    properties: {
      firstname: fields.name,
      email: fields.email,
      message: noteLine,
      // Sales agent (/api/sales-agent) filters incoming HubSpot webhooks
      // on lead_source — without this, prompt library leads never trigger
      // the agent's personalised follow-up.
      lead_source: 'prompt_library',
      hs_lead_status: 'NEW',
      hs_analytics_source: 'OFFLINE',
      lifecyclestage: 'lead'
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify(payload)
  });

  // 409 = contact exists → PATCH instead, appending the download line
  // to the message field rather than overwriting.
  if (res.status === 409) {
    const data = await res.json().catch(() => ({}));
    const existingId = data && data.message && (data.message.match(/Existing ID: (\d+)/) || [])[1];
    if (existingId) {
      // Fetch existing message so we don't trample any prior content
      let existingMessage = '';
      try {
        const getRes = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${existingId}?properties=message`, {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        if (getRes.ok) {
          const j = await getRes.json();
          existingMessage = (j.properties && j.properties.message) || '';
        }
      } catch (_) { /* non-fatal */ }

      const newMessage = existingMessage
        ? `${existingMessage}\n${noteLine}`.slice(-4000) // soft cap
        : noteLine;

      const updateRes = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${existingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({
          properties: {
            firstname: fields.name,
            message: newMessage,
            hs_lead_status: 'NEW'
          }
        })
      });
      if (!updateRes.ok) {
        const text = await updateRes.text().catch(() => '');
        const err = new Error('HubSpot update failed: ' + updateRes.status);
        err.status = updateRes.status;
        err.body = text;
        throw err;
      }
      return { id: existingId, updated: true };
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error('HubSpot create failed: ' + res.status);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  return { id: data.id, updated: false };
}

function libraryPayload() {
  return { sections: SECTIONS, prompts: PROMPTS };
}

module.exports = async function handler(req, res) {
  const promptsSecret = process.env.PROMPTS_SECRET;
  if (!promptsSecret || promptsSecret.length < 32) {
    console.error('[/api/prompts] PROMPTS_SECRET env var missing or too short (needs >=32 chars)');
    return jsonResponse(res, 500, { ok: false, error: 'server_misconfigured' });
  }

  // ── GET: verify token + return library content ───────────
  if (req.method === 'GET') {
    const token = (req.query && req.query.token) || '';
    const result = verifyToken(promptsSecret, token);
    if (!result.ok) {
      return jsonResponse(res, 401, { ok: false, error: result.error });
    }
    return jsonResponse(res, 200, { ok: true, ...libraryPayload() });
  }

  // ── POST: capture + issue token + return content ─────────
  if (req.method !== 'POST') {
    return jsonResponse(res, 405, { ok: false, error: 'method_not_allowed' });
  }

  const hubspotToken = process.env.HUBSPOT_TOKEN;
  if (!hubspotToken) {
    console.error('[/api/prompts] HUBSPOT_TOKEN env var missing');
    return jsonResponse(res, 500, { ok: false, error: 'server_misconfigured' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) {
      return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
    }
  }
  body = body || {};

  // Honeypot — return success silently. We still issue a token so
  // bot-driven UIs look identical to human ones, but skip the
  // HubSpot write.
  if (typeof body._gotcha === 'string' && body._gotcha.trim()) {
    const t = issueToken(promptsSecret, 'bot@noop.local');
    return jsonResponse(res, 200, { ok: true, token: t, ...libraryPayload(), bot: true });
  }

  const errors = validatePost(body);
  if (errors.length > 0) {
    return jsonResponse(res, 400, { ok: false, error: 'validation_error', fields: errors });
  }

  const email = body.email.trim().toLowerCase();
  const name = body.name.trim();

  try {
    await upsertContact(hubspotToken, { name, email });
  } catch (err) {
    console.error('[/api/prompts] HubSpot error', err.status, err.body);
    return jsonResponse(res, 502, { ok: false, error: 'hubspot_error', status: err.status || 0 });
  }

  const accessToken = issueToken(promptsSecret, email);
  return jsonResponse(res, 200, { ok: true, token: accessToken, ...libraryPayload() });
};
