/* ============================================================
   /api/book — Vercel Serverless Function backing the /book brief form.

   Why this exists:
   We tried HubSpot's Forms Submission API first (api.hsforms.com/.../v3/
   integrations/submit/...) but HubSpot's newer "Form Frame" forms don't
   expose that endpoint — every request returned 404. This function
   bypasses HubSpot Forms entirely and writes the contact straight to the
   Contacts API using a Private App access token.

   Environment:
     HUBSPOT_TOKEN  — HubSpot Private App access token with scopes:
                      crm.objects.contacts.write + crm.objects.contacts.read
                      Set in Vercel project env vars.

   Contract:
     POST /api/book
       Content-Type: application/json
       Body: { name, email, company, stage, situation, _gotcha? }
     Response:
       200 { ok: true, contactId?: string }
       400 { ok: false, error: 'validation_error', fields: [...] }
       502 { ok: false, error: 'hubspot_error', status: <code> }
       500 { ok: false, error: 'server_error' }

   Bot/abuse posture:
     - Honeypot: a non-empty `_gotcha` field returns 200 silently without
       writing anything (matches the in-browser honeypot behaviour so bots
       and humans get identical UI).
     - No rate limit at this layer in v1; HubSpot's portal-level rate
       limits are the backstop. Add edge rate limiting if abuse appears.
   ============================================================ */

const REQUIRED_FIELDS = ['name', 'email', 'company', 'stage', 'situation'];
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
  // Soft caps so we never push novellas into the CRM.
  if (typeof body.situation === 'string' && body.situation.length > 4000) {
    errors.push('situation_too_long');
  }
  if (typeof body.name === 'string' && body.name.length > 200) {
    errors.push('name_too_long');
  }
  return errors;
}

async function upsertContact(token, fields) {
  const url = 'https://api.hubapi.com/crm/v3/objects/contacts';
  const payload = {
    properties: {
      firstname: fields.name,
      email: fields.email,
      company: fields.company,
      message: fields.situation,
      // Custom property created in HubSpot — dropdown:
      //   Pre-seed / Seed / Series A / Scale-up / Other
      funding_stage: fields.stage,
      // Sales agent (/api/sales-agent) filters HubSpot webhooks on
      // lead_source. /book is the highest-intent channel — adding
      // cto_services here means form-fill-but-no-call leads get a
      // personalised follow-up draft via the agent.
      lead_source: 'cto_services',
      // Source attribution so it's clear in CRM where the lead came from.
      hs_lead_status: 'NEW',
      hs_analytics_source: 'OFFLINE',
      lifecyclestage: 'lead'
    }
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    body: JSON.stringify(payload)
  });

  // 409 = email already exists → update existing contact instead of bailing.
  if (res.status === 409) {
    const data = await res.json().catch(() => ({}));
    const existingId = data && data.message && (data.message.match(/Existing ID: (\d+)/) || [])[1];
    if (existingId) {
      const updateRes = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${existingId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({
          properties: {
            firstname: fields.name,
            company: fields.company,
            funding_stage: fields.stage,
            message: fields.situation
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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return jsonResponse(res, 405, { ok: false, error: 'method_not_allowed' });
  }

  const token = process.env.HUBSPOT_TOKEN;
  if (!token) {
    console.error('[/api/book] HUBSPOT_TOKEN env var missing');
    return jsonResponse(res, 500, { ok: false, error: 'server_misconfigured' });
  }

  let body = req.body;
  // Vercel auto-parses JSON when Content-Type is application/json, but
  // be defensive in case it arrives as a string.
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) {
      return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
    }
  }
  body = body || {};

  // Honeypot — return success without writing anything.
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
      company: body.company.trim(),
      stage: body.stage.trim(),
      situation: body.situation.trim()
    });
    return jsonResponse(res, 200, { ok: true, contactId: result.id, updated: result.updated });
  } catch (err) {
    console.error('[/api/book] HubSpot error', err.status, err.body);
    return jsonResponse(res, 502, { ok: false, error: 'hubspot_error', status: err.status || 0 });
  }
};
