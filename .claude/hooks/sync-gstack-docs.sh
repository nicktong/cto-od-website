#!/usr/bin/env bash
# Mirror this project's gstack artefacts into the repo's docs/gstack/ folder.
# Wired via .claude/settings.json PostToolUse hook so any time a gstack skill
# (review, qa, plan-eng-review, plan-design-review, design-shotgun, etc.) writes
# a new artefact under ~/.gstack/projects/<slug>/, it shows up in /docs/gstack.
#
# Idempotent. Cheap. Silent on no-ops. Logs to .claude/hooks/sync-gstack-docs.log
# only when it actually copies something.

set -euo pipefail

GSTACK_SLUG="nicktong-cto-od-website"
SRC="${HOME}/.gstack/projects/${GSTACK_SLUG}"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
DEST="${PROJECT_DIR}/docs/gstack"
LOG="${PROJECT_DIR}/.claude/hooks/sync-gstack-docs.log"

[[ -d "$SRC" ]] || exit 0
mkdir -p "$DEST"

# --itemize-changes gives one line per changed file; we use that to decide
# whether to log. Excludes mirror private/local-only state.
CHANGES="$(rsync -ai \
  --exclude='repo-mode.json' \
  --exclude='timeline.jsonl' \
  --exclude='.brain-sync-queue*' \
  "$SRC"/ "$DEST"/ 2>/dev/null | grep -vE '^\.' || true)"

if [[ -n "$CHANGES" ]]; then
  {
    printf '[%s] synced from %s\n' "$(date -u +%FT%TZ)" "$SRC"
    printf '%s\n\n' "$CHANGES"
  } >> "$LOG"
fi

exit 0
