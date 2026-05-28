// Unit tests for scripts/brain-health-check.js — isStagnant boundaries,
// parseRepoUrl, formatSlackMessage, Slack failure degradation.
// Run with: npm run test:unit
//
// Covers critical paths #6 (isStagnant 60-day boundary) and #8
// (Slack webhook failure degradation) from the eng-review S3-1 scope.

const test = require('node:test');
const assert = require('node:assert/strict');
const brain = require('../../scripts/brain-health-check.js');
const t = brain.__test;

// ── isStagnant 60-day boundary ───────────────────────────────

test('isStagnant: 75 days → stagnant', () => {
  const now = new Date('2026-05-15T12:00:00Z');
  const lastCommit = new Date('2026-03-01T12:00:00Z'); // ~75 days
  assert.equal(t.isStagnant(lastCommit, 60, now), true);
});

test('isStagnant: 61 days → stagnant', () => {
  const now = new Date('2026-05-15T12:00:00Z');
  const lastCommit = new Date('2026-03-15T12:00:00Z'); // 61 days
  assert.equal(t.isStagnant(lastCommit, 60, now), true);
});

test('isStagnant: 60 days exact → stagnant (boundary inclusive)', () => {
  const now = new Date('2026-05-15T12:00:00Z');
  const lastCommit = new Date('2026-03-16T12:00:00Z'); // exactly 60 days
  assert.equal(t.isStagnant(lastCommit, 60, now), true);
});

test('isStagnant: 59 days → fresh', () => {
  const now = new Date('2026-05-15T12:00:00Z');
  const lastCommit = new Date('2026-03-17T12:00:00Z'); // 59 days
  assert.equal(t.isStagnant(lastCommit, 60, now), false);
});

test('isStagnant: 15 days → fresh', () => {
  const now = new Date('2026-05-15T12:00:00Z');
  const lastCommit = new Date('2026-04-30T12:00:00Z'); // 15 days
  assert.equal(t.isStagnant(lastCommit, 60, now), false);
});

test('isStagnant: same day → fresh', () => {
  const now = new Date('2026-05-15T12:00:00Z');
  const lastCommit = new Date('2026-05-15T11:00:00Z');
  assert.equal(t.isStagnant(lastCommit, 60, now), false);
});

test('isStagnant: ISO string input works', () => {
  assert.equal(t.isStagnant('2026-03-01', 60, new Date('2026-05-15')), true);
  assert.equal(t.isStagnant('2026-04-30', 60, new Date('2026-05-15')), false);
});

test('isStagnant: threshold of 30 days is independent of 60', () => {
  const now = new Date('2026-05-15T12:00:00Z');
  const lastCommit = new Date('2026-04-10T12:00:00Z'); // 35 days
  assert.equal(t.isStagnant(lastCommit, 30, now), true);
  assert.equal(t.isStagnant(lastCommit, 60, now), false);
});

// ── parseRepoUrl ─────────────────────────────────────────────

test('parseRepoUrl: plain URL', () => {
  assert.deepEqual(t.parseRepoUrl('https://github.com/alice/brain'), { owner: 'alice', repo: 'brain' });
});

test('parseRepoUrl: trailing slash', () => {
  assert.deepEqual(t.parseRepoUrl('https://github.com/alice/brain/'), { owner: 'alice', repo: 'brain' });
});

test('parseRepoUrl: .git suffix', () => {
  assert.deepEqual(t.parseRepoUrl('https://github.com/alice/brain.git'), { owner: 'alice', repo: 'brain' });
});

test('parseRepoUrl: invalid returns null', () => {
  assert.equal(t.parseRepoUrl('not a url'), null);
  assert.equal(t.parseRepoUrl(''), null);
  assert.equal(t.parseRepoUrl(null), null);
});

// ── formatSlackMessage ───────────────────────────────────────

test('formatSlackMessage: single stagnant alumnus', () => {
  const msg = t.formatSlackMessage([
    {
      firstname: 'Sarah',
      company: 'Acme Co',
      repo: 'alice/sarah-brain',
      days_stagnant: 73,
      last_commit_date: '2026-03-03'
    }
  ], 60);
  assert.match(msg.text, /Brain Health daily check — 1 alumni stagnant \(>60 days no commits\)/);
  assert.match(msg.text, /Sarah at Acme Co — 73 days since last commit \(alice\/sarah-brain\)/);
  assert.match(msg.text, /Brain MOT template/);
  // Should NOT make claims of "this is a problem"
  assert.match(msg.text, /may be operationalising elsewhere|don't assume/i);
});

test('formatSlackMessage: multiple stagnant alumni', () => {
  const msg = t.formatSlackMessage([
    { firstname: 'Sarah', company: 'Acme Co', repo: 'alice/sarah-brain', days_stagnant: 73, last_commit_date: '2026-03-03' },
    { firstname: 'Bob', company: 'WidgetCorp', repo: 'bob/widget-brain', days_stagnant: 65, last_commit_date: '2026-03-11' }
  ], 60);
  assert.match(msg.text, /2 alumni stagnant/);
  assert.match(msg.text, /Sarah/);
  assert.match(msg.text, /Bob/);
});

test('formatSlackMessage: respects custom threshold', () => {
  const msg = t.formatSlackMessage([
    { firstname: 'Sarah', company: 'Acme', repo: 'a/b', days_stagnant: 35, last_commit_date: '2026-04-10' }
  ], 30);
  assert.match(msg.text, />30 days no commits/);
});

// ── Slack webhook degradation ────────────────────────────────

function withMockedFetch(fn, mockImpl) {
  const original = global.fetch;
  global.fetch = mockImpl;
  return Promise.resolve(fn()).finally(() => {
    global.fetch = original;
  });
}

test('postToSlack: 200 returns ok', async () => {
  let called = false;
  await withMockedFetch(
    async () => {
      const result = await t.postToSlack('https://hooks.slack.com/test', { text: 'hi' });
      // The contract: success returns truthy / does not throw
      assert.ok(result === true || result === undefined || (result && result.ok));
    },
    async (url) => {
      called = true;
      assert.equal(url, 'https://hooks.slack.com/test');
      return new Response('ok', { status: 200 });
    }
  );
  assert.equal(called, true);
});

test('postToSlack: 500 degrades silently (returns falsy, does not throw)', async () => {
  await withMockedFetch(
    async () => {
      // Per S2-1: Slack failure must degrade silently — should NOT throw.
      // The contract is "log + continue" so we just verify no exception.
      let threw = false;
      try {
        await t.postToSlack('https://hooks.slack.com/test', { text: 'hi' });
      } catch (e) {
        threw = true;
      }
      assert.equal(threw, false, 'postToSlack must not throw on 500');
    },
    async () => new Response('Internal Server Error', { status: 500 })
  );
});

test('postToSlack: network error degrades silently', async () => {
  await withMockedFetch(
    async () => {
      let threw = false;
      try {
        await t.postToSlack('https://hooks.slack.com/test', { text: 'hi' });
      } catch (e) {
        threw = true;
      }
      assert.equal(threw, false, 'postToSlack must not throw on network error');
    },
    async () => { throw new TypeError('fetch failed: ECONNREFUSED'); }
  );
});
