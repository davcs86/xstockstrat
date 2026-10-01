#!/usr/bin/env bash
# Provision inter-service mTLS material (feature 210) for local dev AND the DO deploy pipeline.
#
# Reuses scripts/gen-dev-certs.sh to mint one platform CA + one leaf per service, then emits a single
# base64(JSON) BUNDLE that .github/workflows/deploy.yml decodes to fill every per-service MTLS_*
# placeholder in .do/app*.yaml. One bundle secret per environment (DEV_MTLS_BUNDLE / PROD_MTLS_BUNDLE)
# replaces ~25 per-service secrets. Dev and prod get SEPARATE CAs (distinct ./certs and ./certs-prod
# trees) — the runbook's "different CA per env" rule.
#
# Usage:
#   scripts/mtls-provision.sh local                 # mint ./certs (dev CA) for docker-compose
#                                                   #   then: source scripts/mtls-dev-env.sh && docker compose up -d
#   scripts/mtls-provision.sh bundle <dev|prod>     # print the base64 bundle for {DEV,PROD}_MTLS_BUNDLE to stdout
#   scripts/mtls-provision.sh set-secret <dev|prod> # gh secret set {DEV,PROD}_MTLS_BUNDLE (requires an authenticated gh)
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

# Mint the CA + 12 leaves into $CERTS_DIR if the CA is not already present.
ensure_certs() {
  if [ ! -f "${CERTS_DIR}/_ca/ca.pem" ]; then
    CERTS_DIR="$CERTS_DIR" CA_CN="$CA_CN" CA_O="$CA_O" bash "$GEN" >/dev/null || return 1
  fi
}

# Emit base64(JSON {ca, leaves:{<svc>:{cert,key}}}) read from $CERTS_DIR. Fails unless all 12 leaves exist.
emit_bundle() {
  CERTS_DIR="$CERTS_DIR" python3 - <<'PY'
import base64, glob, json, os, sys

certs_dir = os.environ["CERTS_DIR"]
ca_path = os.path.join(certs_dir, "_ca", "ca.pem")
if not os.path.isfile(ca_path):
    sys.stderr.write("mtls-provision: %s not found — generate certs first\n" % ca_path)
    sys.exit(1)

bundle = {"ca": open(ca_path).read(), "leaves": {}}
for svc_dir in sorted(glob.glob(os.path.join(certs_dir, "xstockstrat-*"))):
    cert = os.path.join(svc_dir, "cert.pem")
    key = os.path.join(svc_dir, "key.pem")
    if os.path.isfile(cert) and os.path.isfile(key):
        bundle["leaves"][os.path.basename(svc_dir)] = {
            "cert": open(cert).read(),
            "key": open(key).read(),
        }

if len(bundle["leaves"]) != 12:
    sys.stderr.write(
        "mtls-provision: expected 12 service leaves, found %d in %s\n"
        % (len(bundle["leaves"]), certs_dir)
    )
    sys.exit(1)

sys.stdout.write(base64.b64encode(json.dumps(bundle).encode()).decode())
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
bundle)
  env_setup "${2:-}" || exit 2
  ensure_certs || {
    echo "mtls-provision: cert generation failed" >&2
    exit 1
  }
  emit_bundle || exit 1
  ;;
set-secret)
  env_setup "${2:-}" || exit 2
  command -v gh >/dev/null 2>&1 || {
    echo "mtls-provision: gh CLI not found — install it or use 'bundle' and set the secret manually" >&2
    exit 1
  }
  ensure_certs || {
    echo "mtls-provision: cert generation failed" >&2
    exit 1
  }
  secret_name="$(printf '%s' "$2" | tr '[:lower:]' '[:upper:]')_MTLS_BUNDLE"
  bundle_value="$(emit_bundle)" || exit 1
  printf '%s' "$bundle_value" | gh secret set "$secret_name" || exit 1
  echo "mtls-provision: set GitHub secret ${secret_name}"
  ;;
*)
  echo "usage: mtls-provision.sh {local | bundle <dev|prod> | set-secret <dev|prod>}" >&2
  exit 2
  ;;
esac
