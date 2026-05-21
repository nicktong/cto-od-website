# docs

Project documentation for `ctoondemand.co.uk`.

## Layout

- **`gstack/`** — Auto-mirrored from `~/.gstack/projects/nicktong-cto-od-website/`.
  Contains review reports, eng/design/devex plan reviews, QA outputs, design-shotgun
  generations, and the JSONL review logs that gstack skills emit.

## How the gstack mirror stays current

A PostToolUse hook (`.claude/hooks/sync-gstack-docs.sh`, wired via
`.claude/settings.json`) runs after every `Bash` tool call and rsyncs new
artefacts from the user's local gstack home into `docs/gstack/`.

It is:

- **Idempotent** — only writes when files actually change.
- **Project-scoped** — only mirrors `nicktong-cto-od-website`, not other repos
  that share the same `~/.gstack` home.
- **Silent on no-op** — only appends to `.claude/hooks/sync-gstack-docs.log`
  when it copies something, so the log doubles as an audit trail.

If you need to disable it temporarily, comment out the `PostToolUse` block in
`.claude/settings.json`. To run it once by hand:

```bash
.claude/hooks/sync-gstack-docs.sh
```

## Current contents

- `gstack/nicktong-claude-magical-payne-fcfac3-eng-review-test-plan-20260519-235731.md`
  — eng-review test plan for the `/book` booking page (the GSTACK REVIEW REPORT).
- `gstack/tasks-eng-review-*.jsonl` — line-delimited eng-review tasks.
- `gstack/tasks-design-review-*.jsonl` — line-delimited design-review tasks.
- `gstack/claude*-reviews.jsonl` — per-branch review event log (ship/plan-eng/plan-design outcomes).
- `gstack/designs/` — design-shotgun generations.
