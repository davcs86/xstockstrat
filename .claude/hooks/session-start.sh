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

# ---------------------------------------------------------------------------
# Plugin marketplace provisioning (Claude Code on the web).
# The local CLI auto-registers marketplaces declared in .claude/settings.json
# (extraKnownMarketplaces) at startup, so its project-scoped enabledPlugins
# resolve and load. The web/remote provisioner does NOT run that registration,
# leaving enabledPlugins unresolved — context-forge (/context-scrubber,
# /context-constitution) and design-buddy are then absent from web sessions.
# Bridge it: register each declared marketplace so settings.json enabledPlugins
# take effect (no explicit `plugin install` needed — enabling the marketplace
# is the single missing step). The harness re-resolves plugins after this hook
# runs, so a registration here loads the plugins into the session.
#
# `claude` MUST be invoked by absolute path, not found via PATH: at COLD START
# the web hook environment has a minimal PATH that excludes the CLI, so a bare
# `command -v claude` guard fails and the whole block silently no-ops (it only
# ever fired on RESUME, whose PATH happens to include claude). Resolve the
# binary through CLAUDE_CODE_EXECPATH with fallbacks instead. Idempotent +
# best-effort: an already-registered marketplace is skipped and any failure
# never aborts session start.
# ---------------------------------------------------------------------------
_SETTINGS="${CLAUDE_PROJECT_DIR:-$(git -C "$(dirname "$0")" rev-parse --show-toplevel)}/.claude/settings.json"

# Resolve a runnable `claude` binary without depending on PATH (see note above).
_claude=""
for _cand in "${CLAUDE_CODE_EXECPATH:-}" "$(command -v claude 2>/dev/null || true)" \
  /opt/claude-code/bin/claude /opt/node22/bin/claude; do
  if [ -n "$_cand" ] && [ -x "$_cand" ]; then
    _claude="$_cand"
    break
  fi
done
_jq="$(command -v jq 2>/dev/null || true)"
[ -x "$_jq" ] || _jq="/usr/bin/jq"

if [ -n "$_claude" ] && [ -x "$_jq" ] && [ -f "$_SETTINGS" ]; then
  _known_marketplaces="$("$_claude" plugin marketplace list 2>/dev/null || true)"
  while IFS=$'\t' read -r _mp_name _mp_repo; do
    [ -n "$_mp_name" ] || continue
    if printf '%s\n' "$_known_marketplaces" | grep -qF "$_mp_name"; then
      continue # already registered (local CLI, or an earlier provisioning pass)
    fi
    echo "[session-start] Registering plugin marketplace: $_mp_name ($_mp_repo)"
    if ! "$_claude" plugin marketplace add "$_mp_repo" >/dev/null 2>&1; then
      echo "[session-start] WARNING: failed to register marketplace $_mp_name ($_mp_repo) — plugins from it will be unavailable"
    fi
  done < <("$_jq" -r '
      (.extraKnownMarketplaces // {}) | to_entries[]
      | select(.value.source.source == "github")
      | [.key, .value.source.repo] | @tsv
    ' "$_SETTINGS" 2>/dev/null || true)
fi

SKILLS_DIR="${CLAUDE_PROJECT_DIR:-$(git -C "$(dirname "$0")" rev-parse --show-toplevel)}/.claude/skills"

[ -d "$SKILLS_DIR" ] || exit 0

MAX_DESC=55 # max chars for description column
MAX_INV=40  # max chars for invocation column

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
