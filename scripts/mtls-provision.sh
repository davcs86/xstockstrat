#!/usr/bin/env bash
# Provision the inter-service mTLS CA (feature 210) for local dev AND the DO deploy pipeline.
#
# The deploy stores ONLY the platform CA (cert + key) as one GitHub secret per environment
# (DEV_MTLS_CA / PROD_MTLS_CA, a base64(JSON {ca_cert, ca_key})). .github/workflows/deploy.yml then
# mints the 12 per-service leaves off that CA on every deploy (reusing gen-dev-certs.sh) and substitutes
# them into the MTLS_* placeholders in .do/app*.yaml. The CA stays stable across deploys (no rolling-
# deploy handshake mismatch); leaves auto-rotate each deploy. Trade-off: the CA signing key lives in CI
# — acceptable for this operator's threat model (same class as JWT_SECRET / DB creds already in CI).
#
# Dev and prod get SEPARATE CAs (distinct ./certs and ./certs-prod trees) — the runbook's
# "different CA per env" rule. The dev CA also backs local docker-compose (via mtls-dev-env.sh).
#
# Usage:
#   scripts/mtls-provision.sh local                 # mint ./certs (dev CA + leaves) for docker-compose
#                                                   #   then: source scripts/mtls-dev-env.sh && docker compose up -d
#   scripts/mtls-provision.sh ca <dev|prod>         # print the base64 CA bundle for {DEV,PROD}_MTLS_CA to stdout
#   scripts/mtls-provision.sh set-secret <dev|prod> # gh secret set {DEV,PROD}_MTLS_CA (requires an authenticated gh)
#
# bash 3.2 compatible (macOS default); BSD/GNU openssl compatible (via gen-dev-certs.sh).
# Requires: openssl, python3. set-secret additionally requires gh.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GEN="${REPO_ROOT}/scripts/gen-dev-certs.sh"

# Set CERTS_DIR / CA_CN / CA_O for the requested environment. Returns non-zero on a bad env name.
env_setup() {
  case "$1" in
  dev)
    CERTS_DIR="${REPO_ROOT}/certs"
    CA_CN="xstockstrat-dev-platform-ca"
    CA_O="xstockstrat-dev"
    ;;
  prod)
    CERTS_DIR="${REPO_ROOT}/certs-prod"
    CA_CN="xstockstrat-prod-platform-ca"
    CA_O="xstockstrat-prod"
    ;;
  *)
    echo "mtls-provision: environment must be 'dev' or 'prod' (got '${1:-}')" >&2
    return 2
    ;;
  esac
}

# Mint the CA (+ leaves) into $CERTS_DIR if the CA is not already present. The CA is what the deploy
# secret carries; the leaves are only needed for the local docker-compose path.
ensure_certs() {
  if [ ! -f "${CERTS_DIR}/_ca/ca.pem" ]; then
    CERTS_DIR="$CERTS_DIR" CA_CN="$CA_CN" CA_O="$CA_O" bash "$GEN" >/dev/null || return 1
  fi
}

# Emit base64(JSON {ca_cert, ca_key}) read from $CERTS_DIR/_ca. Fails unless both CA PEMs exist.
emit_ca() {
  CERTS_DIR="$CERTS_DIR" python3 - <<'PY'
import base64, json, os, sys

ca_dir = os.path.join(os.environ["CERTS_DIR"], "_ca")
cert, key = os.path.join(ca_dir, "ca.pem"), os.path.join(ca_dir, "ca-key.pem")
if not (os.path.isfile(cert) and os.path.isfile(key)):
    sys.stderr.write("mtls-provision: CA material missing under %s — generate it first\n" % ca_dir)
    sys.exit(1)

payload = {"ca_cert": open(cert).read(), "ca_key": open(key).read()}
sys.stdout.write(base64.b64encode(json.dumps(payload).encode()).decode())
PY
}

cmd="${1:-}"
case "$cmd" in
local)
  env_setup dev || exit 2
  ensure_certs || {
    echo "mtls-provision: cert generation failed" >&2
    exit 1
  }
  echo "Dev mTLS material ready under ${CERTS_DIR}/ (CA + 12 service leaves). Next:"
  echo "  source scripts/mtls-dev-env.sh && docker compose up -d"
  ;;
ca)
  env_setup "${2:-}" || exit 2
  ensure_certs || {
    echo "mtls-provision: cert generation failed" >&2
    exit 1
  }
  emit_ca || exit 1
  ;;
set-secret)
  env_setup "${2:-}" || exit 2
  command -v gh >/dev/null 2>&1 || {
    echo "mtls-provision: gh CLI not found — install it or use 'ca' and set the secret manually" >&2
    exit 1
  }
  ensure_certs || {
    echo "mtls-provision: cert generation failed" >&2
    exit 1
  }
  secret_name="$(printf '%s' "$2" | tr '[:lower:]' '[:upper:]')_MTLS_CA"
  ca_value="$(emit_ca)" || exit 1
  printf '%s' "$ca_value" | gh secret set "$secret_name" || exit 1
  echo "mtls-provision: set GitHub secret ${secret_name}"
  ;;
*)
  echo "usage: mtls-provision.sh {local | ca <dev|prod> | set-secret <dev|prod>}" >&2
  exit 2
  ;;
esac
