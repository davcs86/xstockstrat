#!/usr/bin/env bash
# Dev-only mTLS material generator for inter-service mutual TLS (feature 210).
#
# Generates one self-signed DEV platform CA + one leaf per service. Each leaf carries
# SAN = the registry service name (never a FQDN) and BOTH serverAuth+clientAuth EKUs, so a
# single leaf serves a service in both its server and client directions. Output lives under a
# git-ignored ./certs/ tree; these are DEV certs only — production certs come from the production
# platform CA, injected as MTLS_CERT/MTLS_KEY/MTLS_CA_CERT env (see docs/patterns/inter-service-mtls.md).
#
# Usage:
#   scripts/gen-dev-certs.sh                 # CA (if absent) + all 12 service leaves
#   scripts/gen-dev-certs.sh --rotate <svc>  # mint a rotated leaf (cert.rotated.pem/key.rotated.pem)
#                                            # off the SAME CA, for the cert-rotation test (@AC-6)
#
# bash 3.2 compatible (macOS default); BSD/GNU openssl compatible (uses an extfile, not -addext).
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# CERTS_DIR / CA_CN / CA_O are env-overridable so scripts/mtls-provision.sh can reuse this generator
# for a separate prod CA tree; the bare `gen-dev-certs.sh` defaults are unchanged (local dev CA).
CERTS_DIR="${CERTS_DIR:-${REPO_ROOT}/certs}"
CA_CN="${CA_CN:-xstockstrat-dev-platform-ca}"
CA_O="${CA_O:-xstockstrat-dev}"
CA_DIR="${CERTS_DIR}/_ca"
DAYS_CA=3650
DAYS_LEAF=825

SERVICES="xstockstrat-trading xstockstrat-portfolio xstockstrat-marketdata \
xstockstrat-indicators xstockstrat-ingest xstockstrat-analysis \
xstockstrat-ledger xstockstrat-identity xstockstrat-notify xstockstrat-config \
xstockstrat-ui xstockstrat-agent"

ensure_ca() {
  mkdir -p "$CA_DIR"
  if [ ! -f "${CA_DIR}/ca.pem" ]; then
    openssl req -x509 -newkey rsa:2048 -nodes \
      -keyout "${CA_DIR}/ca-key.pem" -out "${CA_DIR}/ca.pem" \
      -days "$DAYS_CA" -subj "/CN=${CA_CN}/O=${CA_O}" >/dev/null 2>&1
  fi
}

# mint_leaf <service> <cert-out> <key-out>
mint_leaf() {
  svc="$1"
  cert_out="$2"
  key_out="$3"
  ext_file="$(mktemp)"
  csr_file="$(mktemp)"
  cat >"$ext_file" <<EXT
subjectAltName = DNS:${svc}
extendedKeyUsage = serverAuth, clientAuth
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
EXT
  openssl req -newkey rsa:2048 -nodes \
    -keyout "$key_out" -out "$csr_file" \
    -subj "/CN=${svc}/O=${CA_O}" >/dev/null 2>&1
  openssl x509 -req -in "$csr_file" \
    -CA "${CA_DIR}/ca.pem" -CAkey "${CA_DIR}/ca-key.pem" -CAcreateserial \
    -out "$cert_out" -days "$DAYS_LEAF" -extfile "$ext_file" >/dev/null 2>&1
  rm -f "$ext_file" "$csr_file"
}

ensure_ca

if [ "${1:-}" = "--rotate" ]; then
  svc="${2:-}"
  [ -n "$svc" ] || {
    echo "usage: gen-dev-certs.sh --rotate <service>" >&2
    exit 2
  }
  svc_dir="${CERTS_DIR}/${svc}"
  mkdir -p "$svc_dir"
  mint_leaf "$svc" "${svc_dir}/cert.rotated.pem" "${svc_dir}/key.rotated.pem"
  cp "${CA_DIR}/ca.pem" "${svc_dir}/ca.pem"
  echo "rotated leaf for ${svc}: ${svc_dir}/cert.rotated.pem (same CA)"
  exit 0
fi

for svc in $SERVICES; do
  svc_dir="${CERTS_DIR}/${svc}"
  mkdir -p "$svc_dir"
  mint_leaf "$svc" "${svc_dir}/cert.pem" "${svc_dir}/key.pem"
  cp "${CA_DIR}/ca.pem" "${svc_dir}/ca.pem"
done

echo "Generated dev mTLS material under ${CERTS_DIR}/ (CA + 12 service leaves)."
