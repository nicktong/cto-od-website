/* ============================================================
   scripts/brain-health-check.js — Brain Health Dashboard cron

   Daily worker (run by .github/workflows/brain-health.yml) that:
     1. Fetches opted-in cohort alumni from HubSpot.
     2. Polls each alumnus's "second brain" repo on GitHub for the
        latest commit date.
     3. Flags any alumni whose last commit is older than
        STAGNANT_DAYS (default 60).
     4. Posts a single Slack message to Nick when any go cold.

   ── Metric caveat (CEO plan, 2026-05-26) ──────────────────────
   Commit frequency is the v1 health proxy but it is a WEAK signal:
   alumni may be operationalising elsewhere (Notion, Claude Projects,
   ChatGPT). The Slack message therefore frames the alert as a
   prompt to ASK rather than a diagnosis. A quarterly survey email
   will augment this in v2 — formatSlackMessage()'s output is the
   point this script will later read survey data from.

   ── Environment ───────────────────────────────────────────────
     HUBSPOT_TOKEN
       Private App access token. Scope: crm.objects.contacts.read
     GITHUB_COHORT_TOKEN
       Fine-grained PAT with Contents:Read + Metadata:Read on
       invited cohort participant repos. Named GITHUB_COHORT_TOKEN
       (not GITHUB_TOKEN) because GITHUB_TOKEN is a reserved name
       in GitHub Actions.
     SLACK_WEBHOOK_URL
       Incoming webhook URL for Nick's Slack workspace.
     STAGNANT_DAYS (optional, default 60)
       Threshold in days for the alert.
     DRY_RUN (optional, default false)
       If "true", skip the Slack POST and print the message to stdout.

   ── Exit codes ────────────────────────────────────────────────
     0  — success (including "no opted-in alumni", "no stagnant", or
          Slack-post failure: per S2-1 we degrade silently so the
          cron does not turn red on transient Slack outages).
     1  — missing required env var.

   ── Logging ───────────────────────────────────────────────────
   Structured-ish: every line prefixed [brain-health] and uses
   key=value pairs for greppability (matches api/sales-agent.js).
   ============================================================ */

'use strict';

const LOG_PREFIX = '[brain-health]';

// ── Pure helpers (exported for E8 unit tests) ────────────────

/**
 * Returns true if `lastCommitDate` is older than `thresholdDays` ago
 * relative to `now`. The boundary is inclusive: exactly thresholdDays
 * old counts as stagnant.
 *
 * @param {string|Date} lastCommitDate - ISO 8601 string or Date
 * @param {number} thresholdDays
 * @param {Date} [now] - override for deterministic tests
 * @returns {boolean}
 */
function isStagnant(lastCommitDate, thresholdDays, now) {
  const nowMs = (now instanceof Date ? now : new Date()).getTime();
  const lastMs = (lastCommitDate instanceof Date
    ? lastCommitDate
    : new Date(lastCommitDate)).getTime();
  if (!Number.isFinite(lastMs)) return false;
  const days = (nowMs - lastMs) / (1000 * 60 * 60 * 24);
  return days >= thresholdDays;
}

/**
 * Extracts { owner, repo } from a GitHub repo URL.
 * Same regex as api/sales-agent.js (parseRepoUrl) — kept in sync.
 *
 * @param {string} url
 * @returns {{ owner: string, repo: string } | null}
 */
function parseRepoUrl(url) {
  if (typeof url !== 'string') return null;
  const m = url.match(/github\.com\/([^/]+)\/([^/?#]+?)(?:\.git)?(?:[/?#]|$)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

/**
 * Builds a Slack incoming-webhook payload from a list of stagnant
 * alumni. The message intentionally frames "stagnant" as a prompt
 * to reach out, not a diagnosis (see metric-caveat header above).
 *
 * @param {Array<{firstname:string, company:string, repo:string, days_stagnant:number, last_commit_date:string}>} stagnantAlumni
 * @param {number} [thresholdDays] - threshold the cron is using; shown in the headline. Defaults to 60.
 * @returns {{ text: string, blocks: Array<object> }}
 */
function formatSlackMessage(stagnantAlumni, thresholdDays) {
  const threshold = Number.isFinite(thresholdDays) ? thresholdDays : 60;
  const n = stagnantAlumni.length;

  const bullets = stagnantAlumni
    .map(a => {
      const name = a.firstname || 'Unknown';
      const company = a.company ? ` at ${a.company}` : '';
      const days = a.days_stagnant;
      const repo = a.repo ? ` (${a.repo})` : '';
      return `• ${name}${company} — ${days} days since last commit${repo}`;
    })
    .join('\n');

  const headline = `:wave: Brain Health daily check — ${n} alumni stagnant (>${threshold} days no commits):`;
  const footer =
    'Reach out via the Brain MOT template — they may be operationalising elsewhere ' +
    '(Notion / Claude Projects / ChatGPT) rather than committing, so don\'t assume ' +
    'it\'s a problem. Quick "how\'s your brain going?" works.';

  const text = `${headline}\n${bullets}\n\n${footer}`;

  return {
    text,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: headline } },
      { type: 'section', text: { type: 'mrkdwn', text: bullets || '_(none)_' } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: footer }] }
    ]
  };
}

// ── HubSpot ──────────────────────────────────────────────────

/**
 * Fetches opted-in graduated alumni from HubSpot via the Search API.
 * Handles pagination via paging.next.after.
 *
 * @param {string} token
 * @returns {Promise<Array<{id:string, properties:object}>>}
 */
async function fetchOptedInAlumni(token) {
  const url = 'https://api.hubapi.com/crm/v3/objects/contacts/search';
  const results = [];
  let after = undefined;

  for (;;) {
    const body = {
      filterGroups: [
        {
          filters: [
            { propertyName: 'course_status', operator: 'EQ', value: 'graduated' },
            { propertyName: 'alumni_opt_in', operator: 'EQ', value: 'true' }
          ]
        }
      ],
      properties: ['firstname', 'company', 'course_repo_url', 'email'],
      limit: 100
    };
    if (after) body.after = after;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error('hubspot_search_failed: ' + res.status);
      err.status = res.status;
      err.body = text;
      throw err;
    }

    const data = await res.json().catch(() => ({}));
    const page = Array.isArray(data.results) ? data.results : [];
    for (const r of page) results.push(r);

    const next = data.paging && data.paging.next && data.paging.next.after;
    if (!next) break;
    after = next;
  }

  return results;
}

// ── GitHub ───────────────────────────────────────────────────

/**
 * Fetches the most recent commit's committer date for a repo.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {string} token
 * @returns {Promise<{ status: 'ok', lastCommitDate: string } |
 *                  { status: 'repo_missing' } |
 *                  { status: 'auth_failed' } |
 *                  { status: 'error', code: number }>}
 */
async function fetchLastCommitDate(owner, repo, token) {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?per_page=1`;

  async function doFetch() {
    return fetch(url, {
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'cto-on-demand-brain-health'
      }
    });
  }

  let res = await doFetch();

  // One retry with exponential backoff on rate-limit (429) only.
  if (res.status === 429) {
    await new Promise(r => setTimeout(r, 2000));
    res = await doFetch();
  }

  if (res.status === 404) return { status: 'repo_missing' };
  if (res.status === 403 || res.status === 401) return { status: 'auth_failed' };
  if (!res.ok) return { status: 'error', code: res.status };

  const data = await res.json().catch(() => null);
  if (!Array.isArray(data) || data.length === 0) {
    // Repo exists but has no commits → treat as stagnant-eligible
    // with no date → fall through as repo_missing for v1 (an empty
    // brain repo is itself a flag worth surfacing).
    return { status: 'repo_missing' };
  }

  const date =
    (data[0].commit && data[0].commit.committer && data[0].commit.committer.date) ||
    (data[0].commit && data[0].commit.author && data[0].commit.author.date) ||
    null;

  if (!date) return { status: 'error', code: 0 };
  return { status: 'ok', lastCommitDate: date };
}

// ── Slack ────────────────────────────────────────────────────

// Slack post — degrades silently on ANY failure (network error,
// 5xx, etc) per eng-review S2-1. The cron must not turn red just
// because Slack is having a moment. Caller checks the .ok field.
async function postToSlack(webhookUrl, payload) {
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    console.error(`${LOG_PREFIX} slack_network_error message=${err && err.message}`);
    return { ok: false, status: 0, error: err && err.message };
  }
}

// ── Main ─────────────────────────────────────────────────────

function daysBetween(laterMs, earlierMs) {
  return Math.floor((laterMs - earlierMs) / (1000 * 60 * 60 * 24));
}

async function main() {
  const required = ['HUBSPOT_TOKEN', 'GITHUB_COHORT_TOKEN', 'SLACK_WEBHOOK_URL'];
  for (const key of required) {
    if (!process.env[key]) {
      console.error(`${LOG_PREFIX} env_missing key=${key}`);
      console.error(`Missing required env var: ${key}`);
      process.exit(1);
    }
  }

  const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;
  const GITHUB_COHORT_TOKEN = process.env.GITHUB_COHORT_TOKEN;
  const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
  const STAGNANT_DAYS = parseInt(process.env.STAGNANT_DAYS || '60', 10);
  const DRY_RUN = String(process.env.DRY_RUN || 'false').toLowerCase() === 'true';

  console.log(`${LOG_PREFIX} start threshold_days=${STAGNANT_DAYS} dry_run=${DRY_RUN}`);

  // Step 1: HubSpot
  let alumni;
  try {
    alumni = await fetchOptedInAlumni(HUBSPOT_TOKEN);
  } catch (err) {
    console.error(`${LOG_PREFIX} hubspot_error status=${err.status || 'n/a'} message=${err.message}`);
    process.exit(0); // degrade silently — the cron should not turn red
    return;
  }

  if (alumni.length === 0) {
    console.log(`${LOG_PREFIX} no_opted_in_alumni`);
    console.log('No opted-in alumni yet — exiting.');
    process.exit(0);
    return;
  }

  console.log(`${LOG_PREFIX} hubspot_fetched count=${alumni.length}`);

  // Step 2: per-alumni GitHub poll
  const now = new Date();
  const nowMs = now.getTime();
  const stagnant = [];
  const summary = { checked: 0, stagnant: 0, repo_missing: 0, auth_failed: 0, error: 0, skipped: 0 };

  for (const contact of alumni) {
    const props = contact.properties || {};
    const firstname = props.firstname || '(unknown)';
    const company = props.company || '';
    const repoUrl = props.course_repo_url;

    summary.checked++;

    if (!repoUrl) {
      console.log(`${LOG_PREFIX} skip_no_repo firstname="${firstname}"`);
      summary.skipped++;
      continue;
    }

    const parsed = parseRepoUrl(repoUrl);
    if (!parsed) {
      console.log(`${LOG_PREFIX} skip_invalid_repo_url firstname="${firstname}" url="${repoUrl}"`);
      summary.skipped++;
      continue;
    }

    let result;
    try {
      result = await fetchLastCommitDate(parsed.owner, parsed.repo, GITHUB_COHORT_TOKEN);
    } catch (err) {
      console.log(`${LOG_PREFIX} github_fetch_threw firstname="${firstname}" repo="${parsed.owner}/${parsed.repo}" message=${err.message}`);
      summary.error++;
      continue;
    }

    if (result.status === 'repo_missing') {
      console.log(`${LOG_PREFIX} REPO_MISSING firstname="${firstname}" repo="${parsed.owner}/${parsed.repo}"`);
      summary.repo_missing++;
      continue;
    }
    if (result.status === 'auth_failed') {
      console.log(`${LOG_PREFIX} GITHUB_AUTH_FAILED firstname="${firstname}" repo="${parsed.owner}/${parsed.repo}"`);
      summary.auth_failed++;
      continue;
    }
    if (result.status === 'error') {
      console.log(`${LOG_PREFIX} github_error firstname="${firstname}" repo="${parsed.owner}/${parsed.repo}" code=${result.code}`);
      summary.error++;
      continue;
    }

    const lastCommitDate = result.lastCommitDate;
    const lastMs = new Date(lastCommitDate).getTime();
    const daysStagnant = daysBetween(nowMs, lastMs);

    if (isStagnant(lastCommitDate, STAGNANT_DAYS, now)) {
      summary.stagnant++;
      stagnant.push({
        firstname,
        company,
        repo: `${parsed.owner}/${parsed.repo}`,
        days_stagnant: daysStagnant,
        last_commit_date: lastCommitDate
      });
      console.log(`${LOG_PREFIX} stagnant firstname="${firstname}" repo="${parsed.owner}/${parsed.repo}" days=${daysStagnant}`);
    } else {
      console.log(`${LOG_PREFIX} fresh firstname="${firstname}" repo="${parsed.owner}/${parsed.repo}" days=${daysStagnant}`);
    }
  }

  // Step 3: decide on Slack post
  if (stagnant.length === 0) {
    console.log(
      `${LOG_PREFIX} summary checked=${summary.checked} stagnant=0 ` +
      `repo_missing=${summary.repo_missing} auth_failed=${summary.auth_failed} ` +
      `error=${summary.error} skipped=${summary.skipped}`
    );
    process.exit(0);
    return;
  }

  const msg = formatSlackMessage(stagnant, STAGNANT_DAYS);

  if (DRY_RUN) {
    console.log(`${LOG_PREFIX} dry_run_message:`);
    console.log(msg.text);
    console.log(
      `${LOG_PREFIX} summary checked=${summary.checked} stagnant=${summary.stagnant} ` +
      `repo_missing=${summary.repo_missing} auth_failed=${summary.auth_failed} ` +
      `error=${summary.error} skipped=${summary.skipped}`
    );
    process.exit(0);
    return;
  }

  try {
    const slack = await postToSlack(SLACK_WEBHOOK_URL, msg);
    if (slack.ok) {
      console.log(`${LOG_PREFIX} slack_notified count=${stagnant.length}`);
    } else {
      console.error(`${LOG_PREFIX} slack_post_failed status=${slack.status}`);
    }
  } catch (err) {
    console.error(`${LOG_PREFIX} slack_post_threw message=${err.message}`);
    // Degrade silently per S2-1 — do not fail the cron.
  }

  console.log(
    `${LOG_PREFIX} summary checked=${summary.checked} stagnant=${summary.stagnant} ` +
    `repo_missing=${summary.repo_missing} auth_failed=${summary.auth_failed} ` +
    `error=${summary.error} skipped=${summary.skipped}`
  );
  process.exit(0);
}

// ── Exports for unit tests (E8) ──────────────────────────────
module.exports = {
  __test: {
    isStagnant,
    parseRepoUrl,
    formatSlackMessage,
    fetchOptedInAlumni,
    fetchLastCommitDate,
    postToSlack
  }
};

// ── Entry point ──────────────────────────────────────────────
if (require.main === module) {
  main().catch(err => {
    console.error(`${LOG_PREFIX} fatal message=${err && err.message}`);
    // Degrade silently — cron should not turn red on transient errors.
    process.exit(0);
  });
}
