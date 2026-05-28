/* ============================================================
   /api/rate-card — Vercel Serverless Function backing the
   AI Brain rate card download modal.

   Why this exists:
   Previously the rate card modal POSTed to Formspree
   (formspree.io/f/xpqydglp), which meant rate card downloads
   never landed in HubSpot. The downstream sales agent filters
   for `lead_source = "ai_brain_rate_card"` to action these as
   high-intent leads — that filter was dead config until this
   endpoint was wired up. This function bypasses Formspree and
   writes the contact straight to the HubSpot Contacts API
   (same pattern as /api/book and /api/prompts), stamping the
   `lead_source` property so the agent picks it up.

   Environment:
     HUBSPOT_TOKEN  — HubSpot Private App access token with
                      scopes: crm.objects.contacts.write +
                      crm.objects.contacts.read. Same one
                      /api/book + /api/prompts use. Set in
                      Vercel project env vars.

   Contract:
     POST /api/rate-card
       Content-Type: application/json
       Body: { name, email, company?, _gotcha? }
     Response:
       200 { ok: true, contactId?: string, updated?: boolean }
       400 { ok: false, error: 'validation_error', fields: [...] }
       405 { ok: false, error: 'method_not_allowed' }
       502 { ok: false, error: 'hubspot_error', status: <code> }
       500 { ok: false, error: 'server_misconfigured' | 'server_error' }

   Lead source significance:
     `lead_source: "ai_brain_rate_card"` is the canonical tag
     the sales-triage agent uses to surface rate card downloads
     in its NEW lead queue. Do NOT change this string without
     updating the agent filter in lockstep.

   Bot/abuse posture:
     - Honeypot: non-empty `_gotcha` returns 200 silently
       without writing anything (UI parity with humans).
     - No GDPR consent checkbox: a rate card download is a
       transactional / legitimate-interest interaction, not
       marketing opt-in. Adjust if legal stance changes.
     - HubSpot portal-level rate limits are the backstop.
   ============================================================ */

const REQUIRED_FIELDS = ['name', 'email'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function jsonResponse(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
}

function validate(body) {
  const errors = [];
  if (!body || typeof body !== 'object') {
    errors.push('body');
    return errors;
  }
  for (const f of REQUIRED_FIELDS) {
    if (typeof body[f] !== 'string' || !body[f].trim()) {
      errors.push(f);
    }
  }
  if (body.email && !EMAIL_RE.test(body.email)) {
    if (!errors.includes('email')) errors.push('email');
  }
  if (typeof body.name === 'string' && body.name.length > 200) {
    errors.push('name_too_long');
  }
  return errors;
}

async function upsertContact(token, fields) {
  const url = 'https://api.hubapi.com/crm/v3/objects/contacts';
  const stamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const noteLine = `Downloaded AI Brain rate card (${stamp})`;

  const properties = {
    firstname: fields.name,
    email: fields.email,
    message: noteLine,
    // CRITICAL: sales-triage agent filters on this exact string.
    lead_source: 'ai_brain_rate_card',
    hs_lead_status: 'NEW',
    hs_analytics_source: 'OFFLINE',
    lifecyclestage: 'lead'
  };
  if (fields.company) properties.company = fields.company;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    body: JSON.stringify({ properties })
  });

  // 409 = contact exists → PATCH instead, appending the download
  // line to the message field rather than overwriting (preserves
  // any prior history from /api/book, /api/prompts, etc).
  if (res.status === 409) {
    const data = await res.json().catch(() => ({}));
    const existingId = data && data.message && (data.message.match(/Existing ID: (\d+)/) || [])[1];
    if (existingId) {
      // Fetch existing message so we don't trample prior content.
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

      const patchProperties = {
        firstname: fields.name,
        message: newMessage,
        lead_source: 'ai_brain_rate_card',
        hs_lead_status: 'NEW'
      };
      if (fields.company) patchProperties.company = fields.company;

      const updateRes = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${existingId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({ properties: patchProperties })
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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return jsonResponse(res, 405, { ok: false, error: 'method_not_allowed' });
  }

  const token = process.env.HUBSPOT_TOKEN;
  if (!token) {
    console.error('[/api/rate-card] HUBSPOT_TOKEN env var missing');
    return jsonResponse(res, 500, { ok: false, error: 'server_misconfigured' });
  }

  let body = req.body;
  // Vercel auto-parses JSON when Content-Type is application/json, but
  // be defensive in case it arrives as a string.
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) {
      return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
    }
  }
  body = body || {};

  // Honeypot — return success silently without writing anything.
  if (typeof body._gotcha === 'string' && body._gotcha.trim()) {
    return jsonResponse(res, 200, { ok: true, bot: true });
  }

  const errors = validate(body);
  if (errors.length > 0) {
    return jsonResponse(res, 400, { ok: false, error: 'validation_error', fields: errors });
  }

  try {
    const result = await upsertContact(token, {
      name: body.name.trim(),
      email: body.email.trim().toLowerCase(),
      company: typeof body.company === 'string' && body.company.trim()
        ? body.company.trim()
        : undefined
    });
    return jsonResponse(res, 200, { ok: true, contactId: result.id, updated: result.updated });
  } catch (err) {
    console.error('[/api/rate-card] HubSpot error', err.status, err.body);
    return jsonResponse(res, 502, { ok: false, error: 'hubspot_error', status: err.status || 0 });
  }
};

module.exports.config = { maxDuration: 30 };
