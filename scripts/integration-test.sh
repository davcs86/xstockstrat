#!/usr/bin/env bash
# xstockstrat Platform — Phase 6 Integration Test
#
# Exercises the full end-to-end trading flow across all services using
# Connect-RPC HTTP endpoints (port 805X). Mirrors Verification Checkpoint 6
# in _tasks/x-implementation-roadmap.md.
#
# Usage:
#   ./scripts/integration-test.sh
#
# Environment overrides:
#   BASE_HOST          Service hostname (default: localhost)
#   TIMEOUT_SECONDS    Async poll timeout in seconds (default: 120)
#   ADMIN_USER         Admin username (default: admin)
#   ADMIN_PASS         Admin password (default: admin)
#   TRADING_MODE       Trading mode for orders (default: PAPER)
#   TEST_SYMBOL        Symbol to use in tests (default: AAPL)
#   SKIP_BACKFILL      Set to 1 to skip the slow backfill step

set -uo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
BASE_HOST="${BASE_HOST:-localhost}"
TIMEOUT="${TIMEOUT_SECONDS:-120}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-admin}"
TRADING_MODE="${TRADING_MODE:-PAPER}"
TEST_SYMBOL="${TEST_SYMBOL:-AAPL}"
SKIP_BACKFILL="${SKIP_BACKFILL:-0}"

CONFIG_URL="http://${BASE_HOST}:8060"
LEDGER_URL="http://${BASE_HOST}:8057"
IDENTITY_URL="http://${BASE_HOST}:8058"
NOTIFY_URL="http://${BASE_HOST}:8059"
TRADING_URL="http://${BASE_HOST}:8051"
PORTFOLIO_URL="http://${BASE_HOST}:8052"
MARKETDATA_URL="http://${BASE_HOST}:8053"
INDICATORS_URL="http://${BASE_HOST}:8054"
INGEST_URL="http://${BASE_HOST}:8055"
ANALYSIS_URL="http://${BASE_HOST}:8056"
TRADER_UI_URL="http://${BASE_HOST}:3000"
INSIGHTS_UI_URL="http://${BASE_HOST}:3001"
CONFIG_UI_URL="http://${BASE_HOST}:3002"

PASS=0
FAIL=0
SKIP=0
TOKEN=""
ORDER_ID=""
JOB_ID=""

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${CYAN}[TEST]${NC} $*"; }
ok()   { echo -e "${GREEN}[PASS]${NC} $*"; PASS=$((PASS + 1)); }
fail() { echo -e "${RED}[FAIL]${NC} $*"; FAIL=$((FAIL + 1)); }
skip() { echo -e "${YELLOW}[SKIP]${NC} $*"; SKIP=$((SKIP + 1)); }
sep()  { echo -e "\n${CYAN}───────────────────────────────────────────────────${NC}"; }

# check <description> <expected_pattern> <command...>
# Runs the command and checks stdout against expected_pattern (grep -q).
check() {
  local desc="$1"
  local pattern="$2"
  shift 2
  local output
  if output=$("$@" 2>&1); then
    if echo "$output" | grep -q "$pattern"; then
      ok "$desc"
      echo "$output"
      return 0
    else
      fail "$desc — response did not match pattern '${pattern}'"
      echo "  Output: $output"
      return 1
    fi
  else
    fail "$desc — command failed (exit $?)"
    echo "  Output: $output"
    return 1
  fi
}

# post <url> <json_body> — POST with Content-Type application/json, returns body
post() {
  curl -sf -X POST "$1" \
    -H "Content-Type: application/json" \
    ${TOKEN:+-H "Authorization: Bearer ${TOKEN}"} \
    -d "$2"
}

# post_raw — same as post but without -f (so we can inspect error responses)
post_raw() {
  curl -s -X POST "$1" \
    -H "Content-Type: application/json" \
    ${TOKEN:+-H "Authorization: Bearer ${TOKEN}"} \
    -d "$2"
}

# get <url> — GET with optional auth
get() {
  curl -sf "$1" \
    ${TOKEN:+-H "Authorization: Bearer ${TOKEN}"}
}

# poll_until <description> <check_command> — retries every 5s up to TIMEOUT
poll_until() {
  local desc="$1"
  shift
  local elapsed=0
  while true; do
    if output=$("$@" 2>&1) && echo "$output" | grep -qE "COMPLETED|completed"; then
      ok "$desc (completed in ${elapsed}s)"
      echo "$output"
      return 0
    fi
    if [ $elapsed -ge "$TIMEOUT" ]; then
      fail "$desc — timed out after ${TIMEOUT}s"
      echo "  Last output: $output"
      return 1
    fi
    sleep 5
    elapsed=$((elapsed + 5))
    log "  Waiting... ${elapsed}s / ${TIMEOUT}s"
  done
}

# ---------------------------------------------------------------------------
# Test Sections
# ---------------------------------------------------------------------------

section_0_health() {
  sep
  log "SECTION 0 — Health checks"

  check "config health"      '"status"'  curl -sf "${CONFIG_URL}/health"
  check "ledger health"      '"status"'  curl -sf "${LEDGER_URL}/health"
  check "identity health"    '"status"'  curl -sf "${IDENTITY_URL}/health"
  check "notify health"      '"status"'  curl -sf "${NOTIFY_URL}/health"
  check "trading health"     '"status"'  curl -sf "${TRADING_URL}/health"
  check "portfolio health"   '"status"'  curl -sf "${PORTFOLIO_URL}/health"
  check "marketdata health"  '"status"'  curl -sf "${MARKETDATA_URL}/health"
  check "indicators health"  '"status"'  curl -sf "${INDICATORS_URL}/health"
  check "ingest health"      '"status"'  curl -sf "${INGEST_URL}/health"
  check "analysis health"    '"status"'  curl -sf "${ANALYSIS_URL}/health"
  check "trader UI health"      '"status"'  curl -sf "${TRADER_UI_URL}/health"
  check "insights UI health"    '"status"'  curl -sf "${INSIGHTS_UI_URL}/health"
  check "config-ui health"      '"status"'  curl -sf "${CONFIG_UI_URL}/health"
}

section_1_auth() {
  sep
  log "SECTION 1 — Authentication"

  local resp
  resp=$(post_raw \
    "${IDENTITY_URL}/xstockstrat.identity.v1.IdentityService/AuthenticateUser" \
    "{\"username\":\"${ADMIN_USER}\",\"password\":\"${ADMIN_PASS}\"}")

  if echo "$resp" | grep -q "access_token"; then
    TOKEN=$(echo "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('access_token',''))" 2>/dev/null || \
            echo "$resp" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)
    if [ -n "$TOKEN" ]; then
      ok "AuthenticateUser — token received"
    else
      fail "AuthenticateUser — could not extract token from response"
      echo "  Response: $resp"
    fi
  else
    fail "AuthenticateUser — no access_token in response"
    echo "  Response: $resp"
  fi
}

section_2_config() {
  sep
  log "SECTION 2 — Config service"

  check "GetConfig (platform keys)" '"entries"' \
    post "${CONFIG_URL}/xstockstrat.config.v1.ConfigService/GetConfig" \
    '{"environment":"DEV","trading_mode":"ALL"}'

  check "ListKeys" '"keys"' \
    post "${CONFIG_URL}/xstockstrat.config.v1.ConfigService/ListKeys" \
    '{"namespace":"platform"}'
}

section_3_ledger() {
  sep
  log "SECTION 3 — Ledger service"

  local resp
  resp=$(post \
    "${LEDGER_URL}/xstockstrat.ledger.v1.LedgerService/AppendEvent" \
    '{"stream_key":"integration-test","event_type":"test.created","payload":"{\"run\":\"phase6\"}"}')

  if echo "$resp" | grep -q "sequence"; then
    ok "AppendEvent — sequence returned"
  else
    fail "AppendEvent — unexpected response"
    echo "  Response: $resp"
  fi

  check "QueryEvents (integration-test stream)" '"events"' \
    post "${LEDGER_URL}/xstockstrat.ledger.v1.LedgerService/QueryEvents" \
    '{"stream_key":"integration-test","limit":5}'
}

section_4_indicators() {
  sep
  log "SECTION 4 — Indicators service"

  check "ComputeIndicator (SMA)" '"points"\|"values"\|"result"' \
    post "${INDICATORS_URL}/xstockstrat.indicators.v1.IndicatorsService/ComputeIndicator" \
    "{\"symbol\":\"${TEST_SYMBOL}\",\"indicator\":\"SMA\",\"period\":20,\"timeframe\":\"1Day\"}"

  check "ExecuteFormula (sandbox)" '"result"\|"output"' \
    post "${INDICATORS_URL}/xstockstrat.indicators.v1.IndicatorsService/ExecuteFormula" \
    '{"formula":"result = sum(prices[-5:]) / 5","inputs":{"prices":[100,101,102,103,104]}}'

  # Sandbox timeout enforcement
  local sandbox_resp
  sandbox_resp=$(post_raw \
    "${INDICATORS_URL}/xstockstrat.indicators.v1.IndicatorsService/ExecuteFormula" \
    '{"formula":"import time; time.sleep(999)","inputs":{}}')
  if echo "$sandbox_resp" | grep -qiE "timeout|TIMEOUT|time_limit|time limit"; then
    ok "ExecuteFormula sandbox timeout enforced"
  else
    fail "ExecuteFormula sandbox — expected TIMEOUT exit reason"
    echo "  Response: $sandbox_resp"
  fi
}

section_5_ingest_signal() {
  sep
  log "SECTION 5 — Ingest: newsletter signal"

  local signal_resp
  signal_resp=$(post \
    "${INGEST_URL}/xstockstrat.ingest.v1.IngestService/IngestSignal" \
    "{
      \"signal\": {
        \"source\": \"unusual_whales\",
        \"symbol\": \"${TEST_SYMBOL}\",
        \"direction\": \"buy\",
        \"conviction\": 0.8,
        \"valid_from\": \"2024-01-01T00:00:00Z\",
        \"headline\": \"Integration test signal — Phase 6\"
      }
    }")

  if echo "$signal_resp" | grep -q "signal_id"; then
    ok "IngestSignal — signal_id returned"
  else
    fail "IngestSignal — unexpected response"
    echo "  Response: $signal_resp"
  fi

  check "QuerySignals" '"signals"' \
    post "${INGEST_URL}/xstockstrat.ingest.v1.IngestService/QuerySignals" \
    "{\"symbol\":\"${TEST_SYMBOL}\",\"active_window\":{\"start\":\"2024-01-01T00:00:00Z\",\"end\":\"2024-01-15T00:00:00Z\"}}"
}

section_6_backfill() {
  sep
  log "SECTION 6 — Backfill pipeline"

  if [ "$SKIP_BACKFILL" = "1" ]; then
    skip "Backfill (SKIP_BACKFILL=1)"
    return 0
  fi

  local backfill_resp
  backfill_resp=$(post \
    "${INGEST_URL}/xstockstrat.ingest.v1.IngestService/TriggerBackfill" \
    "{\"symbol\":\"${TEST_SYMBOL}\",\"start\":\"2024-07-01T00:00:00Z\",\"end\":\"2024-12-31T00:00:00Z\",\"timeframe\":\"1Day\"}")

  if echo "$backfill_resp" | grep -q "job_id"; then
    JOB_ID=$(echo "$backfill_resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('job_id',''))" 2>/dev/null || \
             echo "$backfill_resp" | grep -o '"job_id":"[^"]*"' | cut -d'"' -f4)
    ok "TriggerBackfill — job_id=${JOB_ID}"
  else
    fail "TriggerBackfill — unexpected response"
    echo "  Response: $backfill_resp"
    return 1
  fi

  poll_until "GetBackfillStatus (${TEST_SYMBOL} 6mo)" \
    post "${INGEST_URL}/xstockstrat.ingest.v1.IngestService/GetBackfillStatus" \
    "{\"job_id\":\"${JOB_ID}\"}"
}

section_7_backtest() {
  sep
  log "SECTION 7 — Analysis: backtest"

  check "RunBacktest (sma_crossover)" '"sharpe_ratio"\|"total_return"\|"win_rate"' \
    post "${ANALYSIS_URL}/xstockstrat.analysis.v1.AnalysisService/RunBacktest" \
    "{
      \"strategy_id\": \"sma_crossover\",
      \"symbol\": \"${TEST_SYMBOL}\",
      \"start\": \"2024-07-01T00:00:00Z\",
      \"end\": \"2024-12-31T00:00:00Z\",
      \"trading_mode\": \"${TRADING_MODE}\"
    }"
}

section_8_place_order() {
  sep
  log "SECTION 8 — Trading: place order"

  local order_resp
  order_resp=$(post \
    "${TRADING_URL}/xstockstrat.trading.v1.TradingService/PlaceOrder" \
    "{
      \"symbol\": \"${TEST_SYMBOL}\",
      \"side\": \"BUY\",
      \"type\": \"MARKET\",
      \"qty\": 10,
      \"trading_mode\": \"${TRADING_MODE}\"
    }")

  if echo "$order_resp" | grep -q "order_id"; then
    ORDER_ID=$(echo "$order_resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('order_id',''))" 2>/dev/null || \
               echo "$order_resp" | grep -o '"order_id":"[^"]*"' | cut -d'"' -f4)
    ok "PlaceOrder — order_id=${ORDER_ID}"
  else
    fail "PlaceOrder — unexpected response"
    echo "  Response: $order_resp"
    return 1
  fi

  check "ListOrders — order appears" '"orders"\|"order_id"' \
    post "${TRADING_URL}/xstockstrat.trading.v1.TradingService/ListOrders" \
    "{\"trading_mode\":\"${TRADING_MODE}\",\"limit\":5}"
}

section_9_event_chain() {
  sep
  log "SECTION 9 — Ledger event chain for order"

  if [ -z "$ORDER_ID" ]; then
    skip "Ledger event chain — ORDER_ID not set (PlaceOrder failed)"
    return 0
  fi

  # Poll for the order.created event (fill may take a few seconds)
  local elapsed=0
  local found=0
  while [ $elapsed -lt 30 ]; do
    local events_resp
    events_resp=$(post \
      "${LEDGER_URL}/xstockstrat.ledger.v1.LedgerService/QueryEvents" \
      "{\"stream_key\":\"order.${ORDER_ID}\",\"limit\":10}")
    if echo "$events_resp" | grep -q "order.created"; then
      ok "Ledger event chain — order.created found"
      echo "$events_resp" | python3 -c \
        "import sys,json; d=json.load(sys.stdin); [print('  event:', e.get('event_type'), 'seq:', e.get('sequence')) for e in d.get('events',[])]" 2>/dev/null || true
      found=1
      break
    fi
    sleep 3
    elapsed=$((elapsed + 3))
  done
  [ $found -eq 1 ] || fail "Ledger event chain — order.created not found within 30s"
}

section_10_portfolio() {
  sep
  log "SECTION 10 — Portfolio update"

  # Give the fill poller time to process (trading polls every 5s)
  log "  Waiting 10s for fill poller..."
  sleep 10

  check "GetPortfolio — position present" '"positions"\|"portfolio"' \
    post "${PORTFOLIO_URL}/xstockstrat.portfolio.v1.PortfolioService/GetPortfolio" \
    "{\"trading_mode\":\"${TRADING_MODE}\"}"
}

section_11_notify() {
  sep
  log "SECTION 11 — Notify: trade alert"

  check "ListAlerts (trade category)" '"alerts"\|"alert"' \
    post "${NOTIFY_URL}/xstockstrat.notify.v1.NotifyService/ListAlerts" \
    '{"categories":["trade"],"limit":5}'
}

section_12_n8n_webhook() {
  sep
  log "SECTION 12 — n8n webhook: config set-config"

  local webhook_resp
  webhook_resp=$(post_raw \
    "${CONFIG_URL}/webhooks/n8n/set-config" \
    "{
      \"key\": \"platform.log_level\",
      \"value\": {\"string_val\": \"debug\"},
      \"environment\": \"DEV\",
      \"trading_mode\": \"ALL\",
      \"author\": \"integration-test\",
      \"reason\": \"Phase 6 integration test\"
    }")

  if echo "$webhook_resp" | grep -qE "ok|success|updated|string_val"; then
    ok "n8n webhook set-config — accepted"
  else
    fail "n8n webhook set-config — unexpected response"
    echo "  Response: $webhook_resp"
  fi

  # Reset log level back to info
  post_raw "${CONFIG_URL}/webhooks/n8n/set-config" \
    '{"key":"platform.log_level","value":{"string_val":"info"},"environment":"DEV","trading_mode":"ALL","author":"integration-test","reason":"reset after Phase 6 test"}' \
    > /dev/null 2>&1 || true
  log "  Reset platform.log_level to 'info'"
}

section_13_maintenance_mode() {
  sep
  log "SECTION 13 — Maintenance mode propagation"

  log "  Setting platform.maintenance_mode = true..."
  post_raw \
    "${CONFIG_URL}/xstockstrat.config.v1.ConfigService/SetConfig" \
    '{"key":"platform.maintenance_mode","value":{"bool_val":true},"environment":"DEV","trading_mode":"ALL"}' \
    > /dev/null 2>&1 || \
  post_raw \
    "${CONFIG_URL}/webhooks/n8n/set-config" \
    '{"key":"platform.maintenance_mode","value":{"bool_val":true},"environment":"DEV","trading_mode":"ALL","author":"integration-test","reason":"maintenance mode test"}' \
    > /dev/null 2>&1 || true

  log "  Waiting 3s for WatchConfig propagation..."
  sleep 3

  local order_resp
  order_resp=$(post_raw \
    "${TRADING_URL}/xstockstrat.trading.v1.TradingService/PlaceOrder" \
    "{
      \"symbol\": \"${TEST_SYMBOL}\",
      \"side\": \"BUY\",
      \"type\": \"MARKET\",
      \"qty\": 1,
      \"trading_mode\": \"${TRADING_MODE}\"
    }")

  if echo "$order_resp" | grep -qiE "maintenance|unavailable|rejected|error|code.*13|UNAVAILABLE"; then
    ok "Maintenance mode — PlaceOrder correctly rejected"
  else
    fail "Maintenance mode — PlaceOrder was NOT rejected (expected rejection)"
    echo "  Response: $order_resp"
  fi

  log "  Resetting platform.maintenance_mode = false..."
  post_raw \
    "${CONFIG_URL}/xstockstrat.config.v1.ConfigService/SetConfig" \
    '{"key":"platform.maintenance_mode","value":{"bool_val":false},"environment":"DEV","trading_mode":"ALL"}' \
    > /dev/null 2>&1 || \
  post_raw \
    "${CONFIG_URL}/webhooks/n8n/set-config" \
    '{"key":"platform.maintenance_mode","value":{"bool_val":false},"environment":"DEV","trading_mode":"ALL","author":"integration-test","reason":"maintenance mode test cleanup"}' \
    > /dev/null 2>&1 || true

  log "  Maintenance mode cleared."
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║  xstockstrat — Phase 6 Integration Test          ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"
  echo "  BASE_HOST:     ${BASE_HOST}"
  echo "  TRADING_MODE:  ${TRADING_MODE}"
  echo "  TEST_SYMBOL:   ${TEST_SYMBOL}"
  echo "  TIMEOUT:       ${TIMEOUT}s"
  echo "  SKIP_BACKFILL: ${SKIP_BACKFILL}"
  echo ""

  section_0_health
  section_1_auth
  section_2_config
  section_3_ledger
  section_4_indicators
  section_5_ingest_signal
  section_6_backfill
  section_7_backtest
  section_8_place_order
  section_9_event_chain
  section_10_portfolio
  section_11_notify
  section_12_n8n_webhook
  section_13_maintenance_mode

  sep
  echo ""
  echo -e "  ${GREEN}PASS: ${PASS}${NC}   ${RED}FAIL: ${FAIL}${NC}   ${YELLOW}SKIP: ${SKIP}${NC}"
  echo ""

  if [ "$FAIL" -gt 0 ]; then
    echo -e "${RED}Integration test FAILED — ${FAIL} test(s) did not pass.${NC}"
    exit 1
  else
    echo -e "${GREEN}Integration test PASSED — all ${PASS} checks succeeded.${NC}"
    exit 0
  fi
}

main "$@"
