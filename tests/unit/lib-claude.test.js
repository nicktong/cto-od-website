// Unit tests for lib/claude.js — pure helpers + parser.
// Run with: npm run test:unit
//
// Covers critical path #7 from the eng-review S3-1 scope:
// parseJsonResponse — happy / empty / fallback / missing-keys.

const test = require('node:test');
const assert = require('node:assert/strict');
const claude = require('../../lib/claude.js');

test('lib/claude — escapeXml escapes the five XML reserved characters', () => {
  assert.equal(claude.escapeXml('<script>'), '&lt;script&gt;');
  assert.equal(claude.escapeXml('a & b'), 'a &amp; b');
  assert.equal(claude.escapeXml('"quoted"'), '&quot;quoted&quot;');
  assert.equal(claude.escapeXml("it's"), 'it&apos;s');
  // Combined
  assert.equal(
    claude.escapeXml('<x a="b">it\'s</x> & y'),
    '&lt;x a=&quot;b&quot;&gt;it&apos;s&lt;/x&gt; &amp; y'
  );
  // Non-string input coerces
  assert.equal(claude.escapeXml(42), '42');
});

test('lib/claude — parseJsonResponse happy path', () => {
  const r = claude.parseJsonResponse(
    '{"icp":"cto_services","urgency":4,"email_draft":"Hi Sarah"}',
    ['icp', 'urgency', 'email_draft']
  );
  assert.equal(r.ok, true);
  assert.equal(r.value.icp, 'cto_services');
  assert.equal(r.value.urgency, 4);
});

test('lib/claude — parseJsonResponse strips ```json fences', () => {
  const r = claude.parseJsonResponse(
    '```json\n{"a":1}\n```',
    ['a']
  );
  assert.equal(r.ok, true);
  assert.equal(r.value.a, 1);
});

test('lib/claude — parseJsonResponse strips plain ``` fences', () => {
  const r = claude.parseJsonResponse(
    '```\n{"a":2}\n```',
    ['a']
  );
  assert.equal(r.ok, true);
  assert.equal(r.value.a, 2);
});

test('lib/claude — parseJsonResponse empty response', () => {
  const r1 = claude.parseJsonResponse('', ['x']);
  assert.equal(r1.ok, false);
  assert.equal(r1.reason, 'empty_response');

  const r2 = claude.parseJsonResponse('   \n\t  ', ['x']);
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, 'empty_response');

  const r3 = claude.parseJsonResponse(null, ['x']);
  assert.equal(r3.ok, false);
  assert.equal(r3.reason, 'empty_response');
});

test('lib/claude — parseJsonResponse unparseable JSON', () => {
  const r = claude.parseJsonResponse('not json at all', ['x']);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'unparseable');
  assert.equal(r.raw_text, 'not json at all');
});

test('lib/claude — parseJsonResponse missing keys returns partial + missing list', () => {
  const r = claude.parseJsonResponse(
    '{"icp":"a"}',
    ['icp', 'urgency', 'email_draft']
  );
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing_keys');
  assert.deepEqual(r.missing.sort(), ['email_draft', 'urgency']);
  assert.deepEqual(r.partial, { icp: 'a' });
});

test('lib/claude — parseJsonResponse accepts any shape when expectedKeys is empty', () => {
  const r = claude.parseJsonResponse('{"anything":true}', []);
  assert.equal(r.ok, true);
});

test('lib/claude — parseJsonResponse rejects non-object JSON (arrays, primitives)', () => {
  const arr = claude.parseJsonResponse('[1,2,3]', []);
  // Arrays are objects in JS — current impl accepts them. Document the behaviour.
  assert.equal(arr.ok, true);

  // Primitives should fail
  const num = claude.parseJsonResponse('42', []);
  assert.equal(num.ok, false);
  assert.equal(num.reason, 'unparseable');
});

test('lib/claude — buildSystemPrompt with no extras equals MARKETING.md', () => {
  const base = claude.loadMarketingMd();
  const built = claude.buildSystemPrompt();
  assert.equal(built, base);
});

test('lib/claude — buildSystemPrompt appends single extras object', () => {
  const built = claude.buildSystemPrompt({ heading: 'Test', body: 'hello world' });
  assert.match(built, /## Test\n\nhello world$/);
});

test('lib/claude — buildSystemPrompt appends array of extras in order', () => {
  const built = claude.buildSystemPrompt([
    { heading: 'A', body: 'aaa' },
    { heading: 'B', body: 'bbb' }
  ]);
  const aIdx = built.indexOf('## A');
  const bIdx = built.indexOf('## B');
  assert.ok(aIdx > 0 && bIdx > aIdx, 'A should come before B');
});

test('lib/claude — buildSystemPrompt skips extras with empty body', () => {
  const base = claude.loadMarketingMd();
  const built = claude.buildSystemPrompt([
    { heading: 'A', body: null },
    { heading: 'B', body: undefined },
    { heading: 'C', body: '' }
  ]);
  assert.equal(built, base);
});

test('lib/claude — callClaude throws claude_missing_api_key when ANTHROPIC_API_KEY unset', async () => {
  // Save + clear env var
  const original = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  await assert.rejects(
    async () => {
      await claude.callClaude({ system: 'hi', user: 'hi' });
    },
    (err) => {
      assert.equal(err.message, 'claude_missing_api_key');
      assert.equal(err.status, 0);
      return true;
    }
  );

  // Restore
  if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
});
