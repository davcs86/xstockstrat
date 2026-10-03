#!/usr/bin/env bash
# scripts/setup-env.sh
# Interactive .env setup guide for xstockstrat development
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

# ── Color helpers ──────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info() { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err() { echo -e "${RED}[ERROR]${NC} $*" >&2; }
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
  --skip)
    ok ".env already exists — skipping setup."
    exit 0
    ;;
  *) warn ".env already exists. Continuing will overwrite it." ;;
  esac
fi

# ── Parse flags ────────────────────────────────────────────────────────────────
USE_DEFAULTS=false
for arg in "$@"; do
  case "$arg" in
  --defaults) USE_DEFAULTS=true ;;
  --skip) ;; # handled above
  *)
    err "Unknown flag: $arg"
    exit 1
    ;;
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
      echo "" # newline after hidden input
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

# generate_hex BYTES — prints 2*BYTES lowercase hex chars.
generate_hex() {
  if command -v openssl &>/dev/null; then
    openssl rand -hex "$1"
  else
    # Fallback: use /dev/urandom if openssl not available
    head -c "$1" /dev/urandom | xxd -p | tr -d '\n'
  fi
}

# existing_hex_key NAME — prints NAME's value from the current .env when it is 64 hex chars.
existing_hex_key() {
  [ -f "$ENV_FILE" ] || return 0
  grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | tr -d "'\"" | grep -E '^[0-9a-fA-F]{64}$' || true
}

# ═════════════════════════════════════════════════════════════════════════════
# Interactive Setup
# ═════════════════════════════════════════════════════════════════════════════

section "xstockstrat — Environment Setup"

info "This script will create a .env file for local development."
info "Three-file convention:"
info "  • .env — NOT committed; secrets only (POSTGRES_PASSWORD, JWT_SECRET, encryption keys)"
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

prompt_value SEED_USER_ID "80880990-2b79-4d85-8761-d8d9102c2efb" \
  "Existing user id that pre-existing strategies are assigned to at migration time
  (feature 133, migration 013's ownership backfill). Only matters when the local DB
  already has strategies; the shown default is safe for a fresh local DB."

# ── JWT Secret ─────────────────────────────────────────────────────────────────
section "JWT Secret"

info "Used by xstockstrat-identity for signing and verifying authentication tokens, and by"
info "xstockstrat-agent to HMAC-sign its OAuth 2.1 txn blob."
info ""

if [ "$USE_DEFAULTS" = true ]; then
  JWT_SECRET=$(generate_hex 16)
  info "Generated JWT_SECRET (non-interactive mode)"
else
  echo "Would you like to:"
  echo "  1) Generate a secure random secret automatically"
  echo "  2) Provide your own"
  echo ""
  echo -n "  → "
  read -r choice

  if [ "$choice" = "1" ]; then
    JWT_SECRET=$(generate_hex 16)
    ok "Generated secure JWT_SECRET"
  else
    prompt_value JWT_SECRET "" \
      "Your JWT secret (minimum 32 characters recommended)." \
      true
  fi
fi

# ── Encryption Keys ────────────────────────────────────────────────────────────
section "Encryption Keys"

info "AES-256 master keys (64 hex chars) required by docker-compose:"
info "  • CONFIG_SECRETS_ENCRYPTION_KEY  — xstockstrat-config secret rows (vendor credentials)"
info "  • BROKER_ACCOUNTS_ENCRYPTION_KEY — xstockstrat-trading broker credentials"
info "Keys already in .env are kept: a new key cannot decrypt rows written under the old one."
info ""

CONFIG_SECRETS_ENCRYPTION_KEY=$(existing_hex_key CONFIG_SECRETS_ENCRYPTION_KEY)
if [ -n "$CONFIG_SECRETS_ENCRYPTION_KEY" ]; then
  ok "Kept existing CONFIG_SECRETS_ENCRYPTION_KEY"
else
  CONFIG_SECRETS_ENCRYPTION_KEY=$(generate_hex 32)
  ok "Generated CONFIG_SECRETS_ENCRYPTION_KEY"
fi
BROKER_ACCOUNTS_ENCRYPTION_KEY=$(existing_hex_key BROKER_ACCOUNTS_ENCRYPTION_KEY)
if [ -n "$BROKER_ACCOUNTS_ENCRYPTION_KEY" ]; then
  ok "Kept existing BROKER_ACCOUNTS_ENCRYPTION_KEY"
else
  BROKER_ACCOUNTS_ENCRYPTION_KEY=$(generate_hex 32)
  ok "Generated BROKER_ACCOUNTS_ENCRYPTION_KEY"
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

prompt_value OTEL_EXPORTER_OTLP_ENDPOINT "" \
  "Grafana Cloud OTLP endpoint URL (e.g. https://otlp-gateway-<region>.grafana.net/otlp)." \
  false

prompt_value OTEL_EXPORTER_OTLP_HEADERS "" \
  "Grafana Cloud OTLP auth header value (Basic <base64(instanceId:apiKey)> — see docs/setup/grafana-cloud.md)." \
  true

# ─────────────────────────────────────────────────────────────────────────────
# Write .env File
# ─────────────────────────────────────────────────────────────────────────────

section "Writing .env file"

cat >"$ENV_FILE" <<'EOF'
# xstockstrat — Environment Variables
# Generated by scripts/setup-env.sh
# ⚠️  NEVER commit this file to git — it contains secrets!

# ── Database ───────────────────────────────────────────────────────────────
# Local dev only. In production, DATABASE_URL is injected by DigitalOcean App Platform.
EOF

# shellcheck disable=SC2129
echo "POSTGRES_PASSWORD='$POSTGRES_PASSWORD'" >>"$ENV_FILE"
echo "SEED_USER_ID='$SEED_USER_ID'" >>"$ENV_FILE"

cat >>"$ENV_FILE" <<'EOF'

# Vendor credentials (Alpaca, FMP, Finnhub) are not env vars: they are encrypted config rows
# resolved by xstockstrat-marketdata via GetSecret (feature 147). Set them through config.
EOF

cat >>"$ENV_FILE" <<'EOF'

# ── JWT (xstockstrat-identity, xstockstrat-ui, xstockstrat-agent) ─────
# Signs/verifies auth tokens; the agent also HMAC-signs its OAuth 2.1 txn blob with it.
EOF

echo "JWT_SECRET='$JWT_SECRET'" >>"$ENV_FILE"

cat >>"$ENV_FILE" <<'EOF'

# ── Encryption Keys (xstockstrat-config, xstockstrat-trading) ──────────
# AES-256, 64 hex chars (openssl rand -hex 32). Rotating one orphans rows encrypted under it.
EOF

echo "CONFIG_SECRETS_ENCRYPTION_KEY='$CONFIG_SECRETS_ENCRYPTION_KEY'" >>"$ENV_FILE"
echo "BROKER_ACCOUNTS_ENCRYPTION_KEY='$BROKER_ACCOUNTS_ENCRYPTION_KEY'" >>"$ENV_FILE"

cat >>"$ENV_FILE" <<'EOF'

# ── OpenTelemetry (Optional) ────────────────────────────────────────────
# Leave empty to disable. Enable for Grafana Cloud observability.
EOF

[ -n "$OTEL_EXPORTER_OTLP_ENDPOINT" ] && echo "OTEL_EXPORTER_OTLP_ENDPOINT='$OTEL_EXPORTER_OTLP_ENDPOINT'" >>"$ENV_FILE"
[ -n "$OTEL_EXPORTER_OTLP_HEADERS" ] && echo "OTEL_EXPORTER_OTLP_HEADERS='$OTEL_EXPORTER_OTLP_HEADERS'" >>"$ENV_FILE"

cat >>"$ENV_FILE" <<'EOF'

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
echo "✓ JWT_SECRET            (authentication tokens, agent OAuth txn signing)"
echo "✓ CONFIG_SECRETS_ENCRYPTION_KEY  (config secrets at rest)"
echo "✓ BROKER_ACCOUNTS_ENCRYPTION_KEY (broker credentials at rest)"
if [ -n "$OTEL_EXPORTER_OTLP_ENDPOINT" ]; then
  echo "✓ OTEL_EXPORTER_OTLP_ENDPOINT (observability — optional)"
fi
if [ -n "$OTEL_EXPORTER_OTLP_HEADERS" ]; then
  echo "✓ OTEL_EXPORTER_OTLP_HEADERS  (observability — optional)"
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
