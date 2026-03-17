#!/usr/bin/env bash
# scripts/subtree-setup.sh
# One-time setup: create remote GitHub repos, split each service subtree, and push.
# Prerequisites: gh CLI installed and authenticated (gh auth login)
# Run from repo root: ./scripts/subtree-setup.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

GITHUB_USER="${GITHUB_USER:-davcs86}"

declare -A SERVICE_DESCRIPTIONS=(
  [xstockstrat-trading]="Order execution and trade lifecycle service (Go, gRPC port 50051)"
  [xstockstrat-portfolio]="Position tracking and P&L service (Go, gRPC port 50052)"
  [xstockstrat-marketdata]="Alpaca feed ingestion and OHLCV storage (Go, gRPC port 50053)"
  [xstockstrat-indicators]="Formula engine and sandboxed execution (Python, gRPC port 50054)"
  [xstockstrat-ingest]="Raw data normalization and event publishing (Python, gRPC port 50055)"
  [xstockstrat-analysis]="Strategy scoring and backtesting (Python, gRPC port 50056)"
  [xstockstrat-ledger]="Append-only event store (Node.js, gRPC port 50057)"
  [xstockstrat-identity]="Auth, API keys, and JWT (Node.js, gRPC port 50058)"
  [xstockstrat-notify]="gRPC streaming alert delivery (Node.js, gRPC port 50059)"
  [xstockstrat-config]="Live config WatchConfig gRPC stream (Node.js, gRPC port 50060)"
  [xstockstrat-trader]="Trading UI frontend (Next.js, port 3000)"
  [xstockstrat-insights]="Analytics and insights dashboard (Next.js, port 3001)"
)

SERVICES=(
  xstockstrat-trading
  xstockstrat-portfolio
  xstockstrat-marketdata
  xstockstrat-indicators
  xstockstrat-ingest
  xstockstrat-analysis
  xstockstrat-ledger
  xstockstrat-identity
  xstockstrat-notify
  xstockstrat-config
  xstockstrat-trader
  xstockstrat-insights
)

echo "======================================================"
echo " xstockstrat git subtree setup"
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

echo "GitHub user: $GITHUB_USER"
echo ""

for svc in "${SERVICES[@]}"; do
  prefix="services/$svc"
  branch="split/$svc"

  echo "------------------------------------------------------"
  echo "Service: $svc"

  # 1. Create GitHub repo if it doesn't exist
  if gh repo view "$GITHUB_USER/$svc" &>/dev/null 2>&1; then
    echo "  [skip] Remote repo already exists: $GITHUB_USER/$svc"
  else
    echo "  [create] Creating GitHub repo: $GITHUB_USER/$svc"
    gh repo create "$GITHUB_USER/$svc" \
      --private \
      --description "${SERVICE_DESCRIPTIONS[$svc]}" \
      --confirm 2>/dev/null || \
    gh repo create "$GITHUB_USER/$svc" \
      --private \
      --description "${SERVICE_DESCRIPTIONS[$svc]}" 2>/dev/null || true
    echo "  [ok] Repo created"
  fi

  # 2. Ensure remote is registered
  if git remote get-url "$svc" &>/dev/null 2>&1; then
    echo "  [skip] Remote already registered: $svc"
  else
    git remote add "$svc" "https://github.com/$GITHUB_USER/${svc}.git"
    echo "  [ok] Remote added"
  fi

  # 3. Split the subtree into a local branch
  echo "  [split] Splitting prefix=$prefix into branch=$branch ..."
  git subtree split --prefix="$prefix" -b "$branch"
  echo "  [ok] Split complete"

  # 4. Push the split branch to the service repo's main
  echo "  [push] Pushing $branch → $svc/main ..."
  git push "$svc" "$branch:main"
  echo "  [ok] Pushed"

  # 5. Clean up the temporary local split branch
  git branch -D "$branch"
  echo "  [ok] Cleaned up local split branch"

  echo ""
done

echo "======================================================"
echo " Setup complete! All 12 service repos are live."
echo " Use ./scripts/subtree-sync.sh to push/pull changes."
echo "======================================================"
