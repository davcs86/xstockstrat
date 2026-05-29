#!/bin/sh
# scripts/manage-users.sh
# Manage identity service users: reset passwords and create new users.
#
# Usage:
#   ./scripts/manage-users.sh reset-password <email>
#   ./scripts/manage-users.sh create-user <email> [roles]
#
# roles  Comma-separated list, e.g. "admin,trader"  (default: trader)
#
# Requires psql and node (with identity service node_modules installed).
# DATABASE_URL must be set, or POSTGRES_PASSWORD in .env will be used.

set -eu

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Inside the Docker container (script at /app/scripts/) node_modules live at /app
if [ -d "$REPO_ROOT/node_modules/bcrypt" ]; then
  IDENTITY_DIR="$REPO_ROOT"
else
  IDENTITY_DIR="$REPO_ROOT/services/xstockstrat-identity"
fi
BCRYPT_ROUNDS=10

# ── Helpers ────────────────────────────────────────────────────────────────

die() { echo "ERROR: $*" >&2; exit 1; }

usage() {
  cat >&2 <<EOF
Usage:
  $0 reset-password <email>
  $0 create-user    <email> [roles]

roles: comma-separated list (default: trader)
       available: admin, trader

Examples:
  $0 reset-password admin@localhost
  $0 create-user    alice@example.com trader
  $0 create-user    ops@example.com   admin,trader
EOF
  exit 1
}

# ── Load DATABASE_URL ──────────────────────────────────────────────────────

load_db_url() {
  if [ -n "${DATABASE_URL:-}" ]; then
    return
  fi
  local env_file="$REPO_ROOT/.env"
  if [ -f "$env_file" ]; then
    local pg_pass
    pg_pass=$(grep -E '^POSTGRES_PASSWORD=' "$env_file" | head -1 | cut -d= -f2- | tr -d '"'"'" | tr -d '[:space:]')
    if [ -n "$pg_pass" ]; then
      export DATABASE_URL="postgres://xstockstrat:${pg_pass}@localhost:5432/xstockstrat?sslmode=disable"
    fi
  fi
  if [ -z "${DATABASE_URL:-}" ]; then
    die "DATABASE_URL is not set. Either export it or ensure POSTGRES_PASSWORD is in .env.\n  Example: export DATABASE_URL=postgres://xstockstrat:<password>@localhost:5432/xstockstrat?sslmode=disable"
  fi
}

# ── Bcrypt hash via identity service node_modules ─────────────────────────

check_bcrypt() {
  if [ ! -d "$IDENTITY_DIR/node_modules/bcrypt" ]; then
    die "bcrypt not found at $IDENTITY_DIR/node_modules/bcrypt\nRun: cd $IDENTITY_DIR && pnpm install"
  fi
  if ! command -v node >/dev/null 2>&1; then
    die "node is not in PATH — install Node.js 22"
  fi
}

hash_password() {
  local password="$1"
  USER_PASSWORD="$password" node --input-type=module <<EOF 2>/dev/null
import { createRequire } from 'module';
const require = createRequire('$IDENTITY_DIR/package.json');
const bcrypt = require('bcrypt');
const hash = await bcrypt.hash(process.env.USER_PASSWORD, $BCRYPT_ROUNDS);
process.stdout.write(hash);
EOF
}

# ── DB operations ──────────────────────────────────────────────────────────

psql_exec() {
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -t -A -c "$1"
}

reset_password() {
  local email="$1" hash="$2"
  local rows
  rows=$(psql_exec "UPDATE identity.users SET password_hash = '$hash', updated_at = NOW() WHERE email = '$email'; SELECT ROW_COUNT();")
  # psql returns affected row count on UPDATE
  local affected
  affected=$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -t -A -c \
    "WITH u AS (UPDATE identity.users SET password_hash = '$hash', updated_at = NOW() WHERE email = '$email' RETURNING user_id) SELECT count(*) FROM u;")
  if [ "${affected:-0}" -eq 0 ]; then
    die "No user found with email '$email'. Use create-user to add a new user."
  fi
  echo "Password updated for $email."
}

create_user() {
  local email="$1" hash="$2" roles_csv="$3"
  # Convert comma-separated roles to PostgreSQL array literal: {"admin","trader"}
  local pg_roles
  pg_roles=$(echo "$roles_csv" | awk 'BEGIN{RS=",";ORS=","} {gsub(/^[ \t]+|[ \t]+$/,"",$0); printf "\"%s\",", $0}' | sed 's/,$//')
  pg_roles="{$pg_roles}"

  local affected
  affected=$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -t -A -c \
    "WITH u AS (INSERT INTO identity.users (email, password_hash, roles) VALUES ('$email', '$hash', '$pg_roles') ON CONFLICT (email) DO NOTHING RETURNING user_id) SELECT count(*) FROM u;")

  if [ "${affected:-0}" -eq 0 ]; then
    die "User '$email' already exists. Use reset-password to update their password."
  fi
  echo "User created: $email (roles: $roles_csv)"
}

# ── Main ───────────────────────────────────────────────────────────────────

[ $# -lt 2 ] && usage

ACTION="$1"
EMAIL="$2"

case "$ACTION" in
  reset-password|create-user) ;;
  *) usage ;;
esac

ROLES="${3:-trader}"

# Validate action-specific args
if [ "$ACTION" = "reset-password" ] && [ $# -gt 2 ]; then
  die "reset-password takes only an email argument"
fi

load_db_url
check_bcrypt

# Prompt for password (hidden)
echo -n "New password for $EMAIL: "
read -rs PASSWORD
echo
if [ -z "$PASSWORD" ]; then
  die "Password cannot be empty."
fi
echo -n "Confirm password: "
read -rs PASSWORD2
echo
if [ "$PASSWORD" != "$PASSWORD2" ]; then
  die "Passwords do not match."
fi

echo "Hashing password..."
HASH=$(hash_password "$PASSWORD")
if [ -z "$HASH" ]; then
  die "bcrypt hash generation failed."
fi

case "$ACTION" in
  reset-password) reset_password "$EMAIL" "$HASH" ;;
  create-user)    create_user    "$EMAIL" "$HASH" "$ROLES" ;;
esac
