#!/usr/bin/env bash
# scripts/security-audit.sh
# Audits git history across all branches for accidentally committed secrets.
# Mirrors the maintainer checks in CONTRIBUTING.md §Security Audit.
#
# Usage:
#   ./scripts/security-audit.sh             # fetch all refs, then scan
#   ./scripts/security-audit.sh --no-fetch  # skip git fetch (use local refs only)
#
# Exits 1 if any pattern matches commits in any ref. If matches are found,
# follow the git filter-repo procedure in CONTRIBUTING.md to scrub them from
# history before publishing the repo.

set -euo pipefail

NO_FETCH=0
for arg in "$@"; do
  case "$arg" in
  --no-fetch) NO_FETCH=1 ;;
  -h | --help)
    sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  *)
    echo "Unknown argument: $arg" >&2
    exit 1
    ;;
  esac
done

# Format: "label|pattern" — kept in sync with CONTRIBUTING.md §Security Audit.
PATTERNS=(
  "AWS access key (AKIA...)|AKIA"
  "GitHub PAT (ghp_...)|ghp_"
  "GitLab token (glpat-...)|glpat-"
  "Stripe live key (sk_live_...)|sk_live_"
  "PEM private key header|-----BEGIN"
  "Internal dev DB password|devpassword"
)

if [ "$NO_FETCH" -eq 0 ]; then
  echo "Fetching all remote refs so --all covers main and main-dev..."
  if ! git fetch --all --quiet; then
    echo "WARNING: git fetch --all failed; continuing with local refs only." >&2
  fi
  echo ""
fi

echo "Scanning history of all refs for secret patterns..."
echo ""

FOUND=0
for entry in "${PATTERNS[@]}"; do
  label="${entry%%|*}"
  pattern="${entry#*|}"
  matches=$(git log -S "$pattern" --all --oneline 2>/dev/null || true)
  if [ -n "$matches" ]; then
    FOUND=1
    echo "  ✗ $label — matches found:"
    while IFS= read -r line; do echo "      $line"; done <<<"$matches"
    echo ""
  else
    echo "  ✓ $label — no matches"
  fi
done

echo ""
if [ "$FOUND" -eq 1 ]; then
  echo "ERROR: potential secrets found in git history."
  echo "       See CONTRIBUTING.md §Security Audit for the git filter-repo"
  echo "       procedure to scrub these before publishing the repo."
  exit 1
fi

echo "All clear — no secret patterns found in any branch's history."
exit 0
