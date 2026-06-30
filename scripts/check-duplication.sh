#!/usr/bin/env bash
# scripts/check-duplication.sh
# Language-agnostic copy-paste / clone guard rail (the structural half of the DRY guard
# rail — see docs/patterns/dry-guard-rail.md). Wraps jscpd, which tokenizes TS/JS, Go,
# Python, etc. and flags duplicated blocks (helper functions, type blocks, constant blocks).
#
#   ./scripts/check-duplication.sh [PATH ...]
#       Scan PATH(s) (default: services/ packages/) and FAIL (exit 1) on any duplication
#       above the .jscpd.json threshold. Used by the pre-commit hook for the UI.
#
#   DUP_REPORT_ONLY=1 ./scripts/check-duplication.sh [PATH ...]
#       Same scan, but always exit 0 — prints the report as an advisory warning. Used for
#       the not-yet-enforced areas (Go / Python / Node) during rollout.
#
# Invoked by the husky pre-commit hook, runnable by hand, and by the dry-reviewer subagent.
# macOS bash 3.2 + BSD/GNU compatible (no GNU-only flags).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# jscpd is a root devDependency; prefer the workspace binary, fall back to npx.
run_jscpd() {
  if pnpm exec jscpd --version >/dev/null 2>&1; then
    pnpm exec jscpd "$@"
  else
    npx --yes jscpd "$@"
  fi
}

# Default scan scope when no path args are given.
if [ "$#" -eq 0 ]; then
  set -- services packages
fi

REPORT_ONLY="${DUP_REPORT_ONLY:-0}"

# Enforced mode fails on ANY clone (--threshold 0). Report-only mode just prints the report.
THRESHOLD_ARGS="--threshold 0"
if [ "$REPORT_ONLY" = "1" ]; then
  THRESHOLD_ARGS=""
fi

echo "Scanning for code duplication (jscpd) in: $*"

status=0
# shellcheck disable=SC2086
run_jscpd --config "$REPO_ROOT/.jscpd.json" $THRESHOLD_ARGS "$@" || status=$?

# Report-only: jscpd ran without --threshold, so it always exits 0. We can't tell "clean" from
# "found clones" by exit code here — point the reader at the report above and never block.
if [ "$REPORT_ONLY" = "1" ]; then
  echo "Report-only mode (non-blocking) — review the jscpd report above for any duplication."
  exit 0
fi

if [ "$status" -eq 0 ]; then
  echo "OK - no duplication above threshold."
  exit 0
fi

echo "FAILED - duplication above threshold. Extract the repeated code into a shared module,"
echo "         or run with DUP_REPORT_ONLY=1 to treat it as advisory."
exit "$status"
