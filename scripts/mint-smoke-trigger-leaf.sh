#!/usr/bin/env bash
# Mint the smoke trigger client leaf (SAN xstockstrat-smoke-trigger) off an existing platform CA.
# Usage: mint-smoke-trigger-leaf.sh <certs_dir containing _ca/ca.pem + ca-key.pem> <out_dir>
# Writes <out_dir>/{cert,key,ca}.pem. The leaf is never part of gen-dev-certs.sh SERVICES.
#
# bash 3.2 compatible (macOS default).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SVC="xstockstrat-smoke-trigger"
src="${1:-}"
out="${2:-}"
if [ -z "$src" ] || [ -z "$out" ] || [ ! -f "$src/_ca/ca.pem" ] || [ ! -f "$src/_ca/ca-key.pem" ]; then
  echo "usage: mint-smoke-trigger-leaf.sh <certs_dir with _ca/ca.pem + ca-key.pem> <out_dir>" >&2
  exit 2
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/_ca"
cp "$src/_ca/ca.pem" "$src/_ca/ca-key.pem" "$work/_ca/"
CERTS_DIR="$work" bash "$REPO_ROOT/scripts/gen-dev-certs.sh" --rotate "$SVC" >/dev/null

mkdir -p "$out"
cp "$work/$SVC/cert.rotated.pem" "$out/cert.pem"
cp "$work/$SVC/key.rotated.pem" "$out/key.pem"
cp "$work/_ca/ca.pem" "$out/ca.pem"
chmod 600 "$out/key.pem"
echo "Minted $SVC leaf into $out"
