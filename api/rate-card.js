/* ============================================================
   /api/rate-card — Vercel Serverless Function backing the
   AI Brain rate card request modal on /ai-brain.

   Mirrors /api/book — writes the lead straight to HubSpot's
   Contacts API via a Private App token, with create→PATCH
   upsert on 409.

   Environment:
     HUBSPOT_TOKEN  — HubSpot Private App access token with
                      crm.objects.contacts.write +
                      crm.objects.contacts.read

   Contract:
     POST /api/rate-card
       Content-Type: application/json
       Body: { name, email, company?, _gotcha? }
     Response:
       200 { ok: true, contactId?: string }
       400 { ok: false, error: 'validation_error', fields: [...] }
       502 { ok: false, error: 'hubspot_error', status: <code> }
       500 { ok: false, error: 'server_error' }
   ============================================================ */

const REQUIRED_FIELDS = ['name', 'email'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LEAD_SOURCE = 'ai-brain-rate-card';

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
  if (typeof body.company === 'string' && body.company.length > 200) {
    errors.push('company_too_long');
  }
  return errors;
}

async function upsertContact(token, fields) {
  const url = 'https://api.hubapi.com/crm/v3/objects/contacts';
  const properties = {
    firstname: fields.name,
    email: fields.email,
    lead_source: LEAD_SOURCE,
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

  // 409 = email already exists → update existing contact instead of bailing.
  if (res.status === 409) {
    const data = await res.json().catch(() => ({}));
    const existingId = data && data.message && (data.message.match(/Existing ID: (\d+)/) || [])[1];
    if (existingId) {
      const patchProps = {
        firstname: fields.name,
        lead_source: LEAD_SOURCE
      };
      if (fields.company) patchProps.company = fields.company;
      const updateRes = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${existingId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({ properties: patchProps })
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
      company: typeof body.company === 'string' ? body.company.trim() : ''
    });
    return jsonResponse(res, 200, { ok: true, contactId: result.id, updated: result.updated });
  } catch (err) {
    console.error('[/api/rate-card] HubSpot error', err.status, err.body);
    return jsonResponse(res, 502, { ok: false, error: 'hubspot_error', status: err.status || 0 });
  }
};
