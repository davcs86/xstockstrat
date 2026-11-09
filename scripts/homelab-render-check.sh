#!/usr/bin/env bash
# scripts/homelab-render-check.sh <release_env> <staging|production>
# compose-go quotes the offending line on a bad character and the rest of the file on an unclosed quote; stderr keeps only variable names.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <release_env> <staging|production>" >&2
  exit 1
fi
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
err="$(mktemp)"
trap 'rm -f "$err"' EXIT
r() { env -i PATH="$PATH" HOME="$HOME" docker compose --env-file "$1" -f "$REPO_ROOT/deploy/homelab/compose.yml" config "${@:2}"; }

if ! r "$1" -q 2>"$err"; then
  grep -oE 'required variable [A-Za-z0-9_]+ is missing a value' "$err" >&2 ||
    echo "homelab-render-check: compose could not render the .env (details suppressed; APP_ENV must be single-line KEY=value)" >&2
  exit 1
fi
host="$(sed -n 's/^DB_HOST=//p' "$1" | tail -n 1)"
fails="$(r "$1" --format json 2>/dev/null | jq -c --arg target "$2" --arg host "$host" -f "$REPO_ROOT/deploy/homelab/render-assert.jq" 2>/dev/null)" || fails=""
if [ "$fails" != "[]" ]; then
  echo "homelab-render-check: render check failed: ${fails:-could not evaluate (details suppressed)}" >&2
  exit 1
fi
