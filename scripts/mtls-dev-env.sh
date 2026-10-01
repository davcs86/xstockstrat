#!/usr/bin/env bash
# Export the dev mTLS material (feature 210) as the shell env vars docker-compose.yml interpolates.
#
# docker-compose.yml delivers each service's leaf+key as PEM STRINGS via ${<SVC>_MTLS_CERT} /
# ${<SVC>_MTLS_KEY} and the shared CA via ${MTLS_CA_CERT} (so the code path is identical to prod,
# which injects the same env from the production CA). Compose's .env file parser does not handle
# multiline PEM values, so SOURCE this script to put the PEMs into the shell environment first:
#
#   scripts/gen-dev-certs.sh          # once — mints ./certs/ (CA + per-service leaves)
#   source scripts/mtls-dev-env.sh    # export the PEMs into THIS shell
#   docker compose up -d              # compose interpolates ${<SVC>_MTLS_*} from the exported env
#
# bash 3.2 compatible (macOS default). Must be sourced, not executed (exports die with a subshell).
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  echo "mtls-dev-env: source this script, do not execute it: source scripts/mtls-dev-env.sh" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERTS_DIR="${REPO_ROOT}/certs"

if [ ! -f "${CERTS_DIR}/_ca/ca.pem" ]; then
  echo "mtls-dev-env: ${CERTS_DIR}/_ca/ca.pem not found — run scripts/gen-dev-certs.sh first" >&2
  return 1
fi

MTLS_CA_CERT="$(cat "${CERTS_DIR}/_ca/ca.pem")"
export MTLS_CA_CERT

# service registry suffix -> compose shell-var prefix (matches docker-compose.yml)
for pair in \
  "config:CONFIG" "ledger:LEDGER" "identity:IDENTITY" "notify:NOTIFY" \
  "marketdata:MARKETDATA" "indicators:INDICATORS" "ingest:INGEST" "analysis:ANALYSIS" \
  "portfolio:PORTFOLIO" "trading:TRADING" "ui:UI" "agent:AGENT"; do
  svc="${pair%%:*}"
  pfx="${pair##*:}"
  svc_dir="${CERTS_DIR}/xstockstrat-${svc}"
  if [ ! -f "${svc_dir}/cert.pem" ]; then
    echo "mtls-dev-env: ${svc_dir}/cert.pem missing — re-run scripts/gen-dev-certs.sh" >&2
    return 1
  fi
  export "${pfx}_MTLS_CERT=$(cat "${svc_dir}/cert.pem")"
  export "${pfx}_MTLS_KEY=$(cat "${svc_dir}/key.pem")"
done

echo "mtls-dev-env: exported MTLS_CA_CERT + 12 per-service MTLS_CERT/MTLS_KEY from ${CERTS_DIR}/"
