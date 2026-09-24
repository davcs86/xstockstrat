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
