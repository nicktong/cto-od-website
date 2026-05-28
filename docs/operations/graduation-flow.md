# Cohort Graduation Operational Flow

> The Week 6 operational sequence for graduating a course cohort. The order matters
> because the Sprint pipeline auto-routing (`api/sales-agent.js` MODE 2) fires the
> moment `course_status` flips to `graduated`. If consent isn't recorded first, the
> system scans a participant's repo before they've agreed to that scanning.

## The rule

**Consent FIRST. `course_status` flip SECOND.**

Never flip a contact's `course_status` to `graduated` until that contact has submitted
the graduation form. The form is the consent paper trail; the status flip is the
trigger.

## The sequence (per participant)

1. **Week 6 last live session** — the cohort goes through the handover doc together
   and you run the closing retrospective. Mention the graduation form will arrive
   in their inbox at end of session.

2. **Send the graduation form** at the end of the session. The form captures:

   | Field | Purpose | HubSpot property mapped to |
   |---|---|---|
   | Confirmation that they have completed the cohort | Receipt | (logged in form submission, no property) |
   | Case study consent (yes / no / "needs revisions before public") | Whether `scripts/draft-case-study.js` should run for this person | (no property — Nick checks form responses directly) |
   | `alumni_opt_in` (yes / no) | Whether the Brain Health Dashboard polls their repo + sends Brain MOT outreach | `alumni_opt_in` (boolean) |
   | `alumni_show_publicly` (yes / no) | Whether their name + repo URL appears on the future `/course/cohort-1/` alumni page (E1 deferred) | `alumni_show_publicly` (boolean) |
   | Anything else they want Nick to know | Free text | (logged, no property) |

3. **Wait until the participant submits the form.** Don't flip status preemptively.
   If a participant hasn't submitted within 5 days of the last session, send a
   friendly nudge. If they haven't submitted within 14 days, set `course_status` to
   `declined` and move on. Treat non-response as a soft no.

4. **Review the form submission.** Look for anything that needs handling before the
   Sprint pipeline runs (e.g. a participant who says "case study is fine but please
   don't mention my company name" — set up the case-study draft with that constraint).

5. **In HubSpot, on the participant's contact record:**
   1. Set `alumni_opt_in` per form response.
   2. Set `alumni_show_publicly` per form response.
   3. Set `course_repo_url` to the participant's actual repo URL if not already set.
   4. Set `course_status` = `graduated`. **This is the trigger** — the webhook fires
      immediately. `api/sales-agent.js` MODE 2 (Sprint pipeline) runs within ~10s.

6. **Within ~30 seconds:** check the participant's contact timeline in HubSpot. A
   new Note tagged `[sprint-pipeline-v1]` should appear with:
   - Sprint-readiness score (1-5)
   - 2-3 evidence signals from their repo
   - A 3-5 sentence draft outreach email

   The Note is private to Nick. The participant does not see it. If you want to send
   the Sprint outreach, edit and send the draft. If you don't, ignore it.

7. **If something looks wrong** (e.g. `[sprint-pipeline-v1] ERROR: ...`), check the
   error message:
   - `course_repo_url missing or invalid` → fix the property on the contact and
     manually re-flip `course_status` to trigger the webhook again (HubSpot fires
     on every change, even if you change it to the same value via a brief flip to
     `enrolled` and back).
   - `GitHub access denied (403)` → `GITHUB_COHORT_TOKEN` has expired or you aren't
     a collaborator on `${owner}/${repo}`. Renew the PAT or accept the collab invite.
   - `GITHUB_COHORT_TOKEN env var missing` → set it in Vercel and redeploy.
   - `Claude API call failed` → check Anthropic status. Retry by re-flipping.

## Why this order matters

UK GDPR requires explicit consent for personal-data processing where legitimate
interest isn't the lawful basis. Scanning a participant's private repo + sending
their data to Anthropic for processing + writing a Sprint-readiness Note about them
all rely on explicit consent in this design (see GDPR / Consent Specification in the
CEO plan).

Flipping `course_status` BEFORE the form is submitted means the agent processes a
contact whose consent hasn't been recorded yet. The legal exposure is small (the Note
is internal-only, not student-facing) but the posture is wrong. The form is cheap to
require; the consent paper trail is permanent.

## Cohort 1 specifics

- 10 graduates (one cohort).
- Process participants **one at a time** over Week 6 / Week 7 — not in a batch.
  HubSpot webhooks can deliver multiple property-change events in one POST, and if
  total processing exceeds `maxDuration: 60` on Vercel the whole batch retries.
  One-at-a-time keeps each webhook delivery to a single event.
- Allow ~15 minutes per participant for the review-form-then-flip step.
- Expected total Week 6 effort: ~2.5 hours over a couple of days.

## Cohort 2 onwards

When Cohort 2 graduates (14 participants), reconsider:
- Should the form be sent earlier (Week 5) so submissions arrive throughout Week 6?
- Should the Sprint pipeline move to a Vercel Background Function so batches don't
  worry about the 60s timeout?
- Should `scripts/draft-case-study.js` be triggered automatically by the
  `course_status=graduated` webhook instead of manually?

These are deferred decisions — make them after Cohort 1 produces real data.

## Related files

- `api/sales-agent.js` — MODE 2 (Sprint pipeline) implementation
- `scripts/draft-case-study.js` — manual case-study generator (Nick runs per participant)
- `scripts/brain-health-check.js` — daily cron that polls opted-in alumni
- `~/.gstack/projects/nicktong-cto-od-website/ceo-plans/2026-05-26-course-cohort-1.md` — full CEO plan with the GDPR / Consent Specification table
