#!/usr/bin/env bash
# scripts/setup-branch-protection.sh
# One-time setup: configure branch protection rules on main-dev and main.
# Requires the CI workflow (.github/workflows/ci.yml) to already exist so GitHub
# recognises the "CI / Proto lint and breaking check" status check context.
# Prerequisites: gh CLI installed and authenticated (gh auth login)
# Run from repo root: ./scripts/setup-branch-protection.sh

set -euo pipefail

GITHUB_USER="${GITHUB_USER:-davcs86}"
REPO="xstockstrat-orchestration"

# The check context must match: workflow name / job name from ci.yml
#   name: CI  →  jobs.proto-lint.name: Proto lint and breaking check
CI_CHECK="CI / Proto lint and breaking check"

echo "======================================================"
echo " xstockstrat branch protection setup"
echo " Repo: $GITHUB_USER/$REPO"
echo "======================================================"
echo ""

# Check prerequisites
if ! command -v gh &>/dev/null; then
  echo "ERROR: gh CLI not found. Install from https://cli.github.com and run 'gh auth login'."
  exit 1
fi

if ! gh auth status &>/dev/null; then
  echo "ERROR: gh CLI not authenticated. Run 'gh auth login' first."
  exit 1
fi

protect_branch() {
  local branch="$1"
  echo "Applying protection to: $branch"

  gh api \
    --method PUT \
    "repos/$GITHUB_USER/$REPO/branches/$branch/protection" \
    --input - <<EOF
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["$CI_CHECK"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true
  },
  "restrictions": null
}
EOF

  echo "  [ok] $branch protected"
  echo ""
}

protect_branch "main-dev"
protect_branch "main"

echo "======================================================"
echo " Done. Branch protection active on main-dev and main."
echo ""
echo " Rules applied to both branches:"
echo "   - Required status check: $CI_CHECK"
echo "   - Branch must be up-to-date before merging (strict)"
echo "   - 1 approving review required"
echo "   - Stale reviews dismissed on new commits"
echo "   - Direct pushes blocked"
echo "======================================================"
