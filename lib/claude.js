/* ============================================================
   lib/claude.js — Shared Claude API call utilities

   Used by:
     - api/sales-agent.js   (lead qualification + Sprint pipeline)
     - scripts/draft-case-study.mjs (case study draft generation)
     - future callers

   Module format: CommonJS (matches existing api/ pattern).
   ESM callers (.mjs scripts) can use:
     import { callClaude, loadMarketingMd } from '../lib/claude.js';

   Env vars consumed:
     ANTHROPIC_API_KEY  — required by callClaude (unless apiKey passed)
     PRICING_NOTES      — optional; callers can append it to system prompt

   Design notes:
     - callClaude takes pre-assembled system + user strings. Callers own
       prompt construction so each call site can vary instructions, schema,
       and XML wrapping without polluting the shared helper.
     - loadMarketingMd caches the read at module load; reset by process restart.
     - parseJsonResponse handles markdown fences, empty response, and
       schema validation against an expected-keys list.
     - escapeXml is intentionally minimal — designed for prompt injection
       mitigation in <lead_data> wrappers, not HTML output.
   ============================================================ */

const fs = require('fs');
const path = require('path');

// Claude model. Update when migrating to a newer Sonnet release.
const CLAUDE_MODEL = 'claude-sonnet-4-5';
const CLAUDE_API = 'https://api.anthropic.com/v1/messages';
const CLAUDE_VERSION = '2023-06-01';

// MARKETING.md sits at the repo root. From lib/, that's one level up.
// Same depth as api/ and scripts/, so the relative path is consistent.
let _marketingMdCache = null;
function loadMarketingMd() {
  if (_marketingMdCache) return _marketingMdCache;
  const p = path.join(__dirname, '..', 'MARKETING.md');
  _marketingMdCache = fs.readFileSync(p, 'utf8');
  return _marketingMdCache;
}

// XML escape for user-supplied content. Used to wrap untrusted strings
// in <lead_data> tags so prompt-injection attempts read as quoted user
// input rather than executable instructions.
function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Build the system prompt by appending optional sections to MARKETING.md.
// extras: string OR array of { heading, body } objects.
// Examples:
//   buildSystemPrompt()
//   buildSystemPrompt({ heading: 'Pricing Notes (Private)', body: process.env.PRICING_NOTES })
//   buildSystemPrompt([{ heading: 'Task Mode', body: 'You are scoring graduates...' }])
function buildSystemPrompt(extras) {
  const marketingMd = loadMarketingMd();
  if (!extras) return marketingMd;
  const list = Array.isArray(extras) ? extras : [extras];
  const sections = list
    .filter(e => e && e.body)
    .map(e => `\n\n## ${e.heading}\n\n${e.body}`)
    .join('');
  return marketingMd + sections;
}

// Generic Claude API call. Returns the response text (first text block).
//
// options:
//   system     — string OR system-block array (for advanced cache_control)
//   user       — string user-message content
//   model      — defaults to CLAUDE_MODEL
//   maxTokens  — defaults to 2048
//   apiKey     — defaults to process.env.ANTHROPIC_API_KEY
//
// Throws on non-2xx with err.status and err.body populated.
// System prompt is marked cache_control: ephemeral by default when passed
// as a string — saves cost on stable prompts (MARKETING.md is stable).
async function callClaude({ system, user, model = CLAUDE_MODEL, maxTokens = 2048, apiKey }) {
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) {
    const err = new Error('claude_missing_api_key');
    err.status = 0;
    throw err;
  }

  const systemBlock = Array.isArray(system)
    ? system
    : [{ type: 'text', text: String(system || ''), cache_control: { type: 'ephemeral' } }];

  const res = await fetch(CLAUDE_API, {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': CLAUDE_VERSION,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemBlock,
      messages: [{ role: 'user', content: String(user || '') }]
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
  return textBlock ? textBlock.text : '';
}

// Parse Claude's response as JSON with markdown-fence tolerance and
// bounded fallback. Returns:
//   { ok: true, value }                    — parsed JSON matches expected keys
//   { ok: false, reason: 'empty_response' } — Claude returned nothing
//   { ok: false, reason: 'unparseable', raw_text } — couldn't parse
//   { ok: false, reason: 'missing_keys', missing, raw_text } — parsed but schema mismatch
//
// expectedKeys: array of top-level keys the response should contain.
//               Pass [] to accept any object shape.
function parseJsonResponse(text, expectedKeys = []) {
  if (!text || !String(text).trim()) {
    return { ok: false, reason: 'empty_response' };
  }
  const stripped = String(text)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  let parsed;
  try {
    parsed = JSON.parse(stripped);
  } catch (_) {
    return { ok: false, reason: 'unparseable', raw_text: text };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, reason: 'unparseable', raw_text: text };
  }
  if (expectedKeys && expectedKeys.length > 0) {
    const missing = expectedKeys.filter(k => !(k in parsed));
    if (missing.length > 0) {
      return { ok: false, reason: 'missing_keys', missing, raw_text: text, partial: parsed };
    }
  }
  return { ok: true, value: parsed };
}

module.exports = {
  CLAUDE_MODEL,
  CLAUDE_API,
  CLAUDE_VERSION,
  loadMarketingMd,
  escapeXml,
  buildSystemPrompt,
  callClaude,
  parseJsonResponse
};
