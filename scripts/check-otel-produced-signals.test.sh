#!/usr/bin/env bash
# Regression cases for scripts/check-otel-produced-signals.sh (features 250 and 274). Each case builds a
# throwaway copy of the OTel assets, docs and registered producer files, mutates it, and asserts the
# guard's exit code and hit prefix. Verbatim pre-250 text lives in scripts/testdata/otel-produced-signals/.
# No network.
# Records every failure and exits once at the end; only the missing-guard check exits at once.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK="${REPO_ROOT}/scripts/check-otel-produced-signals.sh"
FX="${REPO_ROOT}/scripts/testdata/otel-produced-signals"
OPEN="<!-- otel-guard:removed-assets -->"
CLOSE="<!-- /otel-guard:removed-assets -->"
RULE_LINE="- \`xstk-retired-fake\` — alert rule"
RULE_LINE_ASCII="- \`xstk-retired-fake\` - alert rule"
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
  cp -R "${REPO_ROOT}/.do" "${tree}/"
  cp "${REPO_ROOT}/docker-compose.yml" "${tree}/"
  copy_protos
  copy_producers
}

copy_protos() {
  local f svc
  for f in "${REPO_ROOT}"/packages/proto/*/v1/*.proto; do
    svc="$(basename "$(dirname "$(dirname "$f")")")"
    mkdir -p "${tree}/packages/proto/${svc}/v1"
    cp "$f" "${tree}/packages/proto/${svc}/v1/"
  done
}

# The matcher the guard must see, derived independently from the protos.
stream_matcher() {
  grep -h -E '^[[:space:]]*rpc[[:space:]]+[A-Za-z0-9_]+.*returns[[:space:]]*\([[:space:]]*stream[[:space:]]' \
    "${REPO_ROOT}"/packages/proto/*/v1/*.proto |
    sed -E 's/^[[:space:]]*rpc[[:space:]]+([A-Za-z0-9_]+).*/\1/' | sort -u | paste -sd'|' -
}

# A rule selector for $1 carrying the given matcher body (empty = bare selector).
rule_expr() {
  if [ -n "$2" ]; then
    printf '      expr: sum(rate(%s{%s}[5m]))' "$1" "$2"
  else
    printf '      expr: sum(rate(%s[5m]))' "$1"
  fi
}

# Copies every file the registry names as a producer, so registry integrity runs on the throwaway tree.
copy_producers() {
  local ln=0 kind paths pth old_ifs
  while IFS=$'\t' read -r kind _ paths _; do
    ln=$((ln + 1))
    if [ "$ln" -eq 1 ] || [ -z "$kind" ]; then continue; fi
    old_ifs="$IFS"
    IFS=,
    for pth in $paths; do
      mkdir -p "${tree}/$(dirname "$pth")"
      cp "${REPO_ROOT}/${pth}" "${tree}/${pth}"
    done
    IFS="$old_ifs"
  done <"${REPO_ROOT}/packages/otel/produced-signals.tsv"
}

guard() {
  bash "$CHECK" "$tree" </dev/null >/dev/null 2>"$err"
  rc=$?
}

append() {
  printf '%s\n' "$2" >>"${tree}/$1"
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

# --- green: the real tree --------------------------------------------------------------------
fresh
expect_green green-real-tree
run=$((run + 1))
if grep -q 'SERVICE_NAME' "$err"; then
  case_fail green-env-var-line "SERVICE_NAME=<service> env line was reported"
fi

# --- AC-8: the allowlist --------------------------------------------------------------------------
fresh
append packages/otel/alerts/alert-rules.yaml "      expr: rpc_client_bogus_total"
expect_hit AC-8-unregistered-metric "AC-8 P1 packages/otel/alerts/alert-rules.yaml:" "rpc_client_bogus_total"

fresh
append packages/otel/alerts/alert-rules.yaml "      expr: sum by (service_name) (rate(mcp_tool_duration_milliseconds_count[5m]))"
expect_green AC-8-registered-metric-passes

fresh
append packages/otel/alerts/alert-rules.yaml "      expr: |"
append packages/otel/alerts/alert-rules.yaml "        sum(count_over_time({service_name=\"nosuch\"} [5m]))"
expect_hit AC-8-unregistered-service-name "AC-8 P1 packages/otel/alerts/alert-rules.yaml:" 'service_name="nosuch"'

fresh
append packages/otel/alerts/alert-rules.yaml "      expr: sum(count_over_time({service_name=\"analysis\"} |= \"never produced\" [5m]))"
expect_hit AC-8-unregistered-loki-literal "AC-8 P1 packages/otel/alerts/alert-rules.yaml:" '|= "never produced"'

fresh
append packages/otel/alerts/alert-rules.yaml "      expr: sum(count_over_time({service_name=\"analysis\"} |= \"live_loop: cycle complete\" | json | level=~\"info\" [30m]))"
expect_green AC-8-registered-loki-passes

fresh
cp "${FX}/alert-rules.prefix.yaml" "${tree}/packages/otel/alerts/alert-rules.prefix.yaml"
expect_hit AC-8-verbatim-pre250-rule "AC-8 P1 packages/otel/alerts/alert-rules.prefix.yaml:" 'ScoreStrategy|RunBacktest'

fresh
sed -i.bak 's/mcp\.tool\.duration/mcp.tool.renamed/' "${tree}/services/xstockstrat-agent/app/tool_metrics.py"
rm -f "${tree}/services/xstockstrat-agent/app/tool_metrics.py.bak"
expect_hit AC-8-producer-literal-drift "AC-8 P1-producer packages/otel/produced-signals.tsv:" "mcp_tool_duration_milliseconds_count"

fresh
rm -f "${tree}/packages/otel/produced-signals.tsv"
expect_hit AC-8-registry-missing "AC-8 P1-producer packages/otel/produced-signals.tsv:"

# --- AC-17: Part 4, the proto-derived stream exclusion ---------------------------------------------
M="rpc_method!~\"$(stream_matcher)\""

fresh
append packages/otel/alerts/alert-rules.yaml "$(rule_expr rpc_server_duration_milliseconds_count "$M")"
expect_green AC-17-selector-with-matcher-passes

for suffix in count bucket sum; do
  fresh
  append packages/otel/alerts/alert-rules.yaml "$(rule_expr "rpc_server_duration_milliseconds_${suffix}" "")"
  expect_hit "AC-17-bare-${suffix}" "AC-17 P4 packages/otel/alerts/alert-rules.yaml:" "rpc_server_duration_milliseconds_${suffix}"

  fresh
  append packages/otel/alerts/alert-rules.yaml "$(rule_expr "rpc_server_duration_milliseconds_${suffix}" 'service_name="analysis"')"
  expect_hit "AC-17-other-matchers-${suffix}" "AC-17 P4 packages/otel/alerts/alert-rules.yaml:"
done

dash() {
  cat >"${tree}/packages/otel/dashboards/service-health.json" <<DASH_EOF
{
  "templating": { "list": [ {
    "query": "label_values(rpc_server_duration_milliseconds_count, service_name)"
  } ] },
  "uid": "xstk-service-health",
  "panels": [ { "targets": [ {
    "expr": "$1"
  } ] } ]
}
DASH_EOF
}

fresh
dash 'sum(mcp_tool_duration_milliseconds_count)'
expect_green AC-17-label-values-templating-exempt

fresh
dash 'sum(rpc_server_duration_milliseconds_count)'
expect_hit AC-17-same-selector-in-target-fails "AC-17 P4 packages/otel/dashboards/service-health.json:"

fresh
dash "sum(rpc_server_duration_milliseconds_count{${M//\"/\\\"}})"
expect_green AC-17-dashboard-target-with-matcher

fresh
append packages/otel/alerts/alert-rules.yaml "$(rule_expr rpc_server_duration_milliseconds_count "$M")"
append packages/proto/notify/v1/notify.proto "rpc StreamFoo(Req) returns (stream Resp);"
expect_hit AC-17-new-stream-rpc-needs-matcher "AC-17 P4 packages/otel/alerts/alert-rules.yaml:" "StreamFoo"

fresh
append packages/proto/notify/v1/notify.proto "rpc Foo(Req);"
expect_hit AC-17-rpc-without-returns "AC-17 P4 packages/proto/notify/v1/notify.proto:"

fresh
append packages/proto/marketdata/v1/marketdata.proto "rpc GetBars(Req) returns (stream Resp);"
expect_hit AC-17-stream-named-like-unary "AC-17 P4 packages/proto:" "GetBars"

fresh
append packages/otel/alerts/alert-rules.yaml "$(rule_expr rpc_server_duration_milliseconds_count "$M")"
append packages/proto/notify/v1/notify.proto "// rpc StreamFoo(Req) returns (stream Resp);"
expect_green AC-17-commented-stream-ignored

fresh
append .do/app.yaml "  - key: OTEL_TRACES_SAMPLER"
expect_hit AC-17-sampler-in-do-spec "AC-17 P4-sampler .do/app.yaml:"

fresh
append docker-compose.yml "      OTEL_PYTHON_GRPC_EXCLUDED_SERVICES: x"
expect_hit AC-17-grpc-exclusion-in-compose "AC-17 P4-sampler docker-compose.yml:"

# --- AC-8 / AC-14: alert rule invariants (Part 5) ---------------------------------------------------
fresh
expect_green AC-14-real-rules-pass
run=$((run + 1))
[ "$(grep -c -E '^[[:space:]]+- uid:' "${tree}/packages/otel/alerts/alert-rules.yaml")" -eq 3 ] ||
  case_fail AC-14-three-rules "the real tree does not declare three rules"

fresh
awk '/noDataState:/ && !done { done = 1; next } { print }' "${tree}/packages/otel/alerts/alert-rules.yaml" >"${work}/ar" &&
  cp "${work}/ar" "${tree}/packages/otel/alerts/alert-rules.yaml"
expect_hit AC-8-rule-without-nodatastate "AC-8 P5 packages/otel/alerts/alert-rules.yaml:" "xstk-error-rate-high has no noDataState"

fresh
sed -i.bak 's/noDataState: Alerting/noDataState: OK/' "${tree}/packages/otel/alerts/alert-rules.yaml"
rm -f "${tree}/packages/otel/alerts/alert-rules.yaml.bak"
expect_hit AC-8-stall-rule-nodata-must-alert "AC-8 P5 packages/otel/alerts/alert-rules.yaml:" "xstk-analysis-no-scoring noDataState must be Alerting"

fresh
sed -i.bak '0,/noDataState: OK/s//noDataState: NoData/' "${tree}/packages/otel/alerts/alert-rules.yaml"
rm -f "${tree}/packages/otel/alerts/alert-rules.yaml.bak"
expect_hit AC-8-rpc-rule-nodata-must-be-ok "AC-8 P5 packages/otel/alerts/alert-rules.yaml:" "noDataState must be OK"

fresh
sed -i.bak 's/name: outside-us-market-hours/name: outside-market-hours/' "${tree}/packages/otel/alerts/mute-timings.yaml"
rm -f "${tree}/packages/otel/alerts/mute-timings.yaml.bak"
expect_hit AC-14-mute-timing-renamed "AC-14 P5 packages/otel/alerts/mute-timings.yaml:"

fresh
rm -f "${tree}/packages/otel/alerts/mute-timings.yaml"
expect_hit AC-14-mute-timing-file-missing "AC-14 P5 packages/otel/alerts/mute-timings.yaml:"

fresh
grep -v 'mute_outside_market_hours' "${tree}/packages/otel/alerts/alert-rules.yaml" >"${work}/ar" &&
  cp "${work}/ar" "${tree}/packages/otel/alerts/alert-rules.yaml"
expect_hit AC-14-stall-rule-label-dropped "AC-14 P5 packages/otel/alerts/alert-rules.yaml:" "mute_outside_market_hours"

# --- AC-14: restored dashboards reference only produced series ---------------------------------------
fresh
expect_green AC-14-real-dashboards-pass
run=$((run + 1))
n=0
for f in "${tree}"/packages/otel/dashboards/*.json; do n=$((n + 1)); done
[ "$n" -eq 5 ] || case_fail AC-14-dashboard-count "expected 5 dashboards, found ${n}"

run=$((run + 1))
grep -q '"query": "label_values(rpc_server_duration_milliseconds_count, service_name)"' \
  "${REPO_ROOT}/packages/otel/dashboards/service-health.json" ||
  case_fail AC-14-service-variable "service-health lacks the \$service variable over rpc_server_duration_milliseconds_count"

run=$((run + 1))
for input in DS_PROMETHEUS DS_LOKI DS_TEMPO; do
  grep -q "\"name\": \"${input}\"" "${REPO_ROOT}/packages/otel/dashboards/service-health.json" ||
    case_fail AC-14-datasource-inputs "service-health lacks the ${input} input"
done

fresh
dash 'sum(rate(rpc_client_bogus_total[5m]))'
expect_hit AC-14-unregistered-series-in-panel "AC-8 P1 packages/otel/dashboards/service-health.json:" "rpc_client_bogus_total"

fresh
dash 'sum(count_over_time({service_name=\"nosuch\"} [5m]))'
expect_hit AC-14-unregistered-service-in-panel "AC-8 P1 packages/otel/dashboards/service-health.json:" 'service_name="nosuch"'

fresh
dash 'sum(count_over_time({service_name=\"analysis\"} |= \"signal.ingested\" [5m]))'
expect_hit AC-14-unproduced-literal-in-panel "AC-8 P1 packages/otel/dashboards/service-health.json:" '|= "signal.ingested"'

fresh
dash 'sum(rate({service_name=\"trading\"} | detected_level=\"error\" [5m]))'
expect_green AC-14-metadata-filter-passes

fresh
dash 'sum(rate(rpc_server_duration_milliseconds_count{service_name=\"trading\"}[5m]))'
expect_hit AC-14-panel-selector-without-matcher "AC-17 P4 packages/otel/dashboards/service-health.json:"

# --- Part 2 is retired: signal talk in docs is free ---------------------------------------------
fresh
append docs/setup/grafana-cloud.md "Loki and Prometheus now carry rpc_server_duration_milliseconds with service_name=analysis; P99 per service."
append docs/patterns/observability.md "Metrics and logs are exported over OTLP."
expect_green AC-9-docs-free-text

# --- a line carrying several Part 3 tags reports each one -----------------------------------------
fresh
append docs/setup/grafana-cloud.md "see xstk-retired-fake and dashboards-gone.json"
expect_hit multi-tag-name-and-file \
  "AC-3 P3-name docs/setup/grafana-cloud.md:" "AC-3 P3-file docs/setup/grafana-cloud.md:"

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
append packages/otel/alerts/alert-rules.yaml "# removed xstk-retired-fake"
append docs/setup/grafana-cloud.md "xstk-retired-fake"
expect_hit comment-does-not-create-existence "AC-3 P3-name docs/setup/grafana-cloud.md:"

# --- removal prose states a count that is wrong ----------------------------------------------
fresh
append packages/otel/alerts/README.md "Delete the four alert rules below"
expect_hit removal-prose-count "AC-3 P3-count packages/otel/alerts/README.md:"

# --- dashboard fallback tree: no dashboard JSON ------------------------------------------------
fallback_tree() {
  local f
  fresh
  rm -f "${tree}"/packages/otel/dashboards/*.json
  while IFS= read -r f; do
    grep -v -E 'service-health|signal-pipeline|infrastructure|trading-service|marketdata-service' "$f" >"${work}/stripped" || true
    cp "${work}/stripped" "$f"
  done < <(grep -rl -E 'service-health|signal-pipeline|infrastructure|trading-service|marketdata-service' "${tree}/docs" "${tree}/packages/otel" 2>/dev/null)
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

# --- .feature files are outside the guard glob -------------------------------------------------
fresh
append docs/sdd/business-rules/platform.feature "  # Loki and Prometheus appear here on purpose"
expect_green feature-files-excluded

echo "cases=${run} failed=${failed}"
if [ "$run" -eq 0 ] || [ "$failed" -gt 0 ]; then
  exit 1
fi
exit 0
