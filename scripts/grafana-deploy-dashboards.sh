#!/usr/bin/env bash
#
# grafana-deploy-dashboards.sh — deploy dashboards-as-code to Grafana Cloud.
#
# Uploads every dashboard JSON file under grafana/dashboards/ to Grafana via the
# HTTP API, into a managed folder. Idempotent: each dashboard is keyed by its
# `uid`, and existing dashboards are overwritten in place.
#
# Required env vars:
#   GRAFANA_URL                    Stack URL, e.g. https://xstockstrat.grafana.net
#   GRAFANA_SERVICE_ACCOUNT_TOKEN  Service account token (glsa_...) with Editor role
#
# Optional env vars:
#   GRAFANA_FOLDER_UID             Target folder uid   (default: xstockstrat)
#   GRAFANA_FOLDER_TITLE           Target folder title (default: xstockstrat)
#   DASHBOARDS_DIR                 Source directory    (default: grafana/dashboards)
#
# Usage:
#   GRAFANA_URL=... GRAFANA_SERVICE_ACCOUNT_TOKEN=... ./scripts/grafana-deploy-dashboards.sh
#
# Requires: bash 3.2+, curl, jq (all preinstalled on macOS + ubuntu-latest).

set -euo pipefail

# ── Resolve repo root so the script works from any CWD ──────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

DASHBOARDS_DIR="${DASHBOARDS_DIR:-$REPO_ROOT/grafana/dashboards}"
FOLDER_UID="${GRAFANA_FOLDER_UID:-xstockstrat}"
FOLDER_TITLE="${GRAFANA_FOLDER_TITLE:-xstockstrat}"

# ── Preflight ───────────────────────────────────────────────────────────────
for tool in curl jq; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "error: required tool '$tool' not found on PATH" >&2
    exit 1
  fi
done

if [ -z "${GRAFANA_URL:-}" ]; then
  echo "error: GRAFANA_URL is not set (e.g. https://your-stack.grafana.net)" >&2
  exit 1
fi
if [ -z "${GRAFANA_SERVICE_ACCOUNT_TOKEN:-}" ]; then
  echo "error: GRAFANA_SERVICE_ACCOUNT_TOKEN is not set (glsa_... token)" >&2
  exit 1
fi

# Strip any trailing slash from the base URL.
BASE_URL="${GRAFANA_URL%/}"
AUTH_HEADER="Authorization: Bearer $GRAFANA_SERVICE_ACCOUNT_TOKEN"

if [ ! -d "$DASHBOARDS_DIR" ]; then
  echo "error: dashboards directory not found: $DASHBOARDS_DIR" >&2
  exit 1
fi

# ── api_call METHOD PATH [BODY_FILE] — echoes body, sets HTTP_STATUS ─────────
HTTP_STATUS=""
api_call() {
  method="$1"
  path="$2"
  body_file="${3:-}"
  tmp_body="$(mktemp)"

  if [ -n "$body_file" ]; then
    HTTP_STATUS="$(curl -sS -o "$tmp_body" -w '%{http_code}' \
      -X "$method" \
      -H "$AUTH_HEADER" \
      -H "Content-Type: application/json" \
      --data-binary "@$body_file" \
      "$BASE_URL$path")"
  else
    HTTP_STATUS="$(curl -sS -o "$tmp_body" -w '%{http_code}' \
      -X "$method" \
      -H "$AUTH_HEADER" \
      "$BASE_URL$path")"
  fi

  cat "$tmp_body"
  rm -f "$tmp_body"
}

# ── Ensure the target folder exists ─────────────────────────────────────────
echo "==> Ensuring folder '$FOLDER_TITLE' (uid=$FOLDER_UID) exists on $BASE_URL"
api_call GET "/api/folders/$FOLDER_UID" >/dev/null

if [ "$HTTP_STATUS" = "404" ]; then
  folder_body="$(mktemp)"
  jq -n --arg uid "$FOLDER_UID" --arg title "$FOLDER_TITLE" \
    '{uid: $uid, title: $title}' >"$folder_body"
  resp="$(api_call POST "/api/folders" "$folder_body")"
  rm -f "$folder_body"
  if [ "$HTTP_STATUS" != "200" ]; then
    echo "error: failed to create folder (HTTP $HTTP_STATUS): $resp" >&2
    exit 1
  fi
  echo "    created folder."
elif [ "$HTTP_STATUS" = "200" ]; then
  echo "    folder already exists."
else
  echo "error: unexpected status checking folder (HTTP $HTTP_STATUS)" >&2
  exit 1
fi

# ── Upload each dashboard ───────────────────────────────────────────────────
shopt -s nullglob
dashboards=("$DASHBOARDS_DIR"/*.json)
if [ ${#dashboards[@]} -eq 0 ]; then
  echo "warning: no dashboard JSON files found in $DASHBOARDS_DIR — nothing to do"
  exit 0
fi

failures=0
for file in "${dashboards[@]}"; do
  name="$(basename "$file")"

  # Validate JSON before sending.
  if ! jq empty "$file" >/dev/null 2>&1; then
    echo "==> $name — INVALID JSON, skipping" >&2
    failures=$((failures + 1))
    continue
  fi

  echo "==> Deploying $name"

  # Wrap the raw dashboard model in the /api/dashboards/db payload.
  # Force id:null so the API treats it as create-or-update keyed by uid, and
  # always overwrite so re-runs are idempotent.
  payload="$(mktemp)"
  jq --arg uid "$FOLDER_UID" \
    '{dashboard: (. + {id: null}), folderUid: $uid, overwrite: true, message: "Synced from repo via CI"}' \
    "$file" >"$payload"

  resp="$(api_call POST "/api/dashboards/db" "$payload")"
  rm -f "$payload"

  if [ "$HTTP_STATUS" = "200" ]; then
    url="$(printf '%s' "$resp" | jq -r '.url // empty')"
    echo "    ok${url:+ — $BASE_URL$url}"
  else
    echo "    FAILED (HTTP $HTTP_STATUS): $resp" >&2
    failures=$((failures + 1))
  fi
done

if [ "$failures" -ne 0 ]; then
  echo "error: $failures dashboard(s) failed to deploy" >&2
  exit 1
fi

echo "==> All dashboards deployed."
