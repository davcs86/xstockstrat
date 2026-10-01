#!/usr/bin/env bash
# Structural assertions for scripts/gen-dev-certs.sh (feature 210 inter-service-mtls, Step 2).
# No DB/mesh bring-up: verifies the generated dev mTLS material is well-formed — the foundation
# the per-language negative tests (Steps 4/6/8) build on. Exits non-zero on any failed assertion.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERTS_DIR="${REPO_ROOT}/certs"
GEN="${REPO_ROOT}/scripts/gen-dev-certs.sh"
fail() { echo "ASSERT FAIL: $*" >&2; exit 1; }

[ -x "$GEN" ] || [ -f "$GEN" ] || fail "scripts/gen-dev-certs.sh missing"
bash "$GEN" >/dev/null 2>&1 || fail "gen-dev-certs.sh exited non-zero"

# Representative identities: one backend, one pure client.
for svc in xstockstrat-trading xstockstrat-ui; do
  d="${CERTS_DIR}/${svc}"
  [ -f "${d}/cert.pem" ] && [ -f "${d}/key.pem" ] && [ -f "${d}/ca.pem" ] || fail "${svc}: missing cert/key/ca pem"
  # (a) leaf chains to the CA
  openssl verify -CAfile "${d}/ca.pem" "${d}/cert.pem" >/dev/null 2>&1 || fail "${svc}: cert does not verify against ca.pem"
  # (b) SAN equals the service name exactly (not a FQDN)
  san="$(openssl x509 -in "${d}/cert.pem" -noout -ext subjectAltName 2>/dev/null)"
  echo "$san" | grep -q "DNS:${svc}" || fail "${svc}: SAN missing DNS:${svc} (got: ${san})"
  echo "$san" | grep -qE "DNS:${svc}[.]" && fail "${svc}: SAN is an FQDN, must be the bare service name"
  # (c) both serverAuth and clientAuth EKUs present
  eku="$(openssl x509 -in "${d}/cert.pem" -noout -ext extendedKeyUsage 2>/dev/null)"
  echo "$eku" | grep -q "TLS Web Server Authentication" || fail "${svc}: missing serverAuth EKU"
  echo "$eku" | grep -q "TLS Web Client Authentication" || fail "${svc}: missing clientAuth EKU"
done

# (d) a leaf from a DIFFERENT CA does NOT verify against ca.pem (CA pin is load-bearing — wrong-CA
# half of the per-language negative matrix). Mint a throwaway foreign CA + leaf.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$TMP/foreign-ca-key.pem" -out "$TMP/foreign-ca.pem" \
  -days 1 -subj "/CN=foreign-ca" >/dev/null 2>&1 || fail "could not mint foreign CA"
openssl req -newkey rsa:2048 -nodes -keyout "$TMP/foreign-key.pem" -out "$TMP/foreign-csr.pem" \
  -subj "/CN=xstockstrat-trading" >/dev/null 2>&1 || fail "could not mint foreign CSR"
openssl x509 -req -in "$TMP/foreign-csr.pem" -CA "$TMP/foreign-ca.pem" -CAkey "$TMP/foreign-ca-key.pem" \
  -CAcreateserial -out "$TMP/foreign-cert.pem" -days 1 >/dev/null 2>&1 || fail "could not sign foreign leaf"
if openssl verify -CAfile "${CERTS_DIR}/xstockstrat-trading/ca.pem" "$TMP/foreign-cert.pem" >/dev/null 2>&1; then
  fail "foreign-CA leaf verified against platform ca.pem — CA pin is NOT load-bearing"
fi

echo "gen-dev-certs.test.sh: all assertions passed"
