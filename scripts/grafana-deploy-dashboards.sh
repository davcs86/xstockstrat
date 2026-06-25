#!/usr/bin/env bash
#
# grafana-deploy-dashboards.sh — deploy dashboards-as-code to Grafana Cloud.
#
# Uploads every dashboard JSON file under packages/otel/dashboards/ to Grafana
# via the HTTP API, into a managed folder. The dashboards are authored in the
# Grafana "export" format with `__inputs` datasource placeholders
# (${DS_PROMETHEUS} / ${DS_LOKI}); this script resolves those to your stack's
# real datasource UIDs (auto-discovered, or overridden via env) and upserts each
# dashboard keyed by its `uid`, so re-runs are idempotent.
#
# Required env vars:
#   GRAFANA_URL                    Stack URL, e.g. https://xstockstrat.grafana.net
#   GRAFANA_SERVICE_ACCOUNT_TOKEN  Service account token (glsa_...) with Editor role
#
# Optional env vars:
#   GRAFANA_PROMETHEUS_DS_UID      Prometheus/Mimir datasource uid (default: auto-discover)
#   GRAFANA_LOKI_DS_UID            Loki datasource uid             (default: auto-discover)
#   GRAFANA_FOLDER_UID             Target folder uid               (default: xstockstrat)
#   GRAFANA_FOLDER_TITLE           Target folder title             (default: xstockstrat)
#   DASHBOARDS_DIR                 Source directory (default: packages/otel/dashboards)
#
# Usage:
#   GRAFANA_URL=... GRAFANA_SERVICE_ACCOUNT_TOKEN=... ./scripts/grafana-deploy-dashboards.sh
#
# Requires: bash 3.2+, curl, jq (all preinstalled on macOS + ubuntu-latest).

set -euo pipefail

# ── Resolve repo root so the script works from any CWD ──────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

DASHBOARDS_DIR="${DASHBOARDS_DIR:-$REPO_ROOT/packages/otel/dashboards}"
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

# ── Resolve datasource UIDs (env override, else auto-discover) ──────────────
PROM_UID="${GRAFANA_PROMETHEUS_DS_UID:-}"
LOKI_UID="${GRAFANA_LOKI_DS_UID:-}"

if [ -z "$PROM_UID" ] || [ -z "$LOKI_UID" ]; then
  echo "==> Discovering datasource UIDs from $BASE_URL"
  ds_json="$(api_call GET "/api/datasources")"
  if [ "$HTTP_STATUS" != "200" ]; then
    echo "error: failed to list datasources (HTTP $HTTP_STATUS): $ds_json" >&2
    exit 1
  fi
  if [ -z "$PROM_UID" ]; then
    PROM_UID="$(printf '%s' "$ds_json" | jq -r 'map(select(.type=="prometheus")) | (.[0].uid // empty)')"
  fi
  if [ -z "$LOKI_UID" ]; then
    LOKI_UID="$(printf '%s' "$ds_json" | jq -r 'map(select(.type=="loki")) | (.[0].uid // empty)')"
  fi
fi

if [ -z "$PROM_UID" ]; then
  echo "error: no Prometheus datasource found (set GRAFANA_PROMETHEUS_DS_UID to override)" >&2
  exit 1
fi
if [ -z "$LOKI_UID" ]; then
  echo "error: no Loki datasource found (set GRAFANA_LOKI_DS_UID to override)" >&2
  exit 1
fi
echo "    Prometheus uid=$PROM_UID  Loki uid=$LOKI_UID"

# ── Ensure the target folder exists ─────────────────────────────────────────
echo "==> Ensuring folder '$FOLDER_TITLE' (uid=$FOLDER_UID) exists"
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

  # 1. Substitute the ${DS_*} datasource placeholders with the resolved UIDs.
  # 2. Strip the import-only __inputs / __requires keys (the API rejects them).
  # 3. Force id:null so the API upserts keyed by uid, and overwrite so re-runs
  #    are idempotent. Wrap in the /api/dashboards/db envelope.
  resolved="$(sed -e "s/\${DS_PROMETHEUS}/$PROM_UID/g" \
                  -e "s/\${DS_LOKI}/$LOKI_UID/g" "$file")"

  payload="$(mktemp)"
  printf '%s' "$resolved" | jq \
    --arg uid "$FOLDER_UID" \
    '{dashboard: (del(.__inputs, .__requires) + {id: null}), folderUid: $uid, overwrite: true, message: "Synced from repo via CI"}' \
    >"$payload"

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
