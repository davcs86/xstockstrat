#!/usr/bin/env bash
# Regression cases for scripts/check-otel-produced-signals.sh (feature 250). Each case builds a
# throwaway copy of the OTel assets and docs, mutates it, and asserts the guard's exit code and
# hit prefix. Pre-fix text lives in scripts/testdata/otel-produced-signals/. No network.
# Records every failure and exits once at the end; only the missing-guard check exits at once.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK="${REPO_ROOT}/scripts/check-otel-produced-signals.sh"
FX="${REPO_ROOT}/scripts/testdata/otel-produced-signals"
FOLLOWUP="docs/roadmap/features/274-otel-metrics-logs-export/"
SANCTIONED="Metrics and logs are not exported (feature 226)."
OPEN="<!-- otel-guard:removed-assets -->"
CLOSE="<!-- /otel-guard:removed-assets -->"
DEFECT="otel-metrics-logs-never-exported-defect"
RULE_LINE="- \`xstk-error-rate-high\` — alert rule"
RULE_LINE_ASCII="- \`xstk-error-rate-high\` - alert rule"
EXISTING_FILE_LINE="- \`service-health.json\` — file"
DASH_LINE="- \`xstk-service-health\` — dashboard"

if [ ! -f "$CHECK" ]; then
  echo "ASSERT FAIL: scripts/check-otel-produced-signals.sh missing" >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
tree="${work}/tree"
err="${work}/err"
run=0
failed=0
rc=0

case_fail() {
  echo "CASE FAIL $1: $2" >&2
  failed=$((failed + 1))
}

fresh() {
  rm -rf "$tree"
  mkdir -p "${tree}/packages" "${tree}/docs/launch-pdfs" "${tree}/docs/sdd/business-rules" "${tree}/docs/reports"
  cp -R "${REPO_ROOT}/packages/otel" "${tree}/packages/"
  cp -R "${REPO_ROOT}/docs/setup" "${REPO_ROOT}/docs/patterns" "${tree}/docs/"
  cp "${REPO_ROOT}/docs/launch-pdfs/product-features.md" "${tree}/docs/launch-pdfs/"
  cp "${REPO_ROOT}/docs/context-constitution-findings.md" "${tree}/docs/"
  cp "${REPO_ROOT}/docs/sdd/business-rules/platform.feature" "${tree}/docs/sdd/business-rules/"
  cp "${REPO_ROOT}/docs/reports/2026-10-19-${DEFECT}.md" "${tree}/docs/reports/"
  cp -R "${REPO_ROOT}/.do" "${tree}/"
}

guard() {
  bash "$CHECK" "$tree" </dev/null >/dev/null 2>"$err"
  rc=$?
}

append() {
  printf '%s\n' "$2" >>"${tree}/$1"
}

tsv_field() {
  awk -F'\t' -v id="$1" -v col="$2" '$1 == id { print $col }' "${FX}/fr4.prefix.tsv"
}

expect_green() {
  run=$((run + 1))
  guard
  if [ "$rc" -ne 0 ]; then
    case_fail "$1" "expected rc=0, got rc=${rc}: $(head -3 "$err" | tr '\n' ' ')"
  fi
}

expect_hit() {
  local id="$1"
  local needle
  shift
  run=$((run + 1))
  guard
  if [ "$rc" -ne 1 ]; then
    case_fail "$id" "expected rc=1, got rc=${rc}"
    return
  fi
  for needle in "$@"; do
    grep -q -F -- "$needle" "$err" || case_fail "$id" "missing hit '${needle}'"
  done
}

# --- green: the fixed tree -------------------------------------------------------------------
fresh
expect_green green-fixed-tree
run=$((run + 1))
if grep -q 'SERVICE_NAME' "$err"; then
  case_fail green-env-var-line "SERVICE_NAME=<service> env line was reported"
fi

# --- AC-1 / AC-2: verbatim pre-fix assets ----------------------------------------------------
fresh
cp "${FX}/alert-rules.prefix.yaml" "${tree}/packages/otel/alerts/alert-rules.yaml"
expect_hit AC-1-red "AC-1 P1 packages/otel/alerts/alert-rules.yaml:"

fresh
cp "${FX}/service-health.prefix.json" "${tree}/packages/otel/dashboards/service-health.prefix.json"
expect_hit AC-2-red "AC-2 P1 packages/otel/dashboards/service-health.prefix.json:"

# --- AC-3: one case per pre-fix cite -------------------------------------------------------
while IFS=$'\t' read -r cid tag rel line; do
  fresh
  append "$rel" "$line"
  expect_hit "AC-3-${cid}" "AC-3 ${tag} ${rel}:"
done <"${FX}/fr4.prefix.tsv"

# root findings row: the pre-fix row (no defect basename) trips above; the real NARROWed row is green
run=$((run + 1))
if ! grep -q -F "$DEFECT" "${REPO_ROOT}/docs/context-constitution-findings.md"; then
  case_fail root-findings-narrowed "root findings row does not carry the defect basename"
fi
# otel findings rows are asserted by content, never by line number
run=$((run + 1))
if ! grep -q -F "$DEFECT" "${REPO_ROOT}/packages/otel/docs/context-constitution-findings.md"; then
  case_fail otel-findings-content "otel findings do not carry the defect basename"
fi

# --- a line carrying several tags reports each one ------------------------------------------
fresh
append docs/setup/grafana-cloud.md "$(tsv_field s6-258 4)"
expect_hit multi-tag-p99-and-uids \
  "AC-3 P2-generic docs/setup/grafana-cloud.md:" "AC-3 P3-name docs/setup/grafana-cloud.md:"

fresh
append docs/setup/grafana-cloud.md "see xstk-error-rate-high and mute-timings.yaml"
expect_hit multi-tag-name-and-file \
  "AC-3 P3-name docs/setup/grafana-cloud.md:" "AC-3 P3-file docs/setup/grafana-cloud.md:"

# --- the sanctioned literal is stripped case-exactly ----------------------------------------
fresh
append docs/patterns/observability.md "$SANCTIONED"
expect_green strip-exact-literal

fresh
append docs/patterns/observability.md "metrics and logs are not exported (feature 226)."
expect_hit strip-recased-literal "AC-3 P2-generic docs/patterns/observability.md:"

# --- the follow-up path is stripped case-exactly, and only the path ---------------------------
fresh
append packages/otel/alerts/README.md "See ${FOLLOWUP}"
append docs/setup/grafana-cloud.md "See ${FOLLOWUP}"
expect_green followup-exact-path

fresh
append packages/otel/alerts/README.md "See docs/roadmap/features/274-OTEL-metrics-logs-export/"
expect_hit followup-recased-path "AC-3 P2-generic packages/otel/alerts/README.md:"

fresh
append packages/otel/alerts/README.md "See ${FOLLOWUP} restores metrics and logs"
expect_hit followup-trailing-prose "AC-3 P2-generic packages/otel/alerts/README.md:"

# --- removed-assets fence ---------------------------------------------------------------
fresh
append docs/setup/grafana-cloud.md "$OPEN"
append docs/setup/grafana-cloud.md "$RULE_LINE"
append docs/setup/grafana-cloud.md "$CLOSE"
expect_green fence-removed-uid-passes

fresh
append docs/setup/grafana-cloud.md "$RULE_LINE"
expect_hit fence-same-line-unfenced "AC-3 P3-name docs/setup/grafana-cloud.md:"

fresh
append docs/setup/grafana-cloud.md "$OPEN"
append docs/setup/grafana-cloud.md "Delete these by hand."
append docs/setup/grafana-cloud.md "$CLOSE"
expect_hit fence-prose-inside "AC-3 P3-fence docs/setup/grafana-cloud.md:"

fresh
append docs/setup/grafana-cloud.md "$OPEN"
append docs/setup/grafana-cloud.md "$RULE_LINE"
expect_hit fence-unclosed "AC-3 P3-fence docs/setup/grafana-cloud.md:"

fresh
append docs/setup/grafana-cloud.md "$OPEN"
append docs/setup/grafana-cloud.md "$EXISTING_FILE_LINE"
append docs/setup/grafana-cloud.md "$CLOSE"
expect_hit fence-still-existing-file "AC-3 P3-fence docs/setup/grafana-cloud.md:"

fresh
append docs/setup/grafana-cloud.md "$OPEN"
append docs/setup/grafana-cloud.md "$RULE_LINE_ASCII"
append docs/setup/grafana-cloud.md "$CLOSE"
expect_green fence-ascii-separator

# --- a comment can never make a deleted asset count as existing -------------------------------
fresh
append packages/otel/alerts/alert-rules.yaml "# removed xstk-error-rate-high"
append docs/setup/grafana-cloud.md "xstk-error-rate-high"
expect_hit comment-does-not-create-existence "AC-3 P3-name docs/setup/grafana-cloud.md:"

# --- removal prose states a count that is wrong ----------------------------------------------
fresh
append packages/otel/alerts/README.md "Delete the three alert rules below"
expect_hit removal-prose-count "AC-3 P3-count packages/otel/alerts/README.md:"

# --- dashboard fallback tree: no dashboard JSON ------------------------------------------------
fallback_tree() {
  local f
  fresh
  rm -f "${tree}"/packages/otel/dashboards/*.json
  while IFS= read -r f; do
    grep -v 'service-health' "$f" >"${work}/stripped" || true
    cp "${work}/stripped" "$f"
  done < <(grep -rl 'service-health' "${tree}/docs" "${tree}/packages/otel" 2>/dev/null)
}

fallback_tree
append packages/otel/dashboards/README.md "$OPEN"
append packages/otel/dashboards/README.md "$DASH_LINE"
append packages/otel/dashboards/README.md "$EXISTING_FILE_LINE"
append packages/otel/dashboards/README.md "$CLOSE"
expect_green fallback-fenced

fallback_tree
append packages/otel/dashboards/README.md "$DASH_LINE"
append packages/otel/dashboards/README.md "$EXISTING_FILE_LINE"
expect_hit fallback-unfenced "AC-3 P3-name packages/otel/dashboards/README.md:"

# --- C-16: the attribute set stays documented, without trading_mode ----------------------------
fresh
run=$((run + 1))
readme="${tree}/packages/otel/dashboards/README.md"
for attr in 'service\.name' 'deployment\.environment' 'platform'; do
  grep -q -E "$attr" "$readme" || case_fail c16-attributes "dashboards README lost '${attr}'"
done
if grep -q 'trading_mode' "$readme"; then
  case_fail c16-trading-mode "dashboards README mentions trading_mode"
fi

# --- the follow-up citation is identical in all four places and the dir exists -------------------
run=$((run + 1))
cites=""
for f in packages/otel/alerts/README.md docs/setup/grafana-cloud.md \
  packages/otel/docs/context-constitution-findings.md docs/context-constitution-findings.md; do
  hit="$(grep -o -E 'docs/roadmap/features/274-otel-metrics-logs-export/' "${REPO_ROOT}/${f}" | sort -u)"
  if [ -z "$hit" ]; then
    case_fail followup-citation "no follow-up citation in ${f}"
  fi
  cites="${cites}${hit}"$'\n'
done
if [ "$(printf '%s' "$cites" | sort -u | grep -c .)" -ne 1 ]; then
  case_fail followup-citation "citations differ across the four files"
fi
if [ ! -d "${REPO_ROOT}/${FOLLOWUP}" ]; then
  case_fail followup-dir-exists "${FOLLOWUP} does not exist"
fi

# --- the guard does not depend on the defect report file ------------------------------------
fresh
rm -f "${tree}/docs/reports/2026-10-19-${DEFECT}.md"
expect_green defect-report-independence

# --- .feature files are outside the guard glob -------------------------------------------------
fresh
append docs/sdd/business-rules/platform.feature "  # Loki and Prometheus appear here on purpose"
expect_green feature-files-excluded

echo "cases=${run} failed=${failed}"
if [ "$run" -eq 0 ] || [ "$failed" -gt 0 ]; then
  exit 1
fi
exit 0
