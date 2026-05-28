/* ============================================================
   /api/waitlist — Vercel Serverless Function for the course
   pre-launch waitlist capture form on /course.

   Mirrors the pattern in /api/book and /api/prompts: bypass
   HubSpot Forms, write contacts straight to the HubSpot Contacts
   API using a Private App access token. Sets the attribution
   properties the downstream sales agent filters on
   (`lead_source = "course_waitlist"`, `course_interest = true`).

   Environment:
     HUBSPOT_TOKEN — HubSpot Private App access token. Same one
                     /api/book + /api/prompts use. Scopes:
                     crm.objects.contacts.write + .read
                     Set in Vercel project env vars.

     Custom HubSpot contact properties expected to exist
     (created out-of-band by Nick, per CEO plan H3):
       - course_interest (boolean)
       - lead_source     (string)

   Contract:
     POST /api/waitlist
       Content-Type: application/json
       Body: { name, email, company?, consent, _gotcha? }
       Response:
         200 { ok: true, contactId?: string }
         400 { ok: false, error: 'validation_error', fields: [...] }
         400 { ok: false, error: 'consent_required' }
         400 { ok: false, error: 'invalid_json' }
         405 { ok: false, error: 'method_not_allowed' }
         500 { ok: false, error: 'server_misconfigured' }
         502 { ok: false, error: 'hubspot_error', status }

   GDPR / lawful basis:
     - `consent` MUST be true (explicit opt-in tick on the course
       waitlist form). The endpoint refuses to write to HubSpot
       without it. This is the only gate — there is no separate
       legitimate-interest path.

   Bot/abuse posture:
     - Honeypot: non-empty `_gotcha` returns 200 silently without
       writing to HubSpot. Bots and humans see identical responses.
     - No rate limit at this layer in v1 (deferred per TODOS.md +
       CEO plan Reviewer Concern #7). HubSpot's portal-level rate
       limits are the backstop. Ad traffic to /course could justify
       Vercel Edge Middleware IP throttling as a follow-up.
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
  if (typeof body.company === 'string' && body.company.length > 200) {
    errors.push('company_too_long');
  }
  return errors;
}

async function upsertContact(token, fields) {
  const url = 'https://api.hubapi.com/crm/v3/objects/contacts';

  // Split the supplied name into first/last on the first space so
  // HubSpot displays sensibly. Single-token names fall back to
  // firstname-only — better than dropping the value entirely.
  const trimmedName = fields.name;
  const spaceIdx = trimmedName.indexOf(' ');
  const firstname = spaceIdx === -1 ? trimmedName : trimmedName.slice(0, spaceIdx);
  const lastname = spaceIdx === -1 ? '' : trimmedName.slice(spaceIdx + 1).trim();

  const properties = {
    firstname,
    email: fields.email,
    // CRITICAL: the sales agent filters on lead_source. Do not
    // change this string without updating api/sales-agent.js.
    lead_source: 'course_waitlist',
    course_interest: true,
    hs_lead_status: 'NEW',
    hs_analytics_source: 'OFFLINE',
    lifecyclestage: 'lead'
  };
  if (lastname) properties.lastname = lastname;
  if (fields.company) properties.company = fields.company;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    body: JSON.stringify({ properties })
  });

  // 409 = email already exists → PATCH the existing contact so
  // course_interest + lead_source are set even on re-submits.
  // Overwrite (not append) — waitlist is a flag, not a journal.
  if (res.status === 409) {
    const data = await res.json().catch(() => ({}));
    const existingId = data && data.message && (data.message.match(/Existing ID: (\d+)/) || [])[1];
    if (existingId) {
      const updateProps = {
        firstname,
        lead_source: 'course_waitlist',
        course_interest: true,
        hs_lead_status: 'NEW'
      };
      if (lastname) updateProps.lastname = lastname;
      if (fields.company) updateProps.company = fields.company;

      const updateRes = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${existingId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({ properties: updateProps })
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
    console.error('[/api/waitlist] HUBSPOT_TOKEN env var missing');
    return jsonResponse(res, 500, { ok: false, error: 'server_misconfigured' });
  }

  let body = req.body;
  // Vercel auto-parses JSON when Content-Type is application/json,
  // but be defensive in case it arrives as a string.
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) {
      return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
    }
  }
  body = body || {};

  // Honeypot — return success silently without writing anything.
  // Bots see the same 200 humans see.
  if (typeof body._gotcha === 'string' && body._gotcha.trim()) {
    return jsonResponse(res, 200, { ok: true, bot: true });
  }

  // GDPR consent gate — explicit opt-in required before any
  // HubSpot write. Course waitlist triggers a nurture sequence;
  // we will not enrol anyone who did not tick the box.
  if (body.consent !== true) {
    return jsonResponse(res, 400, { ok: false, error: 'consent_required' });
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
    console.error('[/api/waitlist] HubSpot error', err.status, err.body);
    return jsonResponse(res, 502, { ok: false, error: 'hubspot_error', status: err.status || 0 });
  }
};

module.exports.config = { maxDuration: 30 };
