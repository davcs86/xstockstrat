# Implementation Spec: position-sizing-engine

**Status**: `pending`
**Created**: 2026-08-06
**Feature**: `docs/roadmap/features/023-position-sizing-engine/feature.md`
**Total Steps**: 12
**Feature Branch**: `feature/position-sizing-engine`

---

## Execution Summary

Backend-only risk-adjusted position sizing, per `design.md`'s Chosen Approach: a new
`ComputePositionSize` method on `xstockstrat-trading`'s `TradingService`, wired into `PlaceOrder`'s
existing statement sequence. Order: (1) seed the four new config keys and register them in the
governance log, (2) add `confidence` to `PlaceOrderRequest` (additive proto field, buf-gen), (3) wire
a new `xstockstrat-trading → xstockstrat-marketdata` gRPC client (genuinely new — no client exists
today) with its own construction canary test, (4) implement `ComputePositionSize` (Wilder ATR from
`GetBars`, current price from `GetLatestQuote`, formula, fail-closed error handling) with unit tests
against fake gRPC client interfaces, (5) wire it into `PlaceOrder` — deleting the `qty<=0` handler
gate that currently makes the whole feature unreachable, unifying `checkPortfolioRisk` onto the same
equity call (fixing the `fails.md` 2026-07-01 C-10(b) two-equity-sources pattern) — with its own
paired tests, (6) update `xstockstrat-trading/CLAUDE.md`, (7) extend the `/trader` `OrderForm.tsx`
post-submit message to display the computed quantity/stop price (the pre-existing FR-7 consumer-surface
commitment — see design.md § Consumer surface (C-14) — which is unaffected by the confidence-wiring
UI work being dropped from this feature's scope).

**Explicitly out of scope, per design.md**: any UI wiring of the new `confidence` field itself
(`SignalOrderTicket`, `Opportunity`/`ExternalSignal.conviction` plumbing, making `qty` optional on any
`OrderForm` render site). `PlaceOrderRequest.confidence` ships correctly consumed but unpopulated by
any caller in this feature — deferred to the named follow-up feature
`110-wire-signal-confidence-to-position-sizing` (Constitution **C-14**). The **Agent** consumer surface
is N/A: `xstockstrat-agent` has no order-placement tool today (confirmed absent,
`services/xstockstrat-agent/app/tools.py`), so no agent-side step is required.

## Step Dependencies

- Step 3 (proto) must land before Step 6/8 (service steps read the generated `req.Confidence` field).
- Step 4 (marketdata client wiring) must land before Step 6 (`ComputePositionSize` calls the client).
- Step 6 must land before Step 8 (`PlaceOrder` calls `ComputePositionSize`).
- Step 8 depends on Step 6 (the function it wires in) and reuses Step 4's client.
- Step 1 (config keys) should land before Step 6/8 are exercised against a live deployment, though
  `config.Watcher`'s `Get*` methods fall back to the same defaults baked into the Go call sites even
  before the migration runs (verified safe for local `go test`, per Step 5's canary-test citation).
- Step 11/12 (UI) has no hard ordering dependency on the backend steps — `Order.qty`/`stop_price` are
  pre-existing, unchanged proto fields (no proto step required for the UI surface).
- Deferred, not part of this spec: `110-wire-signal-confidence-to-position-sizing` (confidence-input UI
  wiring — named per Constitution C-14, see design.md § Rejected Alternatives).

---

### Step 1 — migration: seed the four new `trading.risk.*` sizing config keys

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/011_trading_risk_sizing.up.sql` — create
- `services/xstockstrat-config/migrations/011_trading_risk_sizing.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, up+down pair present; `xstockstrat-config` owner —
config key naming, environment/trading_mode scoping

**Codebase Evidence**:
- Last migration confirmed via `ls services/xstockstrat-config/migrations/ | sort`: `010_config_audit_insert_trigger.{up,down}.sql` → next is `011`.
- Pattern to follow (per-env `dev`+`production`, `trading_mode='all'`, `ON CONFLICT ... DO NOTHING`):
  `services/xstockstrat-config/migrations/008_analysis_fundsignal_keys.up.sql:1-30` (recon.md's named
  reuse target) and its `.down.sql` (`DELETE FROM config.config_values WHERE namespace = 'analysis' AND key LIKE 'fundsignal.%'`).
- Unique constraint the `ON CONFLICT` targets: `config_values_namespace_key_env_mode_key UNIQUE (namespace, key, environment, trading_mode)` — `services/xstockstrat-config/migrations/002_config_environment.up.sql:20-21`.
- Product-spec's Config Key Changes section (`product-spec.md:79-82`) is the authoritative key list +
  defaults + descriptions.
- The existing, unrelated `trading.risk.max_position_pct` key (warn-only, `checkPortfolioRisk`) is
  **not** touched by this migration — design.md § Chosen Approach establishes it stays alongside the
  new enforcing `max_concentration_pct` (disjoint order populations — auto-sized vs. override-mode).

**TDD**: `N/A (migration — no code path executes this file directly; correctness is proven by the
paired Step 2 doc entry and by CI's real apply/rollback at deploy)`

**Instructions**:
1. Create `011_trading_risk_sizing.up.sql` inserting 8 rows (4 keys × 2 environments, `trading_mode='all'`
   for every row — no paper/live split, matching the product spec):
   - `('trading', 'risk.max_risk_per_trade_pct', 'float', '0.02', 'Fraction of equity to risk per trade (auto-sized orders only)', '0.02', 'xstockstrat-trading', 'dev', 'all')` (and the `production` twin)
   - `('trading', 'risk.atr_multiplier', 'float', '1.5', 'Stop distance as a multiple of ATR(14)', '1.5', 'xstockstrat-trading', 'dev', 'all')` (and `production`)
   - `('trading', 'risk.max_concentration_pct', 'float', '0.10', 'Max fraction of equity in any single auto-sized position (enforcing cap)', '0.10', 'xstockstrat-trading', 'dev', 'all')` (and `production`)
   - `('trading', 'risk.sizing_enabled', 'bool', 'true', 'Master gate for automatic position sizing; false rejects orders submitted without an explicit qty', 'true', 'xstockstrat-trading', 'dev', 'all')` (and `production`)
   - End with `ON CONFLICT (namespace, key, environment, trading_mode) DO NOTHING;` matching `008`'s exact clause.
2. Create `011_trading_risk_sizing.down.sql`:
   `DELETE FROM config.config_values WHERE namespace = 'trading' AND key LIKE 'risk.max_risk_per_trade_pct' OR (namespace = 'trading' AND key IN ('risk.atr_multiplier', 'risk.max_concentration_pct', 'risk.sizing_enabled'));`
   — simpler and safer as four explicit `key IN (...)` values (not a `LIKE` prefix, since
   `risk.max_position_pct` — the pre-existing, untouched key — must never match): use
   `DELETE FROM config.config_values WHERE namespace = 'trading' AND key IN ('risk.max_risk_per_trade_pct', 'risk.atr_multiplier', 'risk.max_concentration_pct', 'risk.sizing_enabled');`

**Verification**:
```bash
ls services/xstockstrat-config/migrations/011_trading_risk_sizing.up.sql services/xstockstrat-config/migrations/011_trading_risk_sizing.down.sql
```
Read both files: confirm every `INSERT` in `.up.sql` (8 rows) is reversible by the single `DELETE ...
key IN (...)` in `.down.sql`, and that `risk.max_position_pct` never appears in either file (the
existing warn-only key must be untouched by this migration).

---

### Step 2 — docs: register the new keys in the Per-Feature Registered Keys log

**Status**: `pending`
**Service**: `docs/patterns/`
**Files**:
- `docs/patterns/config-governance.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Log location and "newest first" convention: `docs/patterns/config-governance.md:35-37` (`## Per-Feature Registered Keys`, "Append-only log... Newest first").
- Existing entry format to mirror: `docs/patterns/config-governance.md:39-49` (feature 097 entry — narrative paragraph + a `| Key | Type | Default | Description |` table).

**TDD**: `N/A (docs)`

**Instructions**:
Insert a new subsection immediately below the `## Per-Feature Registered Keys` heading (above the
existing feature-097 entry, since the log is newest-first):

```markdown
### feature 023 — position-sizing-engine (`xstockstrat-trading`)

`ComputePositionSize` computes order quantity from account equity, ATR(14)-based stop distance,
signal confidence, and a portfolio concentration cap, activated whenever `PlaceOrder` receives
`qty <= 0`. The pre-existing warn-only `trading.risk.max_position_pct` (5%, `checkPortfolioRisk`)
is unchanged and coexists — it covers override-mode (explicit-qty) orders, which never reach the new
enforcing cap below.

| Key | Type | Default | Description |
|---|---|---|---|
| `trading.risk.max_risk_per_trade_pct` | float | `0.02` | Fraction of equity to risk per trade (auto-sized orders only) |
| `trading.risk.atr_multiplier` | float | `1.5` | Stop distance as a multiple of ATR(14) |
| `trading.risk.max_concentration_pct` | float | `0.10` | Max fraction of equity in any single auto-sized position (enforcing) |
| `trading.risk.sizing_enabled` | bool | `true` | Master gate; `false` rejects orders submitted without an explicit `qty` |
```

**Verification**:
```bash
grep -n "feature 023 — position-sizing-engine" docs/patterns/config-governance.md
```
Confirm the new entry appears immediately after the `## Per-Feature Registered Keys` heading (before
the feature-097 entry).

---

### Step 3 — proto: add `optional double confidence = 16` to `PlaceOrderRequest`

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/trading/v1/trading.proto` — modify
- `packages/proto/gen/go/trading/v1/` — modify (regenerated)
- `packages/proto/gen/python/trading/v1/` — modify (regenerated)
- `packages/proto/gen/ts/trading/v1/` — modify (regenerated)

**Reviewers**: Proto Reviewer — field number uniqueness, `buf lint`/`buf breaking` pass; `xstockstrat-trading` owner — field consumed correctly

**Codebase Evidence**:
- Current highest field on `PlaceOrderRequest` is `trail_percent = 15` — `packages/proto/trading/v1/trading.proto:102`.
- `optional` (explicit presence), not a bare scalar, per the repo's own zero-vs-unset precedent:
  `docs/roadmap/ledger/insights.md` 2026-07-24 (`cooldown_days`) — "a proto3 scalar where the zero
  value is a meaningful distinct choice from 'unset' ... MUST be declared `optional`". Here
  `confidence = 0.0` is a real, distinct FR-2 input (sizes to zero shares), so it must be
  distinguishable from "caller never set this" (→ default 1.0).
- design.md § Chosen Approach, "Proto addition (Step 0b)" — authoritative for the exact field
  declaration and comment text.

**TDD**: `N/A (proto — additive field, no runtime behavior in this repo until Step 6 reads it)`

**Instructions**:
1. In `packages/proto/trading/v1/trading.proto`, inside `message PlaceOrderRequest` (after
   `double trail_percent = 15;`), add:
   ```protobuf
   // Signal confidence 0.0-1.0 for automatic position sizing (see ComputePositionSize). Unset →
   // confidence=1.0 (full size); explicit 0.0 → size to zero; out-of-range → InvalidArgument.
   optional double confidence = 16;
   ```
2. From repo root: `./scripts/buf-gen.sh`.
3. `git add` the modified `.proto` file and every regenerated file under `packages/proto/gen/go/trading/v1/`, `packages/proto/gen/python/trading/v1/`, `packages/proto/gen/ts/trading/v1/`.

**Verification**:
```bash
cd packages/proto && buf lint .
buf breaking . --against "../../.git#branch=feature/position-sizing-engine,subdir=packages/proto"
cd ../..
./scripts/buf-gen.sh
git diff --stat packages/proto/gen/     # confirm empty — stubs fully regenerated, no drift left
```

---

### Step 4 — service: wire a new `xstockstrat-trading → xstockstrat-marketdata` gRPC client

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/config/config.go` — modify
- `services/xstockstrat-trading/internal/service/trading.go` — modify
- `docker-compose.yml` — modify (confirmed absent from the trading block via `grep -n "xstockstrat-trading" docker-compose.yml`)
- `.do/app.dev.yaml` — modify (confirmed absent)
- `.do/app.yaml` — modify (confirmed absent)

**Reviewers**: `xstockstrat-trading` owner — new outbound dependency correctness; Platform Lead — new inter-service edge, cross-service architecture

**Codebase Evidence**:
- `Config` struct has no `MarketDataEndpoint` field today — `services/xstockstrat-trading/internal/config/config.go:19-28` (`IndicatorsEndpoint` exists and is unused by any client — recon's OQ-1 finding — but no `MarketDataEndpoint` field exists at all).
- Existing dial pattern to reuse verbatim (portfolio client): `services/xstockstrat-trading/internal/service/trading.go:111-113,123` — `grpc.NewClient(cfg.PortfolioEndpoint, grpc.WithTransportCredentials(insecure.NewCredentials()), clientKeepAlive, grpc.WithChainUnaryInterceptor(middleware.UnaryClientInterceptor))`, then `portfoliov1.NewPortfolioServiceClient(portfolioConn)`.
- `clientKeepAlive` shared var: `trading.go:90-94`. Reusing it for the new dial keeps the idle-drop
  behavior consistent with the other three outbound clients.
- `middleware.UnaryClientInterceptor` is the service's existing header-propagation mechanism (Go
  interceptor per `docs/patterns/header-propagation.md`): `services/xstockstrat-trading/internal/middleware/*.go:39-49` — forwards `x-user-id`/`x-access-scope`/`x-trace-id` from `FromContext(ctx)` on every outbound call made on a connection dialed with this interceptor. The new marketdata client automatically propagates headers by reusing it — no new propagation code needed.
- `TradingService` struct field to add, alongside `portfolio portfoliov1.PortfolioServiceClient` at `trading.go:69`.
- `docker-compose.yml` trading block confirmed missing `MARKETDATA_ENDPOINT` (env, `docker-compose.yml:419-429`) and missing `xstockstrat-marketdata` in `depends_on` (`docker-compose.yml:432-444`, which has `xstockstrat-portfolio: condition: service_started` at `443-444` as the direct precedent to mirror — recon's Open Risk item).
- `.do/app.yaml` trading block confirmed missing `MARKETDATA_ENDPOINT` (`.do/app.yaml:41-78`); sibling
  key format to copy: `- key: PORTFOLIO_ENDPOINT` / `value: ${xstockstrat-portfolio.PRIVATE_DOMAIN}:50052` (`.do/app.yaml:60-61`).
- `.do/app.dev.yaml` — same structure confirmed, same missing key (`.do/app.dev.yaml:41-63`).
- Trading service's own `CLAUDE.md` Environment Variables block does **not** list `MARKETDATA_ENDPOINT` today (covered by Step 10).

**TDD**: `red-green required`

**Instructions**:
1. `internal/config/config.go`: add `MarketDataEndpoint string` to the `Config` struct (after
   `IndicatorsEndpoint`), and in `LoadFromEnv()` add:
   `MarketDataEndpoint: getEnv("MARKETDATA_ENDPOINT", "xstockstrat-marketdata:50053"),`
2. `internal/service/trading.go`:
   - Add import `marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"`.
   - Add field `marketdata marketdatav1.MarketDataServiceClient` to `TradingService` (near `portfolio`, `trading.go:69`), with a comment: "marketdata is used by ComputePositionSize for ATR bars and current price."
   - In `NewTradingService`, dial it the same way as `portfolioConn` (reuse `clientKeepAlive` +
     `middleware.UnaryClientInterceptor`), and set `marketdata: marketdatav1.NewMarketDataServiceClient(marketdataConn)` in the returned struct literal.
3. `docker-compose.yml`: in the `xstockstrat-trading` service's `environment:` block, add
   `MARKETDATA_ENDPOINT: xstockstrat-marketdata:50053` (after `INDICATORS_ENDPOINT`); in its
   `depends_on:` block, add:
   ```yaml
         xstockstrat-marketdata:
           condition: service_started
   ```
4. `.do/app.yaml` and `.do/app.dev.yaml`: in the `xstockstrat-trading` service's `envs:` block, add:
   ```yaml
         - key: MARKETDATA_ENDPOINT
           value: ${xstockstrat-marketdata.PRIVATE_DOMAIN}:50053
   ```

**Verification**:
```bash
grep -n "MARKETDATA_ENDPOINT" docker-compose.yml .do/app.dev.yaml .do/app.yaml
# confirm one new hit per file, inside the xstockstrat-trading service block
cd services/xstockstrat-trading && GOWORK=off go build ./...
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 5 — test: construction canary for the new marketdata client

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_sizing_test.go` — create

**Reviewers**: `xstockstrat-trading` owner

**Codebase Evidence**:
- Precedent for testing a constructor that dials outbound gRPC clients without a live server: `services/xstockstrat-marketdata/cmd/server/main_test.go:33-46` (`TestNewFundamentalsSource_AlwaysNonNil`) — its own comment explains why a zero-value `*config.Watcher` and a lazy `grpc.NewClient` dial are safe in a unit test ("A zero-value `*config.Watcher` is safe here: `GetString` touches only `w.mu`... and `w.snapshot` (nil-map read returns `ok=false`)").
- `NewTradingService`'s signature and the fact that it never dereferences `repo`/`accountRepo` before
  storing them: `services/xstockstrat-trading/internal/service/trading.go:96-130` — `grpc.NewClient`
  is non-blocking (lazy dial), so no live `xstockstrat-marketdata`/etc. process is required.
- Coverage-exclusion note: this package (`internal/service`) is excluded from the Go coverage
  threshold's `COVERPKGS` computation (`grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)'` in
  `reference/spec-template.md`'s verification command) — this test still satisfies **C-08**'s pairing
  requirement, but no coverage percentage gates it.

**TDD**: `red-green required` — before Step 4's marketdata field/dial exists, this test fails to
compile (`svc.marketdata` unknown field); after Step 4, it passes.

**Instructions**:
Create `internal/service/trading_sizing_test.go` (package `service`) with:
```go
package service

import (
	"testing"

	"github.com/xstockstrat/trading/internal/config"
)

// TestNewTradingService_MarketDataClientNonNil is a construction canary (feature 023): the new
// marketdata client field must always be non-nil after NewTradingService returns, matching the
// grpc.NewClient lazy-dial precedent in services/xstockstrat-marketdata/cmd/server/main_test.go.
func TestNewTradingService_MarketDataClientNonNil(t *testing.T) {
	cfg := &config.Config{
		LedgerEndpoint:    "localhost:0",
		NotifyEndpoint:    "localhost:0",
		PortfolioEndpoint: "localhost:0",
		MarketDataEndpoint: "localhost:0",
	}
	svc, err := NewTradingService(cfg, &config.Watcher{}, nil, nil, "")
	if err != nil {
		t.Fatalf("NewTradingService returned error: %v", err)
	}
	if svc.marketdata == nil {
		t.Fatal("svc.marketdata is nil; NewTradingService must always construct a marketdata client")
	}
}
```

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/service/... -race -run TestNewTradingService_MarketDataClientNonNil -v
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 6 — service: implement `ComputePositionSize`

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order sizing correctness, fail-closed behavior;
`xstockstrat-portfolio` owner — equity source semantics

**Codebase Evidence**:
- `resolveAccount` (`trading.go:188-209`) resolves a `brokerPoolEntry` but its single-broker
  convenience branch (`len(s.brokers) == 1`, `trading.go:200-204`) never returns *which* account ID it
  picked — `brokerPoolEntry` (`trading.go:34-40`) has no account-id field. `ComputePositionSize`'s
  equity lookup (`ListPortfolios(AccountId: ...)`) needs a concrete account ID even when the caller
  left `PlaceOrderRequest.account_id` empty, so `resolveAccount`'s signature must widen to also return
  the resolved ID: `func (s *TradingService) resolveAccount(accountID string) (string, brokerPoolEntry, error)` — explicit-ID branch returns it unchanged; the single-broker branch captures the map key
  (`for id, entry := range s.brokers { return id, entry, nil }`) instead of discarding it. Both
  existing call sites need updating: `trading.go:262` (`PlaceOrder`, used by Step 8) and `trading.go:465`
  (`ReplaceOrder`, which can discard the new first return value via `_`).
- Equity source: `resolveAccountEquity` must call `ListPortfolios`, **not** `GetPortfolio` —
  `services/xstockstrat-portfolio/internal/service/portfolio_service.go:989-1003` (the `accountID != ""`
  branch: one `GetAccountBalance` + `buildAccountPortfolio` call, returning `ListPortfoliosResponse{Portfolios: [...]}` with exactly one entry) vs. `GetPortfolio`
  (`portfolio_service.go:440-459`, position-value-summed, `$0` for a flat funded account — AC-1's exact
  scenario, per design.md). `ListPortfoliosRequest.account_id` is `optional string` (`packages/proto/portfolio/v1/portfolio.proto:160`) → generated Go field is `*string`.
- Reuse the exact `context.WithTimeout(ctx, 2*time.Second)` budget pattern already used by
  `checkPortfolioRisk`: `trading.go:1297`.
- ATR source: `marketdata.GetBars` — proto RPC `packages/proto/marketdata/v1/marketdata.proto:20`,
  request/response shape `marketdata.proto:83-95`. Bars are returned chronological ascending (oldest
  first) — confirmed via `ORDER BY time ASC` in `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go:90`. **Reliably yielding ≥15 recent daily bars requires an explicit, tight
  `Range`** — `GetBars`' `ORDER BY time ASC LIMIT pageSize+1` starting at `Range.Start` (confirmed via
  `marketdata_repo.go:74-93`) returns the **oldest** N bars *after* `Range.Start`, not the most recent
  N. An unbounded/default-window request (page size only, no explicit range) sizes its lookback via
  `defaultBarLookback` (`marketdata_service.go:213-227`, `pageSize × interval × 3` slack) and would
  therefore return the oldest bars in that (potentially much wider) window — stale data, not the most
  recent bars. This resolves design.md's Open Risk item ("`GetBars`'s exact `TimeRange`/pagination
  semantics... confirm at `/sdd-spec`"): request `Range: {Start: now-45 days, End: now}` (45 calendar
  days comfortably covers the ≥15 trading days needed even with holidays/an ingestion lag) with
  `Page: {PageSize: 40}` (well above the ≤~32 trading days expected in that window, so the response is
  never truncated and includes every bar up to `now`); take the **last** 15 of the returned
  (ascending) slice for the Wilder ATR(14) computation.
- Both `GetBars` and `GetLatestQuote` have real error sub-paths, not just empty-but-valid responses —
  verified in design.md (`GetLatestQuote`'s live-fetch path returns a real Go error,
  `marketdata_service.go:367-370`; `GetBars`' DB-query path returns a real error,
  `marketdata_service.go:155-158`). Check `err != nil` first, then check response shape
  (`len(bars) < 15`; zero quote) as a separate fail-closed condition. Both calls share **one** 2-second
  timeout budget (design.md).
- `Quote` has no single current-price field, only `ask_price`(3)/`bid_price`(5) —
  `packages/proto/marketdata/v1/marketdata.proto:60-68`. Current price: `(ask+bid)/2` when both > 0;
  whichever is nonzero when only one is; fail-closed when both are zero (design.md).
- `OrderSide` enum (not addressed by design.md's pseudocode — resolved here from the proto):
  `ORDER_SIDE_BUY = 1` / `ORDER_SIDE_SELL = 2` (`packages/proto/trading/v1/trading.proto:55-58`). The
  computed stop price must be direction-aware: BUY (long) stops **below** current price
  (`currentPrice - stopDistance`); SELL (short) stops **above** (`currentPrice + stopDistance`).
- Formula (FR-2/FR-3, `product-spec.md:18-19`, verified against AC-1/AC-2's worked arithmetic in
  `product-spec.md:108-109`): `dollarRiskBudget = equity * maxRiskPct * confidence`;
  `stopDistance = atrMultiplier * atr`; `rawQty = floor(dollarRiskBudget / stopDistance)`;
  concentration cap: if `rawQty * currentPrice > equity * maxConcentrationPct`, reduce to
  `floor(equity * maxConcentrationPct / currentPrice)`. Returned `dollarRisk` is the risk of the
  **final** (possibly capped) quantity: `finalQty * stopDistance` — this is what FR-7 logs, not the
  pre-cap budget.
- Config reads reuse the exact `s.cfgW.Get<Type>("<ns>.<cat>.<key>", <default>)` idiom already used by
  `checkPortfolioRisk` (`trading.go:1292,1334`) — live per-call reads, no caching (FR-4, no restart
  required). Keys and defaults from Step 1: `trading.risk.max_risk_per_trade_pct` (0.02),
  `trading.risk.atr_multiplier` (1.5), `trading.risk.max_concentration_pct` (0.10).
- Fail-closed stance (not `checkPortfolioRisk`'s fail-open — explicit design.md decision, § Rejected
  Alternatives): any error/insufficient-data path returns a non-nil error and computes no quantity.

**TDD**: `red-green required`

**Instructions**:
1. Widen `resolveAccount`'s signature as described in Codebase Evidence; update both call sites.
2. Add `resolveAccountEquity(ctx context.Context, accountID string) (float64, error)`: 2s timeout,
   calls `s.portfolio.ListPortfolios(ctx, &portfoliov1.ListPortfoliosRequest{AccountId: &accountID})`,
   returns `resp.Portfolios[0].Equity` (error if the call errors or the response has zero portfolios).
3. Add a package-level pure helper `wilderATR(bars []*marketdatav1.Bar, period int) (float64, error)`
   implementing Wilder's true-range ATR: `TR_i = max(high_i - low_i, |high_i - close_{i-1}|,
   |low_i - close_{i-1}|)`; first ATR = simple mean of the first `period` TRs; subsequent
   `ATR_i = ((prevATR * (period-1)) + TR_i) / period`. Requires `len(bars) >= period+1`; error
   otherwise. Add `"math"` to the import block.
4. Add
   `func (s *TradingService) ComputePositionSize(ctx context.Context, req *tradingv1.PlaceOrderRequest, equity, confidence float64) (qty float64, dollarRisk, stopPrice float64, err error)`
   implementing: one shared 2s-timeout context for both marketdata calls; `GetBars` with the tight
   `Range`/`Page` from Codebase Evidence, `TimeframeEnum: commonv1.Timeframe_TIMEFRAME_1DAY`;
   `err != nil` check, then `len(bars) < 15` check (fail-closed `codes.FailedPrecondition`); `wilderATR`
   on the last 15 bars; `GetLatestQuote`; `err != nil` check, then the ask/bid current-price resolution
   (fail-closed `codes.FailedPrecondition` if both zero); config reads; the formula from Codebase
   Evidence; direction-aware stop price; `slog.Info` logging every input/output per FR-7 (symbol,
   sizedQty, stopPrice, dollarRisk, equity, confidence, the three config values).

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go build ./...
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 7 — test: `ComputePositionSize` unit tests

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_sizing_test.go` — modify (created in Step 5)

**Reviewers**: `xstockstrat-trading` owner

**Codebase Evidence**:
- No test in this service has ever mocked a gRPC client dependency (design.md's Open Risk item, now
  resolved here): `portfolio portfoliov1.PortfolioServiceClient` and the new
  `marketdata marketdatav1.MarketDataServiceClient` fields are both **exported interface types**
  settable on a `&TradingService{...}` struct literal from within the same `service` package — the
  same technique `trading_helpers_test.go:110` already uses to construct a bare `&TradingService{}` for
  `TestBuildBrokerRequest_TrailFields`. No `internal/testdata/` fixture home exists yet in this Go
  service (one test file does not create one — Constitution **C-13**'s "materializes lazily" rule).
- AC worked arithmetic to assert against: `product-spec.md:108-109` — AC-1 (equity=10000,
  max_risk_pct=0.02, atr_multiplier=1.5, ATR=2.00, confidence=1.0 → 66 shares); AC-2 (66 shares @ $200 →
  $13,200, 132% of equity → capped to `floor(10000*0.10/200)=5` shares). Product spec Acceptance
  Criterion 7 additionally requires a confidence=0.5 scaling case (`product-spec.md:114`) — same
  inputs as AC-1 with `confidence=0.5` → `floor((10000*0.02*0.5)/3.0) = floor(100/3.0) = 33` (exactly
  half of AC-1's 66, floor-consistent with FR-2's linear identity formula).
- `&config.Watcher{}` zero-value safety for `GetFloat` (returns the call site's hardcoded default when
  the snapshot is nil) — same technique and citation as Step 5.

**TDD**: `red-green required` — write these tests against the Step 6 signature before Step 6's body is
complete (or immediately after, asserting the real formula); `/sdd-execute`'s TDD gate captures a
failing run before the implementation and a passing run after.

**Instructions**:
In `trading_sizing_test.go`, add fake implementations of the two client interfaces (minimal — only the
methods this feature calls need real behavior; anything else can `panic("not implemented")`):
```go
type fakePortfolioClient struct {
	portfoliov1.PortfolioServiceClient
	equity float64
}
func (f *fakePortfolioClient) ListPortfolios(ctx context.Context, req *portfoliov1.ListPortfoliosRequest, _ ...grpc.CallOption) (*portfoliov1.ListPortfoliosResponse, error) {
	return &portfoliov1.ListPortfoliosResponse{Portfolios: []*portfoliov1.Portfolio{{Equity: f.equity}}}, nil
}

type fakeMarketDataClient struct {
	marketdatav1.MarketDataServiceClient
	bars  []*marketdatav1.Bar
	quote *marketdatav1.Quote
}
func (f *fakeMarketDataClient) GetBars(ctx context.Context, req *marketdatav1.GetBarsRequest, _ ...grpc.CallOption) (*marketdatav1.GetBarsResponse, error) {
	return &marketdatav1.GetBarsResponse{Bars: f.bars}, nil
}
func (f *fakeMarketDataClient) GetLatestQuote(ctx context.Context, req *marketdatav1.GetLatestQuoteRequest, _ ...grpc.CallOption) (*marketdatav1.Quote, error) {
	return f.quote, nil
}
```
Embedding the real client interface (`portfoliov1.PortfolioServiceClient`) lets the fake satisfy the
full interface while overriding only the methods used. Build a `bars` fixture of 15+ synthetic daily
`Bar`s whose high/low/close values are hand-computed to yield `ATR(14) = 2.00` exactly (or assert via
`wilderATR` directly and feed the result into `ComputePositionSize` — either is acceptable; direct
`wilderATR` unit tests are simpler to reason about and should exist in addition).

Test cases (`&TradingService{cfgW: &config.Watcher{}, portfolio: &fakePortfolioClient{...}, marketdata:
&fakeMarketDataClient{...}}`):
1. `TestComputePositionSize_NormalCase` — AC-1's exact inputs → 66 shares.
2. `TestComputePositionSize_ConcentrationCapTriggered` — AC-2's exact inputs (quote ask/bid averaging
   to $200) → 5 shares.
3. `TestComputePositionSize_ConfidenceHalfScaling` — AC-1's inputs with `confidence=0.5` → 33 shares.
4. `TestComputePositionSize_InsufficientBars` — fewer than 15 bars → error, `codes.FailedPrecondition`.
5. `TestComputePositionSize_ZeroEquity` — `equity=0` → error (fail-closed, not a zero-quantity result).
6. `TestComputePositionSize_ZeroQuote` — both `ask_price`/`bid_price` zero → error.
7. `TestWilderATR_KnownSeries` — direct unit test of the pure helper against a hand-computed series.
8. `TestWilderATR_InsufficientBars` — `len(bars) < period+1` → error.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/service/... -race -run 'TestComputePositionSize|TestWilderATR' -v
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
```
New logic is in `internal/service`, a package excluded from the CI Go coverage `COVERPKGS` computation
(see Step 5's Codebase Evidence) — no coverage percentage gates this step; the above functional test run
is the required proof.

---

### Step 8 — service: wire `ComputePositionSize` into `PlaceOrder`

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/handler/trading.go` — modify
- `services/xstockstrat-trading/internal/service/trading.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, paper-only dev invariant,
position limit enforcement

**Codebase Evidence**:
- The served gRPC path rejects `qty <= 0` **before** `TradingService.PlaceOrder` ever runs — the
  headline blocker recon flagged: `services/xstockstrat-trading/internal/handler/trading.go:35-37`
  (`if req.Msg.Qty <= 0 { return nil, connect.NewError(connect.CodeInvalidArgument, ...) }`). Both the
  Connect-served path and the gRPC-served path inherit the fix, since `grpcTradingAdapter.PlaceOrder`
  (`internal/handler/trading.go:119-125`) calls the same `h.PlaceOrder` method.
- Full authoritative statement order: design.md § Chosen Approach, "Full `PlaceOrder` statement order"
  (steps 0 through 11). This step implements that order against the real current code:
  - Step 0 target: `internal/handler/trading.go:35-37` (delete).
  - Steps 1-3 unchanged: maintenance-mode check (`trading.go:244-246`), trailing-stop validation
    (`trading.go:251-259`), `resolveAccount` (`trading.go:262` — now returns 3 values per Step 6).
  - Step 4: `mode := s.resolveTradingMode(req.TradingMode)` moves up from its current position
    (`trading.go:271`) to immediately after `resolveAccount`.
  - Step 5: `sizingEnabled := s.cfgW.GetBool("trading.risk.sizing_enabled", true)`;
    `needSizing := req.Qty <= 0`; if `needSizing && !sizingEnabled`, return
    `grpcstatus.Errorf(codes.FailedPrecondition, "position sizing is disabled; an explicit qty is required")` (AC-4).
  - Step 6: `needRiskCheck := req.UserId != "" && s.cfgW.GetFloat("trading.risk.max_position_pct", 0.05) > 0` (mirrors the existing guard inside `checkPortfolioRisk`, `trading.go:1289,1292-1295`, now hoisted to the call site); if `needSizing || needRiskCheck`, call the new `resolveAccountEquity(ctx, resolvedAccountID)` once (the account ID returned by Step 6's widened `resolveAccount`).
  - Step 7: if `needSizing`: fail-closed on `equityErr != nil || equity <= 0`; resolve
    `confidence := 1.0; if req.Confidence != nil { confidence = *req.Confidence }`; validate
    `confidence` is in `[0.0, 1.0]` (else `codes.InvalidArgument`, FR-2's domain); call
    `s.ComputePositionSize(ctx, req, equity, confidence)`; on error, return it (order never created);
    **mutate `req.Qty = sizedQty` in place** — load-bearing for step 11's `buildBrokerRequest(req)`
    (`trading.go:337`) and the unchanged order-construction/approval-check code that reads `req.Qty`
    after this point; log via `slog.Info` per FR-7 (already inside `ComputePositionSize` per Step 6).
  - Step 8: if `needRiskCheck`, call `checkPortfolioRisk(ctx, req, mode, equity, equityErr)` — new
    signature (see below) — **after** step 7, so it evaluates the real (possibly sized) `req.Qty`,
    fixing the pre-existing bug where it structurally could never fire for what will become auto-sized
    orders.
  - Steps 9-10 unchanged in position, but now structurally meaningful for auto-sized orders since
    `req.Qty` holds the real quantity: approval threshold check (`trading.go:274-277`), order
    construction (`trading.go:285-304`). At order construction, if `needSizing` and
    `req.OrderType` is `ORDER_TYPE_MARKET` or `ORDER_TYPE_LIMIT`, set `order.StopPrice` to the
    `stopPrice` returned by `ComputePositionSize` (informational only); for every other order type
    (`STOP`/`STOP_LIMIT`/`TRAILING_STOP`) or override-mode orders, leave `order.StopPrice = req.StopPrice` unchanged (the real broker-trigger price) — matches the product spec's Out-of-Scope note
    (`product-spec.md:36-39`) that this feature never submits its computed stop as a real broker
    `STOP`/`STOP_LIMIT` order.
  - Step 11 unchanged: `buildBrokerRequest(req)` (`trading.go:337`) is automatically correct since
    `req.Qty` was mutated in place at step 7; `req.StopPrice` (read by `buildBrokerRequest`,
    `trading.go:1367`) is never touched by the sizing path, so a real STOP/STOP_LIMIT/TRAILING_STOP
    order's broker-trigger price is unaffected.
- `checkPortfolioRisk`'s new signature:
  `func (s *TradingService) checkPortfolioRisk(ctx context.Context, req *tradingv1.PlaceOrderRequest, mode commonv1.TradingMode, equity float64, equityErr error)` — replaces its current self-contained
  `GetPortfolio` call (`trading.go:1300-1307`) with the passed-in `equity`/`equityErr` (log+return early
  on `equityErr != nil`, matching the existing warn-and-skip behavior at `trading.go:1304-1307`); the
  rest of the function body (`orderNotional`/`pct`/`slog.Warn`, `trading.go:1309-1325`) is unchanged
  except adding `"trading_mode", mode.String()` to the warn log for parity with other `PlaceOrder` log
  lines. Remains warn-only/non-blocking (unchanged from `trading.go:1304-1326`) — design.md explicitly
  keeps this fail-open (only `ComputePositionSize` is fail-closed).

**TDD**: `red-green required`

**Instructions**: Apply the statement-order rewrite of `PlaceOrder` (`trading.go:242-385`) exactly as
described in Codebase Evidence above, and delete `internal/handler/trading.go:35-37`.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go build ./...
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -n "req.Qty <= 0" services/xstockstrat-trading/internal/handler/trading.go   # confirm zero hits — the removed gate
```

Trading-domain constraints (`reference/step-constraints.md` §A):
- **Broker coverage**: sizing runs before broker submission and does not vary by `BrokerType` —
  `ALPACA`/`IBKR` both unaffected by this step (product-spec Out-of-Scope, `product-spec.md:40-41`).
- **Trading mode gate**: `mode := s.resolveTradingMode(req.TradingMode)` (reused, just reordered
  earlier) continues to gate paper vs. live routing exactly as before — this step does not change
  paper/live semantics, only when `mode` is computed relative to sizing.
- **Order type coverage**: `MARKET`/`LIMIT` get the informational `StopPrice` set on auto-sized orders;
  `STOP`/`STOP_LIMIT`/`TRAILING_STOP` and override-mode orders of any type are unaffected (see Codebase
  Evidence above) — all 5 `OrderType` values are accounted for.
- **Fill state completeness**: unaffected by this step — no change to `OrderStatus`/fill processing.

---

### Step 9 — test: `PlaceOrder` sizing-gate and confidence-validation tests

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_helpers_test.go` — modify

**Reviewers**: `xstockstrat-trading` owner

**Codebase Evidence**:
- Existing convention for testing a `cfgW`-gated `PlaceOrder` condition without invoking the full
  method (which needs a live broker pool): `TestApprovalThresholdLogic`
  (`trading_helpers_test.go:165-229`) and `TestTrailingStopValidation`
  (`trading_helpers_test.go:132-163`) both replicate the exact boolean expression from `PlaceOrder` as
  a standalone pure function in the test file, asserting it against a table of cases — the same
  pattern this step follows for the `needSizing && !sizingEnabled` gate (AC-4) and the confidence
  `[0.0, 1.0]` domain validation (FR-2).

**TDD**: `red-green required`

**Instructions**: Add to `trading_helpers_test.go`:
1. `TestSizingRequiredGate` — replicates `needSizing := req.Qty <= 0; needSizing && !sizingEnabled → reject` across a table: `{qty: 0, sizingEnabled: true, wantReject: false}`, `{qty: 0, sizingEnabled: false, wantReject: true}` (AC-4), `{qty: 10, sizingEnabled: false, wantReject: false}` (override mode bypasses the gate entirely — FR-6), `{qty: -5, sizingEnabled: false, wantReject: true}` (negative also means "unset" per FR-5).
2. `TestConfidenceResolution` — replicates `confidence := 1.0; if req.Confidence != nil { confidence = *req.Confidence }`: unset (`nil`) → `1.0`; explicit `0.0` → `0.0` (distinct from unset, per Step 3's `optional` rationale); explicit `0.5` → `0.5`.
3. `TestConfidenceDomainValidation` — replicates the `[0.0, 1.0]` range check: `-0.1` → reject,
   `1.1` → reject, `0.0`/`0.5`/`1.0` → accept.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/service/... -race -run 'TestSizingRequiredGate|TestConfidenceResolution|TestConfidenceDomainValidation' -v
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
```
New logic is in `internal/service`, excluded from the CI Go coverage `COVERPKGS` computation (see Step
5) — no coverage percentage gates this step; the functional test run above is the required proof.

---

### Step 10 — docs: update `xstockstrat-trading/CLAUDE.md`

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- "Config Keys Consumed" table: `services/xstockstrat-trading/CLAUDE.md` (existing rows include
  `trading.risk.max_position_pct`, `trading.approval.require_above_qty`, etc.).
- "Environment Variables" block lists `INDICATORS_ENDPOINT` but not `MARKETDATA_ENDPOINT` today (same
  file).
- "Dependencies" table lists `xstockstrat-portfolio` (`gRPC read | Check position/buying power before
  order`) but no `xstockstrat-marketdata` row.

**TDD**: `N/A (docs)`

**Instructions**:
1. Add four rows to "Config Keys Consumed": `trading.risk.max_risk_per_trade_pct` (float, `0.02`,
   "Fraction of equity to risk per trade for auto-sized orders"), `trading.risk.atr_multiplier` (float,
   `1.5`, "Stop distance as a multiple of ATR(14)"), `trading.risk.max_concentration_pct` (float,
   `0.10`, "Max fraction of equity in any single auto-sized position — enforcing, unlike the warn-only
   `max_position_pct` above"), `trading.risk.sizing_enabled` (bool, `true`, "Master gate for
   `ComputePositionSize`; `false` rejects any order submitted without an explicit `qty`").
2. Add `MARKETDATA_ENDPOINT=xstockstrat-marketdata:50053` to the Environment Variables code block
   (after `NOTIFY_ENDPOINT`).
3. Add a row to the Dependencies table: `xstockstrat-marketdata | gRPC read | ATR bars + current price
   for ComputePositionSize`.
4. Add a short paragraph near the top (mirroring the existing "Paper vs live" / "Order types" style
   paragraphs) documenting `ComputePositionSize`: triggered when `PlaceOrder` receives `qty <= 0`
   (FR-5); fail-closed on missing/insufficient equity, ATR bars, or quote data (unlike the existing
   warn-only `checkPortfolioRisk`); the pre-existing `trading.risk.max_position_pct` stays warn-only and
   covers only override-mode (explicit-qty) orders, since auto-sized orders are covered by the new
   enforcing `max_concentration_pct`.

**Verification**:
```bash
grep -n "max_risk_per_trade_pct\|atr_multiplier\|max_concentration_pct\|sizing_enabled\|MARKETDATA_ENDPOINT" services/xstockstrat-trading/CLAUDE.md
```
Confirm all five strings appear.

---

### Step 11 — service: display computed quantity/stop price on the `/trader` order form

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/trader/OrderForm.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness

**Codebase Evidence**:
- Consumer surface requirement (Constitution **C-14**, product-spec.md's `## Consumer Surface(s)`,
  `product-spec.md:57-64`): "the `/trader` segment's order-placement flow ... must display the computed
  quantity and stop price ... before/at submission" — via the existing, unchanged `Order.qty`/
  `Order.stop_price` response fields (no proto change). design.md § Consumer surface (C-14) confirms
  this pre-existing FR-7 commitment is **unaffected** by the confidence-wiring UI work being dropped
  from this feature's scope ("`/trader`'s display-only obligation was never about confidence input,
  only about showing the result of a sizing decision").
- Extension point: the post-submit success message,
  `services/xstockstrat-ui/src/components/trader/OrderForm.tsx:82-89` — currently
  `` setMessage(`Order placed: ${order.orderId} (${OrderStatus[order.status] ?? 'UNKNOWN'})`) ``, no
  `qty`/`stopPrice` shown anywhere in this component. No toast component exists anywhere in `src/`
  (recon.md) — this is the only extension point.
- Typed response shape: `usePlaceOrder` returns a real `Order` message
  (`services/xstockstrat-ui/src/hooks/usePlaceOrder.ts:1-11`) with camelCase `order.qty` /
  `order.stopPrice` (protobuf-es codegen — matches the existing `order.orderId`/`order.status` usage in
  the same `onSuccess` callback).
- `stopPrice` must be shown conditionally (`> 0`): today's `OrderForm` always sends `qty > 0`
  (`OrderForm.tsx:75`, override mode — FR-6), so `order.stopPrice` reflects whatever the caller sent
  (usually `0` for a plain market/limit buy, since the `Stop price` input only renders for
  `stop`/`stop_limit`/`trailing_stop` types — `OrderForm.tsx:169-179`); showing "stop: 0" on every
  ordinary buy would be noise.

**TDD**: `red-green required`

**Instructions**: In the `onSuccess` handler (`OrderForm.tsx:82-89`), replace the `setMessage` call with:
```tsx
const stopInfo = order.stopPrice > 0 ? `, stop ${order.stopPrice}` : '';
setMessage(
  `Order placed: ${order.orderId} (${OrderStatus[order.status] ?? 'UNKNOWN'}) — qty ${order.qty}${stopInfo}`,
);
```

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
```

---

### Step 12 — test: e2e coverage for the new order-form display text

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify
- `services/xstockstrat-ui/e2e/trader/order-form.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` owner

**Codebase Evidence**:
- Mock `placeOrder` handler currently returns only `{ orderId: 'mock-order-001', status: 3, tradingMode: 1 }` (`services/xstockstrat-ui/e2e/mock-backend.ts:137-139`) — no `qty`/`stopPrice`, so today's response can't exercise Step 11's new text. This is a scenario-specific RPC-response literal, not a
  reused domain fixture (`ORDER_FILLED` in `e2e/fixtures/orders.ts` backs `listOrders`/`getOrder`, a
  different mock — per **C-12**, a scenario one-off for this specific RPC mock stays inline).
- Existing assertion this must not break: `order-form.spec.ts:71`,
  `` await expect(page.getByText(/Order placed:.*FILLED/)).toBeVisible(); `` — the regex's `.*` is
  unanchored, so appending `— qty N, stop N` after `(FILLED)` still matches.
- Test submits `qty=5` via the form (`order-form.spec.ts:61`) — the mock ignores the request payload
  and returns a canned response (confirmed: `async placeOrder() { return {...} }` takes no `req`
  param), so the mock's returned `qty`/`stopPrice` are independent literals, not required to echo the
  submitted `5`.

**TDD**: `red-green required` — this test fails against the pre-Step-11 component (no qty/stop text
rendered) and the pre-this-step mock (no qty/stopPrice in the response).

**Instructions**:
1. In `e2e/mock-backend.ts`'s `placeOrder` handler (`:137-139`), change the return value to
   `{ orderId: 'mock-order-001', status: 3, tradingMode: 1, qty: 5, stopPrice: 148.25 }` (a plausible
   auto-sized order with a non-zero informational stop, so the conditional `stopInfo` branch is
   exercised).
2. In `order-form.spec.ts`'s `'successful order submission shows orderId and status'` test, add:
   `` await expect(page.getByText(/qty 5, stop 148.25/)).toBeVisible(); ``

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e e2e/trader/order-form.spec.ts
cd services/xstockstrat-ui && pnpm run lint
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
