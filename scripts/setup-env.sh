#!/usr/bin/env bash
# scripts/setup-env.sh
# Interactive .env setup guide for xstockstrat-orchestration development
#
# This script guides new developers through creating and configuring a .env file
# with the correct values for local development. It validates inputs and provides
# context for each required variable.
#
# Usage:
#   ./scripts/setup-env.sh            # interactive mode
#   ./scripts/setup-env.sh --defaults # use all defaults (devpassword, etc.)
#   ./scripts/setup-env.sh --skip     # skip if .env exists

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"
ENV_EXAMPLE="$REPO_ROOT/.env.example"

# ── Color helpers ──────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()      { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()     { echo -e "${RED}[ERROR]${NC} $*" >&2; }
section() { echo -e "\n${BOLD}${CYAN}===> $*${NC}"; }

# ── Skip in CI environments ────────────────────────────────────────────────────
if [ -n "${CI:-}" ] || [ -n "${GITHUB_ACTIONS:-}" ]; then
  err "This script is for local development only."
  err "In CI environments, secrets are injected via GitHub Actions."
  err "See: .github/workflows/ci.yml"
  exit 1
fi

# ── Check if .env exists ───────────────────────────────────────────────────────
if [ -f "$ENV_FILE" ]; then
  case "${1:-}" in
    --skip) ok ".env already exists — skipping setup."; exit 0 ;;
    *) warn ".env already exists. Continuing will overwrite it."; ;;
  esac
fi

# ── Parse flags ────────────────────────────────────────────────────────────────
USE_DEFAULTS=false
for arg in "$@"; do
  case "$arg" in
    --defaults) USE_DEFAULTS=true ;;
    --skip) ;;  # handled above
    *) err "Unknown flag: $arg"; exit 1 ;;
  esac
done

# ── Helper functions ───────────────────────────────────────────────────────────
prompt_value() {
  local name="$1"
  local default="$2"
  local description="$3"
  local secret="${4:-false}"

  if [ "$USE_DEFAULTS" = true ]; then
    eval "${name}='${default}'"
    return
  fi

  echo ""
  echo -e "${BOLD}${name}${NC}"
  echo "  $description"
  [ -n "$default" ] && echo "  Default: ${CYAN}${default}${NC}"

  local prompt_char="→"
  if [ "$secret" = true ]; then
    prompt_char="→ (hidden)"
  fi

  local user_input
  while true; do
    echo -n "  $prompt_char "
    if [ "$secret" = true ]; then
      read -rs user_input
      echo ""  # newline after hidden input
    else
      read -r user_input
    fi

    if [ -z "$user_input" ]; then
      [ -n "$default" ] && user_input="$default"
    fi

    if [ -z "$user_input" ]; then
      err "This value cannot be empty."
      continue
    fi

    break
  done

  eval "${name}='${user_input}'"
}

generate_jwt_secret() {
  if command -v openssl &>/dev/null; then
    openssl rand -hex 16
  else
    # Fallback: use /dev/urandom if openssl not available
    head -c 16 /dev/urandom | xxd -p | tr -d '\n'
  fi
}

# ═════════════════════════════════════════════════════════════════════════════
# Interactive Setup
# ═════════════════════════════════════════════════════════════════════════════

section "xstockstrat-orchestration — Environment Setup"

info "This script will create a .env file for local development."
info "Three-file convention:"
info "  • .env — NOT committed; secrets only (POSTGRES_PASSWORD, ALPACA_*, JWT_SECRET)"
info "  • .env.local — committed; structural config (APPLICATION_ENV, NODE_ENV, etc.)"
info "  • .env.fe.local — committed; frontend-only config (APP_URL)"
info ""
info "You only need to configure .env. The other two are pre-populated."
info ""

# ── Database Password ──────────────────────────────────────────────────────────
section "Database"

prompt_value POSTGRES_PASSWORD "devpassword" \
  "PostgreSQL password for local development.
  docker-compose will construct DATABASE_URL automatically.
  Use 'devpassword' for local dev; ignore for production (managed DB)." \
  true

# ── Alpaca Credentials ─────────────────────────────────────────────────────────
section "Alpaca Markets (Paper Trading)"

info "Used by xstockstrat-marketdata to stream market data and execute paper trades."
info "Get your Alpaca API credentials:"
info ""
info "  1. Visit https://app.alpaca.markets"
info "  2. Sign up or log in"
info "  3. Navigate: Account → API Keys"
info "  4. Copy your API Key and Secret"
info ""
info "For setup details, see: docs/setup/alpaca.md"
info ""

prompt_value ALPACA_API_KEY "" \
  "Your Alpaca API Key (starts with 'PK')." \
  true

prompt_value ALPACA_API_SECRET "" \
  "Your Alpaca API Secret (keep this safe!)." \
  true

# ── JWT Secret ─────────────────────────────────────────────────────────────────
section "JWT Secret"

info "Used by xstockstrat-identity for signing and verifying authentication tokens."
info ""

if [ "$USE_DEFAULTS" = true ]; then
  JWT_SECRET=$(generate_jwt_secret)
  info "Generated JWT_SECRET (non-interactive mode)"
else
  echo "Would you like to:"
  echo "  1) Generate a secure random secret automatically"
  echo "  2) Provide your own"
  echo ""
  echo -n "  → "
  read -r choice

  if [ "$choice" = "1" ]; then
    JWT_SECRET=$(generate_jwt_secret)
    ok "Generated secure JWT_SECRET"
  else
    prompt_value JWT_SECRET "" \
      "Your JWT secret (minimum 32 characters recommended)." \
      true
  fi
fi

# ── OpenTelemetry (Optional) ───────────────────────────────────────────────────
section "OpenTelemetry / Grafana Cloud (Optional)"

info "For local dev, OpenTelemetry is optional. Services work fine without it."
info "If you want to enable observability (traces, metrics, logs):"
info ""
info "  1. Create a Grafana Cloud account: https://grafana.com/products/cloud/"
info "  2. Create an OTLP token in Grafana Cloud"
info "  3. Paste the token and endpoint here"
info ""
info "To skip: just press Enter to leave empty."
info "Setup details: docs/setup/grafana-cloud.md"
info ""

prompt_value GRAFANA_OTLP_TOKEN "" \
  "Grafana Cloud OTLP token (base64-encoded instance ID and API key)." \
  true

# ─────────────────────────────────────────────────────────────────────────────
# Write .env File
# ─────────────────────────────────────────────────────────────────────────────

section "Writing .env file"

cat > "$ENV_FILE" << 'EOF'
# xstockstrat-orchestration — Environment Variables
# Generated by scripts/setup-env.sh
# ⚠️  NEVER commit this file to git — it contains secrets!

# ── Database ───────────────────────────────────────────────────────────────
# Local dev only. In production, DATABASE_URL is injected by DigitalOcean App Platform.
EOF

echo "POSTGRES_PASSWORD='$POSTGRES_PASSWORD'" >> "$ENV_FILE"

cat >> "$ENV_FILE" << 'EOF'

# ── Alpaca Credentials (xstockstrat-marketdata) ─────────────────────────
# Paper trading API key and secret. Get from: https://app.alpaca.markets/account/api-keys
EOF

echo "ALPACA_API_KEY='$ALPACA_API_KEY'" >> "$ENV_FILE"
echo "ALPACA_API_SECRET='$ALPACA_API_SECRET'" >> "$ENV_FILE"

cat >> "$ENV_FILE" << 'EOF'

# ── JWT (xstockstrat-identity) ─────────────────────────────────────────
# Secret for signing and verifying authentication tokens.
EOF

echo "JWT_SECRET='$JWT_SECRET'" >> "$ENV_FILE"

cat >> "$ENV_FILE" << 'EOF'

# ── OpenTelemetry (Optional) ────────────────────────────────────────────
# Leave empty to disable. Enable for Grafana Cloud observability.
EOF

[ -n "$GRAFANA_OTLP_TOKEN" ] && echo "GRAFANA_OTLP_TOKEN='$GRAFANA_OTLP_TOKEN'" >> "$ENV_FILE"

cat >> "$ENV_FILE" << 'EOF'

# ═════════════════════════════════════════════════════════════════════════
# GitHub Repository Secrets (NOT local .env — set in GitHub only)
# ═════════════════════════════════════════════════════════════════════════
# These variables must be added as repository secrets in GitHub:
# Settings → Secrets and variables → Actions
#
# Secret Name               Used by workflow            How to obtain
# ─────────────────────────────────────────────────────────────────────
# DIGITALOCEAN_ACCESS_TOKEN deploy-dev / deploy-prod    DigitalOcean API PAT
# DO_DEV_APP_ID             deploy-dev                  doctl apps list
# DO_PROD_APP_ID            deploy-prod                 doctl apps list
# BUF_TOKEN                 deploy-dev / deploy-prod    buf.build → Settings → Tokens
# GH_PAT_SCAN               ci (secret-scan)            GitHub PAT with repo read
#
# GITHUB_TOKEN is automatically provided by GitHub Actions — no setup needed.
# See: docs/setup/digitalocean.md Step 9
EOF

ok ".env created successfully"
ok "Location: ${ENV_FILE}"

# ─────────────────────────────────────────────────────────────────────────────
# Summary and Next Steps
# ─────────────────────────────────────────────────────────────────────────────

section "Configuration Summary"

echo ""
echo "✓ POSTGRES_PASSWORD     (database — local dev only)"
echo "✓ ALPACA_API_KEY        (market data feed)"
echo "✓ ALPACA_API_SECRET     (market data feed)"
echo "✓ JWT_SECRET            (authentication tokens)"
if [ -n "$GRAFANA_OTLP_TOKEN" ]; then
  echo "✓ GRAFANA_OTLP_TOKEN    (observability — optional)"
fi

echo ""
section "Next Steps"

echo ""
echo "1. Verify the .env file:"
echo "   cat .env"
echo ""
echo "2. Bootstrap the environment:"
echo "   ./scripts/bootstrap.sh"
echo ""
echo "   This will:"
echo "   • Generate proto stubs (in Docker)"
echo "   • Install Node.js dependencies (if pnpm is installed)"
echo "   • Install Python dependencies (if python3 is installed)"
echo ""
echo "3. Start all services:"
echo "   docker compose up -d"
echo ""
echo "4. Verify services are healthy:"
echo "   docker compose ps"
echo ""
echo "5. Check out a specific service:"
echo "   curl -s http://localhost:8060/health    # config service"
echo "   curl -s http://localhost:8058/health    # identity service"
echo ""
echo "Docs:"
echo "  Getting Started:  docs/setup/getting-started.md"
echo "  Alpaca Setup:     docs/setup/alpaca.md"
echo "  Full Architecture: CLAUDE.md"
echo ""
ok "Setup ready! Run bootstrap.sh to continue."
echo ""
