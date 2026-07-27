#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Playwright browser validation — verify Chromium is launchable for E2E.
# Chromium ships pre-installed in the container image; Firefox is not needed
# (dropped in CI and sandbox environments). PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
# is set by the environment so all playwright commands resolve against that directory.
# ---------------------------------------------------------------------------
_PW_BROWSERS="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
_UI_DIR="${CLAUDE_PROJECT_DIR:-$(git -C "$(dirname "$0")" rev-parse --show-toplevel)}/services/xstockstrat-ui"

# Validate pre-installed Chromium is launchable (Firefox not needed — dropped in
# CI and sandbox environments). Surfaces issues at session start instead of mid-suite.
if [ -d "$_UI_DIR/node_modules/.bin" ]; then
  _CHROME=""
  if [ -L "$_PW_BROWSERS/chromium" ] || [ -f "$_PW_BROWSERS/chromium" ]; then
    _CHROME="$_PW_BROWSERS/chromium"
  elif [ -n "$(find "$_PW_BROWSERS" -maxdepth 1 -name 'chromium-*' -print -quit 2>/dev/null)" ]; then
    _CHROME="$(find "$_PW_BROWSERS" -maxdepth 2 -name 'chrome' -path '*/chrome-linux/*' -print -quit 2>/dev/null)"
  fi
  if [ -n "$_CHROME" ] && [ -x "$_CHROME" ]; then
    echo "[session-start] Chromium: $("$_CHROME" --version 2>/dev/null || echo 'present but not launchable')"
  else
    echo "[session-start] WARNING: No launchable Chromium found under $_PW_BROWSERS"
    echo "[session-start] E2E tests may fail. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH manually."
  fi
fi

SKILLS_DIR="${CLAUDE_PROJECT_DIR:-$(git -C "$(dirname "$0")" rev-parse --show-toplevel)}/.claude/skills"

[ -d "$SKILLS_DIR" ] || exit 0

MAX_DESC=55 # max chars for description column
MAX_INV=40 # max chars for invocation column

# Collect rows as parallel arrays
invocations=()
descs=()

while IFS= read -r -d '' skill_file; do
  name=$(basename "$(dirname "$skill_file")")
  # Use awk to extract frontmatter fields (avoids pipe-in-value issues)
  hint=$(awk '/^argument-hint:/{sub(/^argument-hint:[[:space:]]*/,""); print; exit}' "$skill_file")
  desc=$(awk '/^description:/{sub(/^description:[[:space:]]*/,""); gsub(/\. .*/,""); print; exit}' "$skill_file")

  if [ -z "$hint" ] || [ "$hint" = "(no arguments)" ]; then
    inv="/$name"
  else
    inv="/$name $hint"
  fi
  if [ ${#inv} -gt $MAX_INV ]; then
    inv="${inv:0:$((MAX_INV - 1))}…"
  fi
  invocations+=("$inv")

  # Truncate long descriptions
  if [ ${#desc} -gt $MAX_DESC ]; then
    desc="${desc:0:$((MAX_DESC - 1))}…"
  fi
  descs+=("$desc")
done < <(find "$SKILLS_DIR" -name "SKILL.md" -print0 | sort -z)

[ ${#invocations[@]} -eq 0 ] && exit 0

# Measure max invocation width
max_inv=0
for inv in "${invocations[@]}"; do
  [ ${#inv} -gt "$max_inv" ] && max_inv=${#inv}
done

max_desc=0
for desc in "${descs[@]}"; do
  [ ${#desc} -gt "$max_desc" ] && max_desc=${#desc}
done

echo "SDD Skills:"
for i in "${!invocations[@]}"; do
  inv="${invocations[$i]}"
  desc="${descs[$i]}"
  printf '  %-*s  %s\n' "$max_inv" "$inv" "$desc"
done
