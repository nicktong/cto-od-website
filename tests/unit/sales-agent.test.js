// Unit tests for api/sales-agent.js — pure helpers, dispatch, HMAC, idempotency.
// Run with: npm run test:unit
//
// Covers critical paths #1, #2, #3, #4, #5 from the eng-review S3-1 scope:
//  1. HMAC v3 verification — correct, wrong sig, missing headers, replay window
//  2. course_status event filter via dispatch
//  3. [sprint-pipeline-v1] marker idempotency (parameterized marker)
//  4. GitHub Contents API 404 (repo deleted)
//  5. GitHub Contents API 403 (PAT expired/revoked)

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const agent = require('../../api/sales-agent.js');
const t = agent.__test;

// ── HMAC v3 verification ─────────────────────────────────────

function buildSignedRequest({ secret, method = 'POST', url = 'https://www.ctoondemand.co.uk/api/sales-agent', body = '[]', timestampOffsetMs = 0 }) {
  const ts = String(Date.now() + timestampOffsetMs);
  const signed = method + url + body + ts;
  const sig = crypto.createHmac('sha256', secret).update(signed, 'utf8').digest('base64');
  return {
    method,
    url: '/api/sales-agent',
    headers: {
      'x-hubspot-signature-v3': sig,
      'x-hubspot-request-timestamp': ts,
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'www.ctoondemand.co.uk'
    },
    rawBody: body
  };
}

test('HMAC: valid signature passes', () => {
  const req = buildSignedRequest({ secret: 's3cret' });
  assert.equal(t.verifyHubspotSignature(req, req.rawBody, 's3cret'), true);
});

test('HMAC: wrong secret fails', () => {
  const req = buildSignedRequest({ secret: 's3cret' });
  assert.equal(t.verifyHubspotSignature(req, req.rawBody, 'wrong-secret'), false);
});

test('HMAC: mutated body fails', () => {
  const req = buildSignedRequest({ secret: 's3cret', body: '[]' });
  // Mutate the body after signing — signature should no longer verify
  assert.equal(t.verifyHubspotSignature(req, '[{"hacked":true}]', 's3cret'), false);
});

test('HMAC: missing signature header fails', () => {
  const req = buildSignedRequest({ secret: 's3cret' });
  delete req.headers['x-hubspot-signature-v3'];
  assert.equal(t.verifyHubspotSignature(req, req.rawBody, 's3cret'), false);
});

test('HMAC: missing timestamp header fails', () => {
  const req = buildSignedRequest({ secret: 's3cret' });
  delete req.headers['x-hubspot-request-timestamp'];
  assert.equal(t.verifyHubspotSignature(req, req.rawBody, 's3cret'), false);
});

test('HMAC: replay window — old timestamp (>5min) fails', () => {
  const req = buildSignedRequest({ secret: 's3cret', timestampOffsetMs: -(6 * 60 * 1000) });
  assert.equal(t.verifyHubspotSignature(req, req.rawBody, 's3cret'), false);
});

test('HMAC: replay window — future timestamp beyond window fails', () => {
  const req = buildSignedRequest({ secret: 's3cret', timestampOffsetMs: 6 * 60 * 1000 });
  assert.equal(t.verifyHubspotSignature(req, req.rawBody, 's3cret'), false);
});

test('HMAC: non-numeric timestamp fails', () => {
  const req = buildSignedRequest({ secret: 's3cret' });
  req.headers['x-hubspot-request-timestamp'] = 'not-a-number';
  assert.equal(t.verifyHubspotSignature(req, req.rawBody, 's3cret'), false);
});

// ── Dispatch routing (course_status filter) ──────────────────

test('dispatch: contact.creation routes to lead_qualification', () => {
  assert.equal(t.dispatch({ subscriptionType: 'contact.creation' }), 'lead_qualification');
});

test('dispatch: propertyChange on lead_source routes to lead_qualification', () => {
  assert.equal(
    t.dispatch({ subscriptionType: 'contact.propertyChange', propertyName: 'lead_source' }),
    'lead_qualification'
  );
});

test('dispatch: propertyChange on course_status routes to sprint_pipeline', () => {
  assert.equal(
    t.dispatch({ subscriptionType: 'contact.propertyChange', propertyName: 'course_status' }),
    'sprint_pipeline'
  );
});

test('dispatch: propertyChange on unrelated property routes to unknown', () => {
  assert.equal(
    t.dispatch({ subscriptionType: 'contact.propertyChange', propertyName: 'email' }),
    'unknown'
  );
});

test('dispatch: unknown subscription type routes to unknown', () => {
  assert.equal(
    t.dispatch({ subscriptionType: 'company.creation' }),
    'unknown'
  );
});

test('dispatch: defensive fallback for propertyChange without propertyName', () => {
  assert.equal(
    t.dispatch({ subscriptionType: 'contact.propertyChange' }),
    'lead_qualification'
  );
});

// ── parseRepoUrl ─────────────────────────────────────────────

test('parseRepoUrl: plain https URL', () => {
  assert.deepEqual(t.parseRepoUrl('https://github.com/alice/brain'), { owner: 'alice', repo: 'brain' });
});

test('parseRepoUrl: .git suffix is stripped', () => {
  assert.deepEqual(t.parseRepoUrl('https://github.com/alice/brain.git'), { owner: 'alice', repo: 'brain' });
});

test('parseRepoUrl: nested path strips correctly', () => {
  assert.deepEqual(
    t.parseRepoUrl('https://github.com/alice/brain/blob/main/README.md'),
    { owner: 'alice', repo: 'brain' }
  );
});

test('parseRepoUrl: invalid input returns null', () => {
  assert.equal(t.parseRepoUrl('not a url'), null);
  assert.equal(t.parseRepoUrl(''), null);
  assert.equal(t.parseRepoUrl(null), null);
  assert.equal(t.parseRepoUrl(42), null);
});

// ── Note body formatters ─────────────────────────────────────

test('formatLeadNoteBody: success path includes marker, ICP, urgency, draft', () => {
  const body = t.formatLeadNoteBody({ icp: 'ai_brain', urgency: 5, email_draft: 'Hi Sarah,\n\nI saw...' });
  assert.match(body, /^\[sales-agent-v1\]/);
  assert.match(body, /ICP: ai_brain/);
  assert.match(body, /Urgency: 5\/5/);
  assert.match(body, /SUGGESTED EMAIL DRAFT/);
  assert.match(body, /I saw/);
});

test('formatLeadNoteBody: error path includes marker + ERROR prefix', () => {
  const body = t.formatLeadNoteBody({ error: 'Claude timed out' });
  assert.match(body, /^\[sales-agent-v1\]/);
  assert.match(body, /ERROR: Claude timed out/);
  assert.match(body, /review the contact manually/);
});

test('formatSprintNoteBody: success path includes marker, readiness, signals, draft', () => {
  const body = t.formatSprintNoteBody({
    readiness: 4,
    signals: ['Named ROI in handover', 'Clear scope', 'Hinted upgrade intent'],
    email_draft: 'Hey Sarah, congrats on graduating...'
  });
  assert.match(body, /^\[sprint-pipeline-v1\]/);
  assert.match(body, /Sprint-readiness: 4\/5/);
  assert.match(body, /Named ROI in handover, Clear scope, Hinted upgrade intent/);
  assert.match(body, /SUGGESTED SPRINT OUTREACH \(private to Nick\)/);
  assert.match(body, /this note is internal only/);
});

test('formatSprintNoteBody: error path includes marker + ERROR prefix', () => {
  const body = t.formatSprintNoteBody({ error: 'GitHub access denied (403)' });
  assert.match(body, /^\[sprint-pipeline-v1\]/);
  assert.match(body, /ERROR: GitHub access denied/);
  assert.match(body, /manually before reaching out/);
});

// ── Idempotency marker handling (mocked fetch) ───────────────

function withMockedFetch(fn, mockImpl) {
  const original = global.fetch;
  global.fetch = mockImpl;
  return Promise.resolve(fn()).finally(() => {
    global.fetch = original;
  });
}

test('hasPriorAgentNote: no associated notes → false', async () => {
  let calls = 0;
  await withMockedFetch(
    async () => {
      const result = await t.hasPriorAgentNote('123', 'tok', '[sales-agent-v1]');
      assert.equal(result, false);
    },
    async (url) => {
      calls++;
      // Association call returns empty results
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }
  );
  assert.equal(calls, 1);
});

test('hasPriorAgentNote: 404 on association call → false', async () => {
  await withMockedFetch(
    async () => {
      const result = await t.hasPriorAgentNote('123', 'tok', '[sales-agent-v1]');
      assert.equal(result, false);
    },
    async () => new Response('', { status: 404 })
  );
});

test('hasPriorAgentNote: marker found in note body → true', async () => {
  let calls = 0;
  await withMockedFetch(
    async () => {
      const result = await t.hasPriorAgentNote('123', 'tok', '[sales-agent-v1]');
      assert.equal(result, true);
    },
    async (url) => {
      calls++;
      if (calls === 1) {
        return new Response(JSON.stringify({ results: [{ toObjectId: 'note-1' }] }), { status: 200 });
      }
      return new Response(JSON.stringify({
        properties: { hs_note_body: '[sales-agent-v1]\nICP: cto_services\nUrgency: 4/5\n\n--- DRAFT ---\nHi' }
      }), { status: 200 });
    }
  );
  assert.equal(calls, 2);
});

test('hasPriorAgentNote: marker mismatch — sprint marker does NOT match sales-agent note', async () => {
  await withMockedFetch(
    async () => {
      // Same note body (sales-agent marker), but searching for sprint-pipeline marker
      const result = await t.hasPriorAgentNote('123', 'tok', '[sprint-pipeline-v1]');
      assert.equal(result, false, 'sprint-pipeline marker should not match a sales-agent-v1 note');
    },
    async (url) => {
      if (url.includes('associations')) {
        return new Response(JSON.stringify({ results: [{ toObjectId: 'note-1' }] }), { status: 200 });
      }
      return new Response(JSON.stringify({
        properties: { hs_note_body: '[sales-agent-v1]\nICP: cto_services' }
      }), { status: 200 });
    }
  );
});

test('hasPriorAgentNote: sprint marker matches sprint note', async () => {
  await withMockedFetch(
    async () => {
      const result = await t.hasPriorAgentNote('123', 'tok', '[sprint-pipeline-v1]');
      assert.equal(result, true);
    },
    async (url) => {
      if (url.includes('associations')) {
        return new Response(JSON.stringify({ results: [{ toObjectId: 'note-1' }] }), { status: 200 });
      }
      return new Response(JSON.stringify({
        properties: { hs_note_body: '[sprint-pipeline-v1]\nSprint-readiness: 4/5\n...' }
      }), { status: 200 });
    }
  );
});

// ── GitHub Contents API failure modes ────────────────────────

test('fetchRepoFile: 200 returns body text', async () => {
  await withMockedFetch(
    async () => {
      const r = await t.fetchRepoFile('alice', 'brain', 'baseline.md', 'tok');
      assert.equal(r, '# Baseline\n\nScores...');
    },
    async () => new Response('# Baseline\n\nScores...', { status: 200 })
  );
});

test('fetchRepoFile: 404 returns null (graceful)', async () => {
  await withMockedFetch(
    async () => {
      const r = await t.fetchRepoFile('alice', 'brain', 'missing.md', 'tok');
      assert.equal(r, null);
    },
    async () => new Response('Not Found', { status: 404 })
  );
});

test('fetchRepoFile: 403 throws github_auth_failed', async () => {
  await withMockedFetch(
    async () => {
      await assert.rejects(
        async () => {
          await t.fetchRepoFile('alice', 'brain', 'baseline.md', 'expired_tok');
        },
        (err) => {
          assert.equal(err.status, 403);
          assert.match(err.message, /github_auth_failed/);
          return true;
        }
      );
    },
    async () => new Response('Forbidden — token expired', { status: 403 })
  );
});

test('fetchRepoFile: 401 throws github_auth_failed', async () => {
  await withMockedFetch(
    async () => {
      await assert.rejects(
        async () => {
          await t.fetchRepoFile('alice', 'brain', 'baseline.md', 'bad_tok');
        },
        (err) => {
          assert.equal(err.status, 401);
          assert.match(err.message, /github_auth_failed/);
          return true;
        }
      );
    },
    async () => new Response('Unauthorized', { status: 401 })
  );
});

test('fetchRepoFile: 500 throws github_fetch_failed', async () => {
  await withMockedFetch(
    async () => {
      await assert.rejects(
        async () => {
          await t.fetchRepoFile('alice', 'brain', 'baseline.md', 'tok');
        },
        (err) => {
          assert.equal(err.status, 500);
          assert.match(err.message, /github_fetch_failed/);
          return true;
        }
      );
    },
    async () => new Response('Internal Server Error', { status: 500 })
  );
});

test('fetchRepoFile: sends Authorization header with token', async () => {
  let capturedAuth;
  await withMockedFetch(
    async () => {
      await t.fetchRepoFile('alice', 'brain', 'x.md', 'my-pat');
    },
    async (url, opts) => {
      capturedAuth = opts.headers.Authorization;
      return new Response('ok', { status: 200 });
    }
  );
  assert.equal(capturedAuth, 'Bearer my-pat');
});

// ── Constants ────────────────────────────────────────────────

test('constants are stable', () => {
  assert.equal(t.SALES_AGENT_MARKER, '[sales-agent-v1]');
  assert.equal(t.SPRINT_PIPELINE_MARKER, '[sprint-pipeline-v1]');
  assert.equal(t.GRADUATED_STATUS, 'graduated');
  assert.equal(t.SIGNATURE_REPLAY_WINDOW_MS, 5 * 60 * 1000);
  assert.ok(t.ALLOWED_LEAD_SOURCES.has('cto_services'));
  assert.ok(t.ALLOWED_LEAD_SOURCES.has('course_waitlist'));
  assert.ok(t.ALLOWED_LEAD_SOURCES.has('prompt_library'));
  assert.ok(t.ALLOWED_LEAD_SOURCES.has('ai_brain_rate_card'));
  assert.ok(!t.ALLOWED_LEAD_SOURCES.has('graduated'));
});
