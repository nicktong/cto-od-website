#!/usr/bin/env node
/* ============================================================
   scripts/draft-case-study.js — Long-form case-study generator

   Generates an 80%-finished case-study draft for a course Cohort 1
   graduate. Nick runs this manually at Week 6 and edits the output
   in ~20 minutes before publishing.

   Invocation:
     node scripts/draft-case-study.js \
       --repo <github-url> --name <firstname> \
       [--company <company>] [--out <path>]

   Env vars:
     ANTHROPIC_API_KEY   (consumed by lib/claude.js)
     GITHUB_COHORT_TOKEN (fine-grained PAT, Contents:Read on repo)
     PRICING_NOTES       (optional — appended to system prompt)

   Output:
     Markdown file with front-matter at --out (default:
     case-studies/{slug}-{YYYY-MM-DD}.md). Never overwrites; if the
     file exists the script exits 1 so Nick can choose another path.

   Locked format (per CEO plan 2026-05-26-course-cohort-1.md, Step
   0E D4): long-form narrative (~600 words) + 3 quotes + before/after.
   ============================================================ */

const fs = require('node:fs/promises');
const path = require('node:path');
const { parseArgs } = require('node:util');

const claude = require('../lib/claude.js');

// ── CLI parsing ──────────────────────────────────────────────
const USAGE = [
  'Usage:',
  '  node scripts/draft-case-study.js --repo <github-url> --name <firstname> \\',
  '    [--company <company>] [--out <path>]',
  '',
  'Required env vars:',
  '  ANTHROPIC_API_KEY   — Claude API key',
  '  GITHUB_COHORT_TOKEN — GitHub PAT with Contents:Read on the repo',
  '',
  'Optional env vars:',
  '  PRICING_NOTES       — private pricing context (never quoted in draft)',
  '',
  'Writes a markdown draft to --out (default: case-studies/{slug}-{date}.md).',
  'Does not overwrite existing files.'
].join('\n');

function printUsage(stream = process.stderr) {
  stream.write(USAGE + '\n');
}

function parseCli(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      repo:    { type: 'string' },
      name:    { type: 'string' },
      company: { type: 'string' },
      out:     { type: 'string' },
      help:    { type: 'boolean', short: 'h', default: false }
    },
    strict: true,
    allowPositionals: false
  });
  return values;
}

// ── Helpers ──────────────────────────────────────────────────
function parseRepoUrl(repoUrl) {
  if (typeof repoUrl !== 'string') return null;
  const m = repoUrl.match(/github\.com\/([^/]+)\/([^/?#]+?)(?:\.git)?(?:[/?#]|$)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function todayIso() {
  const d = new Date();
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function countWords(s) {
  return String(s).trim().split(/\s+/).filter(Boolean).length;
}

// ── GitHub Contents API ──────────────────────────────────────
// Pattern matches api/sales-agent.js fetchRepoFile — same auth and
// failure modes. 404 → null. 401/403 → throw (auth issue).
async function fetchRepoFile(owner, repo, filePath, token) {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${filePath}`;
  const res = await fetch(url, {
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github.v3.raw',
      'User-Agent': 'cto-od-draft-case-study'
    }
  });
  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 403) {
    const err = new Error('github_auth_failed: ' + res.status);
    err.status = res.status;
    err.body = await res.text().catch(() => '');
    throw err;
  }
  if (!res.ok) {
    const err = new Error('github_fetch_failed: ' + res.status);
    err.status = res.status;
    throw err;
  }
  return await res.text();
}

// List contents of a directory in the repo. Returns array of
// { name, path, type } objects or null on 404.
async function listRepoDir(owner, repo, dirPath, token) {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${dirPath}`;
  const res = await fetch(url, {
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'cto-od-draft-case-study'
    }
  });
  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 403) {
    const err = new Error('github_auth_failed: ' + res.status);
    err.status = res.status;
    err.body = await res.text().catch(() => '');
    throw err;
  }
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return Array.isArray(data) ? data : null;
}

// Fetch up to N markdown files from a directory (best-effort).
async function fetchWorkflowFiles(owner, repo, token, limit = 3) {
  let listing;
  try {
    listing = await listRepoDir(owner, repo, 'workflows', token);
  } catch (err) {
    // Auth errors surface to caller; other listing failures are non-fatal.
    if (err.status === 401 || err.status === 403) throw err;
    return [];
  }
  if (!listing) return [];
  const mdFiles = listing
    .filter(item => item.type === 'file' && /\.md$/i.test(item.name))
    .slice(0, limit);
  const out = [];
  for (const f of mdFiles) {
    try {
      const content = await fetchRepoFile(owner, repo, f.path, token);
      if (content) out.push({ name: f.name, content });
    } catch (err) {
      if (err.status === 401 || err.status === 403) throw err;
      // Non-auth fetch failure on a single workflow file — skip it.
    }
  }
  return out;
}

// ── Prompt construction ──────────────────────────────────────
const TASK_BODY = [
  'You are drafting a long-form case study for a course Cohort 1 graduate,',
  "in Nick Tong's voice (matching MARKETING.md above). The case study",
  'will appear on the public ctoondemand.co.uk site (blog or alumni page).',
  '',
  'STRUCTURE (~600 words total):',
  '',
  '1. OPENING NARRATIVE (~150 words): Lead with the human. Name + role +',
  '   company size + the specific pain they came in with. Reference one',
  '   concrete situation from baseline.md.',
  '',
  '2. THE WORK (~200 words): What they actually built across the six weeks.',
  '   Reference specific workflows, archetypes, or stores from their repo.',
  '   Show evidence — quote 1-2 short lines from handover.md or workflows/.',
  '',
  '3. THE SHIFT (~150 words): Before/after — what they could do at Week 1',
  '   vs Week 6. Use the diagnostic scores if baseline.md and handover.md',
  '   both contain them. Otherwise describe the qualitative shift.',
  '',
  '4. CALLBACK QUOTE (~50 words): Pick one direct quote (max 30 words)',
  '   from handover.md that captures the essence of the change. Format as',
  '   a blockquote.',
  '',
  '5. NEXT (~50 words): One sentence on what they\'re doing next with',
  '   their AI brain. Optional second sentence if Sprint upgrade is hinted.',
  '',
  'VOICE RULES:',
  '- Match MARKETING.md voice exactly. Builder-to-builder.',
  '- UK English (organise, personalise, behaviour).',
  '- NO em dashes.',
  '- NO AI-vocabulary slop (delve, leverage, robust, comprehensive,',
  '  foster, multifaceted, showcase, intricate, vibrant, pivotal,',
  '  nuanced, holistic, fundamental, significant).',
  '- Direct, concrete, no corporate cosplay.',
  '- The graduate is not a marketing case study character — they are a',
  '  real person solving a real business problem.',
  '',
  'DO NOT:',
  '- Quote prices (use "their cohort fee" or "the course price" generically).',
  '- Invent metrics not in the source files.',
  '- Make claims about ROI that aren\'t supported by handover.md.'
].join('\n');

function buildSystem() {
  return claude.buildSystemPrompt([
    {
      heading: 'Pricing Notes (Private — do not quote prices)',
      body: process.env.PRICING_NOTES
    },
    {
      heading: 'Task Mode — Case Study Generation',
      body: TASK_BODY
    }
  ]);
}

function buildUserPrompt({ firstname, company, ownerRepo, baseline, handover, voice, workflows }) {
  const parts = [];
  parts.push('<participant>');
  parts.push(`  <firstname>${claude.escapeXml(firstname)}</firstname>`);
  if (company) {
    parts.push(`  <company>${claude.escapeXml(company)}</company>`);
  }
  parts.push(`  <repo>${claude.escapeXml(ownerRepo)}</repo>`);
  parts.push('</participant>');
  parts.push('');
  parts.push('<baseline_md>');
  parts.push(claude.escapeXml(baseline || '(missing)'));
  parts.push('</baseline_md>');
  parts.push('');
  parts.push('<handover_md>');
  parts.push(claude.escapeXml(handover || '(missing)'));
  parts.push('</handover_md>');
  parts.push('');
  parts.push('<voice_md>');
  parts.push(claude.escapeXml(voice || '(missing)'));
  parts.push('</voice_md>');
  parts.push('');
  parts.push('<workflows>');
  if (workflows && workflows.length > 0) {
    for (const w of workflows) {
      const snippet = String(w.content || '').slice(0, 500);
      parts.push(`  <file name="${claude.escapeXml(w.name)}">`);
      parts.push(claude.escapeXml(snippet));
      parts.push('  </file>');
    }
  } else {
    parts.push('(no workflows/ files found)');
  }
  parts.push('</workflows>');
  parts.push('');
  parts.push('Respond with JSON ONLY (no preamble, no markdown fences). Schema:');
  parts.push('');
  parts.push('{');
  parts.push('  "title": "string — short title for the case study (max 70 chars)",');
  parts.push('  "draft_markdown": "string — the full ~600-word case study in markdown, exactly the structure above"');
  parts.push('}');
  return parts.join('\n');
}

// ── Front-matter assembly ────────────────────────────────────
function buildFrontMatter({ title, name, company, ownerRepo }) {
  const lines = ['---'];
  lines.push(`title: ${JSON.stringify(title)}`);
  lines.push(`graduate_name: ${JSON.stringify(name)}`);
  if (company) {
    lines.push(`graduate_company: ${JSON.stringify(company)}`);
  }
  lines.push('cohort: "Cohort 1"');
  lines.push(`generated: ${JSON.stringify(new Date().toISOString())}`);
  lines.push(`repo: ${JSON.stringify(ownerRepo)}`);
  lines.push('status: draft  # Nick edits and flips to published');
  lines.push('---');
  return lines.join('\n');
}

// ── Main ─────────────────────────────────────────────────────
async function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseCli(argv);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n\n`);
    printUsage();
    process.exit(1);
  }

  if (opts.help) {
    printUsage(process.stdout);
    process.exit(0);
  }

  if (!opts.repo || !opts.name) {
    process.stderr.write('Error: --repo and --name are required.\n\n');
    printUsage();
    process.exit(1);
  }

  // Validate env.
  if (!process.env.ANTHROPIC_API_KEY) {
    process.stderr.write('Error: ANTHROPIC_API_KEY env var is not set.\n');
    process.exit(1);
  }
  if (!process.env.GITHUB_COHORT_TOKEN) {
    process.stderr.write('Error: GITHUB_COHORT_TOKEN env var is not set.\n');
    process.exit(1);
  }

  // Parse repo URL.
  const parsed = parseRepoUrl(opts.repo);
  if (!parsed) {
    process.stderr.write(`Error: --repo "${opts.repo}" is not a valid GitHub URL.\n`);
    process.stderr.write('Expected format: https://github.com/<owner>/<repo>\n');
    process.exit(1);
  }
  const { owner, repo } = parsed;
  const ownerRepo = `${owner}/${repo}`;

  // Compute output path.
  const outPath = opts.out || path.join('case-studies', `${slugify(opts.name)}-${todayIso()}.md`);
  const absOut = path.isAbsolute(outPath) ? outPath : path.resolve(process.cwd(), outPath);

  // Guard against overwrite.
  try {
    await fs.access(absOut);
    process.stderr.write(`Error: ${outPath} already exists. Pick a different --out path.\n`);
    process.exit(1);
  } catch (_) {
    // Doesn't exist — good.
  }

  // Fetch repo files.
  const githubToken = process.env.GITHUB_COHORT_TOKEN;
  process.stderr.write(`Fetching ${ownerRepo} ...\n`);

  let baseline = null;
  let handover = null;
  let voice = null;
  let workflows = [];
  try {
    [baseline, handover, voice] = await Promise.all([
      fetchRepoFile(owner, repo, 'baseline.md', githubToken),
      fetchRepoFile(owner, repo, 'handover.md', githubToken),
      fetchRepoFile(owner, repo, 'voice/voice.md', githubToken)
    ]);
    workflows = await fetchWorkflowFiles(owner, repo, githubToken, 3);
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      process.stderr.write(
        `Error: GitHub access denied (${err.status}) — check GITHUB_COHORT_TOKEN ` +
        `is set and is a collaborator on ${ownerRepo}.\n`
      );
      process.exit(1);
    }
    process.stderr.write(`Error: GitHub fetch failed (${err.status || 'unknown'}): ${err.message}\n`);
    process.exit(1);
  }

  if (!baseline && !handover) {
    process.stderr.write(
      `Error: graduate's repo missing baseline + handover; case study not generatable.\n` +
      `Looked in ${ownerRepo} for baseline.md and handover.md — both 404.\n`
    );
    process.exit(1);
  }

  // Build prompts and call Claude.
  const system = buildSystem();
  const user = buildUserPrompt({
    firstname: opts.name,
    company: opts.company,
    ownerRepo,
    baseline,
    handover,
    voice,
    workflows
  });

  process.stderr.write('Calling Claude ...\n');
  let responseText;
  try {
    responseText = await claude.callClaude({ system, user, maxTokens: 4096 });
  } catch (err) {
    process.stderr.write(`Error: Claude API call failed (${err.status || 'unknown'}): ${err.message}\n`);
    if (err.body) process.stderr.write(err.body + '\n');
    process.exit(1);
  }

  const result = claude.parseJsonResponse(responseText, ['title', 'draft_markdown']);
  if (!result.ok) {
    process.stderr.write(`Error: Claude response could not be parsed (${result.reason}).\n`);
    process.stderr.write('--- raw response ---\n');
    process.stderr.write((result.raw_text || responseText || '(empty)') + '\n');
    process.stderr.write('--- end raw response ---\n');
    process.exit(2);
  }

  const { title, draft_markdown } = result.value;

  // Compose the final markdown.
  const frontMatter = buildFrontMatter({
    title,
    name: opts.name,
    company: opts.company,
    ownerRepo
  });
  const fileContents = `${frontMatter}\n\n${String(draft_markdown).trimStart()}\n`;

  // Ensure the output directory exists.
  await fs.mkdir(path.dirname(absOut), { recursive: true });
  await fs.writeFile(absOut, fileContents, 'utf8');

  const wc = countWords(draft_markdown);
  process.stdout.write(`✓ Wrote case study draft to ${outPath}\n`);
  process.stdout.write(`  ${wc} words. Edit before publishing.\n`);
}

// Test exports + main gating.
module.exports = {
  parseRepoUrl,
  slugify,
  todayIso,
  countWords,
  buildSystem,
  buildUserPrompt,
  buildFrontMatter,
  fetchRepoFile,
  listRepoDir,
  fetchWorkflowFiles,
  main,
  USAGE
};

if (require.main === module) {
  main().catch(err => {
    process.stderr.write(`Unhandled error: ${err.stack || err.message || err}\n`);
    process.exit(1);
  });
}
