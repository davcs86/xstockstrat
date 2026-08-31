# Implementation Spec: strategy-performance-dashboard

**Status**: `pending`
**Created**: 2026-08-31
**Feature**: `docs/roadmap/features/031-strategy-performance-dashboard/feature.md`
**Total Steps**: 11
**Feature Branch**: `feature/strategy-performance-dashboard`

---

## Execution Summary

Two code-bearing services (design.md § Chosen Approach): (1) an **additive `xstockstrat-portfolio`
producer emit** — two already-tracked payload keys (`cost_basis`, `opened_at`) added to the existing
`portfolio.position.closed` ledger event (no proto, no portfolio migration); and (2) the
**`xstockstrat-ui` `/insights` performance dashboard** whose BFF/lib computes every metric from ledger
`portfolio.position.closed` reads + one-shot config, realized-only by construction (C-5).

Order: the portfolio producer lands first (Steps 1–3) so the two new fields exist for the UI averages;
then the config seed migration + key declaration (Steps 4–5); then the `/insights` BFF wiring
(Step 6), the pure metric lib + its RED unit tests (Steps 7–8), the dashboard page + chart (Step 9),
the nav registration (Step 10), and the Playwright e2e that also centralizes the
`portfolio.position.closed`/`queryEvents` mock into an `e2e/fixtures/` module (Step 11).

### Scenario Coverage (Constitution C-15)

| Scenario | Covered by step(s) |
|---|---|
| `@AC-1` equity curve, cumulative realized P&L from configured base date | Step 8 (curve math) + Step 11 (renders) |
| `@AC-2` max drawdown $ and % | Step 8 |
| `@AC-3` rolling 30-day Sharpe using configured risk-free rate | Step 8 |
| `@AC-4` zero-variance → non-finite guard / not-available placeholder | Step 8 |
| `@AC-5` summary stats (total trades, win count, win rate, + averages, total P&L) | Step 8 |
| `@AC-6` 60s auto-refresh without reload | Step 11 |
| `@AC-7` equity-curve zoom/pan, stays on page | Step 11 |
| `@AC-8` date-range picker recomputes every metric | Step 8 (window filter) + Step 11 (picker) |
| `@AC-9` "Paper Trading" label shown when env-derived mode = paper | Step 11 |
| `@AC-10` "Paper Trading" label absent when env-derived mode = live | Step 11 |
| `@AC-11` avg return per trade = mean(realized_pnl / cost_basis) → +5.0% | Step 2 (producer contract) + Step 8 (math) |
| `@AC-12` avg hold time = close − opened → 10 days | Step 2 (producer contract) + Step 8 (math) |
| `@AC-13` legacy event without the extended fields excluded from averages, still counted elsewhere | Step 2 (producer edge) + Step 8 (math) |

**Consumer surface (C-14).** product-spec names exactly one surface — the `/insights` UI segment
(Agent marked "Not a surface"). Steps 9–11 land it (page + nav + e2e). No deferred/unnamed surface.

## Step Dependencies

- Step 2 [test] covers Step 1 [service] (portfolio emit).
- Step 6, 7, 9 require Step 1 landed: the UI averages (Step 7/8) and the e2e fixture (Step 11) read the
  two new payload keys the producer emits in Step 1.
- Step 8 [test] covers Step 7 [service] (metric lib).
- Step 9 (page) requires Step 6 (BFF endpoints) and Step 7 (metric lib) — the page calls
  `queryEvents`/`getConfig`/`getTradingEnvironment` through the BFF and imports the lib.
- Step 10 (nav) requires Step 9 (the `/insights/performance` route must resolve for the reachability
  walk).
- Step 11 (e2e) exercises Steps 6, 9, 10 and depends on Step 1's payload shape in the mock fixture.
- Steps 4–5 (config) are independent of the code path (the lib takes `riskFreeAnnual` as a param); they
  seed the DB defaults and register the keys, and must land in the same PR set (C-05 / config-rollout).

---

### Step 1 — service: add `cost_basis` + `opened_at` to the `portfolio.position.closed` emit

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify

**Reviewers**: `xstockstrat-portfolio` service owner — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- Full-close emit today (the exact map literal to extend):
  `services/xstockstrat-portfolio/internal/service/portfolio_service.go:304-307` →
  `s.emitEvent(ctx, "portfolio.position.closed", "portfolio:"+fill.UserID, map[string]interface{}{ "user_id": …, "symbol": …, "account_id": acctID, "trading_mode": mode.String(), "realized_pnl": sealed })`.
- The closing position is already in hand as `existing` (a `*portfoliov1.Position`), fetched at
  `portfolio_service.go:262` (`existing, _ := s.repo.GetPosition(ctx, …)`); `existing.CostBasis` is
  used at `portfolio_service.go:271`; scanned from the row at
  `services/xstockstrat-portfolio/internal/repository/portfolio_repo.go:269` (`CostBasis: costBasis`)
  and `:270` (`OpenedAt: timestamppb.New(openedAt)`), via `scanPositionRow` (`portfolio_repo.go:246`,
  `row.Scan(… &openedAt …)` at `:257`).
- Redelivered-post-close edge: `existing == nil` guard already present at `portfolio_service.go:298-299`
  (`sealed` stays `0` when `existing == nil`) — the two new keys must be omitted on that branch.
- RFC3339 string precedent for a proto timestamp in a hand-written payload: the `as_of` field,
  `portfolio_service.go:841-844` (`AsOf string json:"as_of"` … "RFC3339"); `structpb.NewValue`
  (`portfolio_service.go:793`, inside `emitEvent` `:790-795`) accepts scalars/strings, not `time.Time`,
  so `opened_at` is emitted as `existing.OpenedAt.AsTime().Format(time.RFC3339)`.
- Additive-Struct precedent (no proto): feature 029 adds `fees` to the fill payload; the five existing
  keys are the feature-042 producer contract (`services/xstockstrat-portfolio/CLAUDE.md` § Ledger Events
  Emitted) and are PRESERVED (C-16).

**TDD**: `red-green required`

**Covers**: `—`

**Instructions**:
1. Extract the closed-position payload into a small **pure** helper next to `processOrderFill` (mirrors
   the feature-042 `realizedDelta` pure-helper-for-test pattern), so it is unit-testable without a DB
   (the concrete `*repository.PortfolioRepo` cannot be faked):
   ```go
   // closedPositionPayload builds the portfolio.position.closed emit payload. The five base keys are
   // the feature-042 producer contract — never dropped/renamed (C-16). cost_basis + opened_at
   // (feature 031) are added only when the closing position row was present (existing != nil): a
   // redelivered post-close fill (existing == nil) omits both, matching the realized_pnl: 0 it already
   // emits there. opened_at is RFC3339 (structpb.NewValue rejects time.Time; the as_of precedent).
   func closedPositionPayload(userID, symbol, acctID, mode string, sealed float64, existing *portfoliov1.Position) map[string]interface{} {
       payload := map[string]interface{}{
           "user_id": userID, "symbol": symbol, "account_id": acctID,
           "trading_mode": mode, "realized_pnl": sealed,
       }
       if existing != nil {
           payload["cost_basis"] = existing.CostBasis
           payload["opened_at"] = existing.OpenedAt.AsTime().Format(time.RFC3339)
       }
       return payload
   }
   ```
2. Replace the inline map literal at `portfolio_service.go:304-307` with:
   ```go
   s.emitEvent(ctx, "portfolio.position.closed", "portfolio:"+fill.UserID,
       closedPositionPayload(fill.UserID, fill.Symbol, acctID, mode.String(), sealed, existing))
   ```
3. Ensure `time` is imported (used by `time.RFC3339`); it is available in the timestamppb-using file —
   confirm the import block. Do not add `closed_at` (the event's producer-stamped `OccurredAt`
   `portfolio_service.go:800` is already the close time and the equity-curve ordering key) and do not
   add `qty`/`avg_entry_price` (neither per-trade stat needs them — minimalism, design.md).
4. No new outbound gRPC call is introduced — the emit still flows through the existing `emitEvent` →
   ledger `AppendEvent` path, so no header-propagation change applies (the ledger append is not a
   per-request self-scoped call).

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go build ./...
grep -n "closedPositionPayload\|cost_basis\|opened_at" internal/service/portfolio_service.go
# confirm the emit calls closedPositionPayload and the two keys are set under existing != nil
```

---

### Step 2 — test: portfolio emit carries `cost_basis` + `opened_at`; redelivered edge omits both

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_close_payload_test.go` — create

**Reviewers**: `xstockstrat-portfolio` service owner — P&L calculation accuracy, position snapshot consistency

**Codebase Evidence**:
- Existing pure-helper unit-test precedent in the same package:
  `services/xstockstrat-portfolio/internal/service/portfolio_helpers_test.go:405`
  (`TestRealizedDelta_Characterization`) — table-driven, no DB, `import "math"`.
- `portfoliov1.Position` carries `CostBasis` and `OpenedAt` (`*timestamppb.Timestamp`) — used at
  `portfolio_service.go:271` and scanned `portfolio_repo.go:269-270`.
- `timestamppb.New` construction precedent: `portfolio_repo.go:270`.

**TDD**: `red-green required`

**Covers**: `AC-11, AC-12, AC-13`

**Instructions**:
1. Add `TestClosedPositionPayload` asserting the Step-1 helper (written RED — it references
   `closedPositionPayload`, which does not yet exist / does not yet set the two keys before Step 1):
   - With `existing := &portfoliov1.Position{CostBasis: 10000, OpenedAt: timestamppb.New(time.Date(2026,2,1,0,0,0,0,time.UTC))}`
     and `sealed = 500`: assert `payload["cost_basis"] == float64(10000)` (JSON number) and
     `payload["opened_at"] == "2026-02-01T00:00:00Z"` (RFC3339). These are exactly the AC-11
     ($500/$10000 → +5.0%) and AC-12 (2026-02-01 → +10 days) inputs the UI math consumes.
   - Assert the five base keys (`user_id, symbol, account_id, trading_mode, realized_pnl`) are all
     present and unchanged (C-16 preserve).
   - With `existing == nil` (the redelivered-post-close edge, AC-13): assert `cost_basis` and
     `opened_at` keys are **absent** while `realized_pnl` is still present — the producer half of "a
     legacy/edge event is excluded from the averages but still counted elsewhere".
2. C-13: the `10000`/`2026-02-01`/`500` literals have exactly one consumer (this test) — inline is
   compliant; no `internal/testdata/` home is created.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/service/ -run TestClosedPositionPayload -race -count=1
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
```
New logic is in the coverage-excluded `internal/service/` package (per the sdd-spec coverage table:
Go `service/` is excluded from CI coverage measurement) — no coverage threshold applies; this unit
test on the pure payload builder is the required paired test (C-08).

---

### Step 3 — docs: document the two additive keys in the portfolio producer contract

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/CLAUDE.md` — modify (§ Ledger Events Emitted, the
  `portfolio.position.closed` producer-contract paragraph)

**Reviewers**: none

**Codebase Evidence**:
- The producer-contract paragraph to extend exists in `services/xstockstrat-portfolio/CLAUDE.md`
  § Ledger Events Emitted: "The full-close emit … carries `{user_id, symbol, account_id, trading_mode,
  realized_pnl}` … the key set is a **contract** — do not drop or rename these keys."

**TDD**: `N/A (docs)`

**Covers**: `—`

**Instructions**:
1. Update the `portfolio.position.closed` paragraph to state that, since feature 031, the payload
   **additively** carries `cost_basis` (JSON number, `existing.CostBasis`, total-signed) and
   `opened_at` (RFC3339 string, `existing.OpenedAt`) **when the closing position row was present**
   (omitted on the redelivered-post-close `existing == nil` edge). Note the five original keys are
   unchanged, so the `xstockstrat-analysis` P&L-pattern consumer is unaffected, and that the
   `xstockstrat-ui` `/insights` performance dashboard reads the two new keys for average return per
   trade and average hold time.
2. This is a Teardown context-file touch — if `/context-scrubber` is available in the session, run it
   scoped to this file before the PR; otherwise note its absence in the PR body.

**Verification**:
```bash
grep -n "cost_basis\|opened_at\|feature 031" services/xstockstrat-portfolio/CLAUDE.md
```

---

### Step 4 — migration: seed the two `ui.performance.*` config keys (`023_ui_performance_keys`)

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/023_ui_performance_keys.up.sql` — create
- `services/xstockstrat-config/migrations/023_ui_performance_keys.down.sql` — create

**Reviewers**: DBA — migration NNN numbering (no gaps/conflicts), up+down pair, run-order compliance; `xstockstrat-config` service owner — config key naming (`<service>.<category>.<key>`), environment (production/staging) scoping

**Codebase Evidence**:
- Last migration on disk in the shared config dir is `021_notify_push_min_severity.up.sql`
  (`ls services/xstockstrat-config/migrations/` → tip `021_*`); `022` is pre-assigned to feature 021
  (`ledger-event-export`) and **`023_ui_performance_keys` is pre-assigned to THIS feature** by
  `docs/roadmap/features/merge-order.md:191` ("**031** `strategy-performance-dashboard` →
  `023_ui_performance_keys`").
- Post-147 seed pattern (columns + conflict target + per-environment global rows) from
  `services/xstockstrat-config/migrations/021_notify_push_min_severity.up.sql`:
  `INSERT INTO config.config_values (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id) VALUES (…) ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;` — global (`user_id NULL`), seeded for `staging` and `production`.
- Float value_type token is the literal `'float'` with a string `value_data`:
  `services/xstockstrat-config/migrations/012_trading_risk_sizing.up.sql:14`
  (`('trading','risk.max_risk_per_trade_pct','float','0.02', …)`) and
  `019_register_analysis_signal_decay_half_life.up.sql:11` (`'float','24.0'`, `staging`/`production`,
  `user_id NULL`).
- Map keying is `values[row.key]` verbatim (`services/xstockstrat-config/src/grpc/configServiceImpl.ts:176`,
  `:206`) — so the stored `key` column must equal the exact string the UI reads
  (`performance.risk_free_rate_annual` / `performance.equity_curve_start_date`, under namespace `ui`),
  resolving design.md Open Risk **R3**.
- `down` DELETE precedent: `021_notify_push_min_severity.down.sql`.

**TDD**: `N/A (migration)`

**Covers**: `—`

**Instructions**:
1. `023_ui_performance_keys.up.sql` — `INSERT … ON CONFLICT … DO NOTHING`, two keys × two environments
   (`staging`, `production`), namespace `ui`, `user_id` NULL, `consuming_service 'xstockstrat-ui'`:
   - `key = 'performance.risk_free_rate_annual'`, `value_type 'float'`, `value_data '0.045'`,
     `default_value '0.045'` — "Annualized risk-free rate for the rolling-30d Sharpe (FR-3). A stored 0
     is legitimate; the UI reads it with an oneof-presence check, never `value || default`."
   - `key = 'performance.equity_curve_start_date'`, `value_type 'string'`, `value_data ''`,
     `default_value ''` — "ISO date the cumulative-P&L curve starts from (FR-1). **Empty = auto**: the
     UI defaults to the earliest closed-position date (design.md)." (An empty string is seeded so the
     key is discoverable/settable in config-ui while keeping the dynamic default; the UI treats
     `stringVal === ''` as absent.)
2. `023_ui_performance_keys.down.sql` — `DELETE FROM config.config_values WHERE namespace = 'ui' AND key IN ('performance.risk_free_rate_annual','performance.equity_curve_start_date');`
3. Do NOT add a portfolio migration — feature 031 needs none (both `cost_basis`/`opened_at` are existing
   `portfolio.positions` columns from `001_portfolio_hypertable.up.sql`); the next-free portfolio NNN
   `014_positions_fees_accum` is claimed by feature 029 (`merge-order.md:197`), not this feature.

**Verification** (offline — never bring up a DB):
```bash
ls services/xstockstrat-config/migrations/023_ui_performance_keys.up.sql services/xstockstrat-config/migrations/023_ui_performance_keys.down.sql
# then read both: every INSERT in .up has a matching DELETE in .down; NNN is 023 (next after 021, 022 reserved to feature 021)
```

---

### Step 5 — config: declare the two keys' defaults (ui CLAUDE.md + config-governance registered-keys log)

**Status**: `pending`
**Service**: `xstockstrat-config` / `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/CLAUDE.md` — modify (add a "Config Keys Consumed" note for the two
  `ui.performance.*` keys with their defaults, C-05)
- `docs/patterns/config-governance.md` — modify (add a row to the **Per-Feature Registered Keys** log)

**Reviewers**: `xstockstrat-config` service owner — config key naming (`<service>.<category>.<key>`), environment scoping

**Codebase Evidence**:
- Config-key registration procedure: `docs/patterns/config-governance.md` § "Registering a new config
  key" (1 seed data, 2 declare in consuming service `CLAUDE.md`, 3 approval, 4 add row to the
  "Per-Feature Registered Keys" log at `config-governance.md:101`).
- C-05 requires defaults declared in the consuming service's `CLAUDE.md`
  (`docs/sdd/constitution.md:36`). `xstockstrat-ui` is the config short-name `ui` and the consumer.

**TDD**: `N/A (config/docs)`

**Covers**: `—`

**Instructions**:
1. In `services/xstockstrat-ui/CLAUDE.md`, declare the two consumed keys and defaults:
   `ui.performance.risk_free_rate_annual` (float, default `0.045`), `ui.performance.equity_curve_start_date`
   (string, default = earliest closed-position date; empty seed = auto). Note they are read one-shot via
   `GetConfig(namespace:'ui')` in `insightsBff.ts` (no `WatchConfig` — the UI is a stateless BFF).
2. Add a Per-Feature Registered Keys row for feature 031 in `docs/patterns/config-governance.md`
   naming both keys, defaults, `consuming_service xstockstrat-ui`, seed migration
   `023_ui_performance_keys`.
3. Teardown: run `/context-scrubber` scoped to these two files if available, else note in the PR body.

**Verification**:
```bash
grep -n "ui.performance.risk_free_rate_annual\|ui.performance.equity_curve_start_date" services/xstockstrat-ui/CLAUDE.md docs/patterns/config-governance.md
```

---

### Step 6 — service: wire the `/insights` BFF reads (ledger `queryEvents`, config `getConfig`, trading `getTradingEnvironment`)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/insightsBff.ts` — modify

**Reviewers**: `xstockstrat-ui` service owner — Connect-RPC call safety, IDOR (self-scoped stream key), environment scope correctness

**Codebase Evidence**:
- `insightsBff.ts` today registers Analysis/Ingest/MarketData/Portfolio/Trading/Indicators; its
  `TradingService` has **only** `listBrokerAccounts` (`services/xstockstrat-ui/src/lib/insightsBff.ts:100-102`),
  and has **no `LedgerService` and no `ConfigService`** — the gaps this feature fills.
- Ledger `queryEvents` with a server-forced stream key (IDOR guard) precedent:
  `services/xstockstrat-ui/src/lib/traderBff.ts:112-126` (rewrites the client stream key from the
  verified session). `getTradingEnvironment` forward precedent: `traderBff.ts:60`. `getConfig` forward
  precedent: `traderBff.ts:143-149` ("GetConfig is deliberately open on the backend, no admin gate").
- Node gRPC clients `ledgerClient` and `configClient` already exist and are exported from
  `services/xstockstrat-ui/src/lib/connectClients.ts` (imported by `traderBff.ts:14-15`).
- Proto shapes: `LedgerService.QueryEvents(QueryEventsRequest{stream_key, event_type, time_range, page})`
  → `QueryEventsResponse{events: LedgerEvent{event_type, payload(Struct), occurred_at, …}}`
  (`packages/proto/ledger/v1/ledger.proto:15,20-31,54-61`); `ConfigService.GetConfig(GetConfigRequest{namespace})`
  → `ConfigSnapshot{values: map<string, ConfigValue{oneof string_val/int_val/float_val/bool_val}>}`
  (`packages/proto/config/v1/config.proto:23,53,60-65`); `TradingService.GetTradingEnvironment` →
  `GetTradingEnvironmentResponse{trading_mode}` (`packages/proto/trading/v1/trading.proto:34,273-275`).
- Canonical BFF plumbing (`requireSession`/`backendHeaders`/`forward`) is imported from
  `bffShared.ts` (`insightsBff.ts:15-22`) — reuse, never re-implement.

**TDD**: `red-green required` (exercised by the Step 11 e2e; xstockstrat-ui has no unit coverage
threshold — e2e coverage applies)

**Covers**: `—`

**Instructions**:
1. Add imports: `LedgerService` from `@xstockstrat/proto/ledger/v1/ledger_pb`, `ConfigService` from
   `@xstockstrat/proto/config/v1/config_pb`, and `ledgerClient` + `configClient` from
   `@/lib/connectClients`.
2. Register `router.service(LedgerService, { queryEvents })` that **forces the portfolio stream key
   server-side** from the verified session (IDOR — the browser must not supply it), mirroring the
   `traderBff.ts:117-126` force pattern:
   ```ts
   queryEvents: async (req, ctx) => {
     const claims = await requireSession(ctx);
     return ledgerClient.queryEvents(
       { ...req, streamKey: `portfolio:${claims.user_id}` },
       { headers: backendHeaders(claims, ctx) },
     );
   },
   ```
   (The client passes only `eventType: 'portfolio.position.closed'` + optional `timeRange`; the stream
   key is overwritten here.)
3. Register `router.service(ConfigService, { getConfig: forward((req, opts) => configClient.getConfig(req, opts)) })`
   (read-only, no admin gate — matches `traderBff.ts:143-149`).
4. Add `getTradingEnvironment: forward((req, opts) => tradingClient.getTradingEnvironment(req, opts))`
   to the existing `insightsBff.ts` `TradingService` registration (mirror `traderBff.ts:60`) so the
   `/insights` segment BFF is self-contained for the FR-8 paper/live read (design.md § Paper/live label).
5. Header propagation: all three handlers go through `backendHeaders(claims, ctx)` / `forward` (the
   existing propagating path — forwards `x-user-id`/`x-access-scope`/`x-trace-id`); no new mechanism.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
grep -n "LedgerService\|ConfigService\|getTradingEnvironment\|portfolio:\${claims.user_id}\|streamKey" src/lib/insightsBff.ts
cd services/xstockstrat-ui && pnpm exec tsc --noEmit
```

---

### Step 7 — service: pure metric lib `performanceMetrics.ts` (equity curve, drawdown, Sharpe, summary, averages, window, config read)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/performanceMetrics.ts` — create

**Reviewers**: `xstockstrat-ui` service owner — analytics display accuracy, no hardcoded config values

**Codebase Evidence**:
- vitest-unit lib home + coverage scope: `services/xstockstrat-ui/vitest.config.ts` scopes coverage to
  `src/lib/**` (`services/xstockstrat-ui/CLAUDE.md` § Testing, feature 065). Existing pure-lib
  precedent: `src/lib/equityCurve.ts` (+ `src/lib/equityCurve.test.ts`), which is "Pure functions over
  the generated types — no JSX (vitest coverage is scoped to src/lib/**)".
- Proto-Timestamp → millis reuse: `src/lib/protoTime.ts` (`timestampToMillis`, `timestampToDate`) —
  the "one shared home" for `LedgerEvent.occurred_at`.
- oneof-presence config read (zero-vs-absent) precedent:
  `src/app/trader/positions/page.tsx:131-133`
  (`resp.values['trading_state']?.value.case === 'stringVal' ? …value : null`); `ConfigValue` oneof
  case names are `floatVal`/`stringVal`/`intVal`/`boolVal` (`config.proto:60-65`, connect-es camelCase).
- Total-signed `cost_basis` invariant (design.md R5; `portfolio/CLAUDE.md` — `cost_basis` positive for
  longs, negative for shorts) → divide by `Math.abs(cost_basis)`.

**TDD**: `red-green required`

**Covers**: `—` (behavioral coverage on the paired test, Step 8)

**Instructions** (all pure, no JSX, Node-safe):
1. Define a normalized `ClosedTrade` type `{ occurredAtMs: number; realizedPnl: number; costBasis?: number; openedAtMs?: number }` and a mapper
   `closedTradesFromEvents(events: LedgerEvent[]): ClosedTrade[]` that reads each event's `payload`
   Struct (`realized_pnl` → `realizedPnl`; optional `cost_basis` → `costBasis`; optional `opened_at`
   RFC3339 → `openedAtMs` via `Date.parse`) and `occurred_at` → `occurredAtMs` via
   `timestampToMillis`. Sort ascending by `occurredAtMs`.
2. `filterByWindow(trades, startMs?, endMs?)` — inclusive date-window filter used by both the base-date
   (FR-1) and the date-range picker (FR-7/AC-8); every metric below runs over the filtered set.
3. `buildEquityCurve(trades): { t: number; value: number }[]` — cumulative running sum of `realizedPnl`
   in `occurredAtMs` order (realized-only by construction, C-5; AC-1). Final value = sum of all
   `realizedPnl`.
4. `maxDrawdown(curve): { dollars: number; pct: number } | null` — largest peak-to-trough decline of
   the cumulative curve: track running peak, `dollars = min(value - peak)` (≤ 0), `pct = dollars /
   peak` when `peak > 0` (AC-2: peak 5000, trough 4380 → −620, −12.4%). Guard empty/monotonic-up → 0.
5. `dailyReturns(curve): number[]` — fractional day-over-day change of the cumulative equity,
   `(e_i − e_{i-1}) / Math.abs(e_{i-1})`, **skipping** any step where `e_{i-1} === 0` (zero-base guard,
   the div-by-zero twin of R5). This resolves design.md **R2**: the Sharpe input is a returns series;
   `rollingSharpe` below takes that series directly.
6. `rollingSharpe(returns: number[], riskFreeAnnual: number): number | null` —
   `(mean(returns) − riskFreeAnnual/252) / popStd(returns) * Math.sqrt(252)`, where `popStd` is the
   **population** standard deviation `sqrt(mean((r−mean)^2))` (pin the convention so AC-3's hand-computed
   reference is deterministic). **Return `null`** when `returns.length < 2`, `popStd === 0`, or the
   result is not `Number.isFinite` (AC-4 non-finite guard, ledger 072). For the "rolling 30-day" view,
   compute over the last-30-calendar-day slice of the window.
7. `avgReturnPct(trades): number | null` — `mean(realizedPnl / Math.abs(costBasis))` over trades whose
   `costBasis` is present **and non-zero** (R5 guard: exclude `costBasis === 0` to avoid `Infinity`;
   exclude missing `costBasis` for AC-13). AC-11: 500 / 10000 = 0.05.
8. `avgHoldTimeDays(trades): number | null` — `mean((occurredAtMs − openedAtMs) / 86_400_000)` over
   trades whose `openedAtMs` is present (exclude missing for AC-13). AC-12: 2026-02-01 → 2026-02-11 = 10.
9. `summaryStats(trades)` — `{ totalTrades: trades.length, winCount: count(realizedPnl > 0), winRate:
   winCount/totalTrades, totalRealizedPnl: sum(realizedPnl), avgReturnPct, avgHoldTimeDays }`. Trades
   without the extended fields still count toward totalTrades/winRate/totalRealizedPnl/curve (AC-5,
   AC-13); only the two averages exclude them.
10. `readRiskFreeRate(values): number` and `readStartDateMs(values, earliestMs): number` — oneof-presence
    reads: `values['performance.risk_free_rate_annual']?.value.case === 'floatVal' ? …value : 0.045`
    (a stored `0` survives — never `value || default`, F-07/guardrail); start date: `case === 'stringVal'
    && value !== '' ? Date.parse(value) : earliestMs` (empty/absent → earliest closed-position date).
11. No hardcoded risk-free rate or start date beyond the documented fallback defaults that mirror the
    seeded config (`0.045`; earliest-date) — the live values come from `GetConfig` (F-07).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm exec tsc --noEmit
grep -n "buildEquityCurve\|maxDrawdown\|rollingSharpe\|avgReturnPct\|avgHoldTimeDays\|summaryStats\|readRiskFreeRate\|Math.abs" src/lib/performanceMetrics.ts
```

---

### Step 8 — test: `performanceMetrics.test.ts` vitest unit (RED) — AC-1..AC-5, AC-8, AC-11..AC-13

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/performanceMetrics.test.ts` — create

**Reviewers**: `xstockstrat-ui` service owner — analytics display accuracy

**Codebase Evidence**:
- vitest unit-test precedent + run/coverage commands: `src/lib/equityCurve.test.ts`,
  `src/lib/protoTime.test.ts`, `src/lib/scoreDisplay.test.ts` (16 `src/lib/*.test.ts` files today);
  `pnpm run test:unit` / `pnpm run test:coverage` (`services/xstockstrat-ui/CLAUDE.md` § Testing —
  coverage scoped to `src/lib/**`, 40% on exercised files).

**TDD**: `red-green required` (written before Step 7 exists → RED)

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5, AC-8, AC-11, AC-12, AC-13`

**Instructions** — one focused case per scenario, asserting the pure functions from Step 7:
1. **AC-1**: 10 closed trades with a configured base date → `buildEquityCurve(filterByWindow(…, startMs))`
   first point dated ≥ base date, final cumulative value = sum of the 10 `realizedPnl` (a monotonic
   line of cumulative realized P&L).
2. **AC-2**: a curve peaking at 5000 then troughing at 4380 → `maxDrawdown` returns `dollars === -620`
   and `pct` within 0.001 of `-0.124` (−12.4%).
3. **AC-3**: a 30-day daily-returns series with non-zero std + `riskFreeAnnual = 0.045` →
   `rollingSharpe` equals the hand-computed `(mean − 0.045/252)/popStd × sqrt(252)` within 0.01.
4. **AC-4**: a returns array where every value is identical (std 0) → `rollingSharpe` returns `null`
   (assert not `"Infinity"`/`"NaN"`; the page renders the placeholder — Step 11 asserts the DOM text).
5. **AC-5**: 10 trades, 6 winners / 4 losers → `summaryStats` gives `totalTrades 10`, `winCount 6`,
   `winRate 0.6`, and defined `avgReturnPct`/`avgHoldTimeDays`/`totalRealizedPnl`.
6. **AC-8**: full set spanning 2026-01-01..2026-08-31, `filterByWindow(2026-06-01..2026-06-30)` →
   `buildEquityCurve`/`maxDrawdown`/`rollingSharpe`/`summaryStats` all recompute over only the June
   subset (assert counts/first-point differ from the full-range results).
7. **AC-11**: one trade `realizedPnl 500`, `costBasis 10000` → `avgReturnPct === 0.05` (+5.0%). Include a
   `costBasis: 0` trade in a sibling case and assert it is excluded (R5 guard, no `Infinity`).
8. **AC-12**: one trade `openedAtMs = Date.parse('2026-02-01')`, `occurredAtMs = Date.parse('2026-02-11')`
   → `avgHoldTimeDays === 10`.
9. **AC-13**: a trade with `realizedPnl` but **no** `costBasis`/`openedAtMs` → excluded from
   `avgReturnPct` and `avgHoldTimeDays`, yet still in `totalTrades`, `winRate`, `totalRealizedPnl`, and
   the equity curve.
10. C-13/C-12: these are `src/lib/**` logic unit tests over plain numeric literals (not proto domain
    fixtures), so no `e2e/fixtures/` import is required; keep the arrays inline (single consumer).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run test:unit -- performanceMetrics
cd services/xstockstrat-ui && pnpm run test:coverage   # src/lib/** ≥ 40% on exercised files
cd services/xstockstrat-ui && pnpm run lint
```

---

### Step 9 — service: dashboard page + chart at `/insights/performance` (chart+Brush, date picker, 60s poll, paper label)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/performance/page.tsx` — create
- `services/xstockstrat-ui/src/components/insights/PerformanceDashboard.tsx` — create (client component)
- `services/xstockstrat-ui/src/lib/browserClients/insightsLedgerClient.ts` — create (`/insights/api`)
- `services/xstockstrat-ui/src/lib/browserClients/insightsConfigClient.ts` — create (`/insights/api`)

**Reviewers**: `xstockstrat-ui` service owner — analytics display accuracy, Connect-RPC call safety, C-17 tokens/primitives, no secret values rendered

**Codebase Evidence**:
- New route home mirrors the sibling insights pages `src/app/insights/{pnl-patterns,backfills}/page.tsx`
  (recon). Existing recharts + `ui/chart.tsx` equity-curve idiom to reuse:
  `src/components/insights/EquityCurveChart.tsx:1-17` (`ComposedChart`/`Line` + `ChartContainer`/
  `ChartTooltipContent`/`ChartConfig` from `@/components/ui/chart`); `ui/chart.tsx` re-exports recharts
  (`services/xstockstrat-ui/src/components/ui/chart.tsx:4`, `import * as RechartsPrimitive from 'recharts'`).
- `recharts` is `^3.10.1` (`services/xstockstrat-ui/package.json:54`) — `Brush` is a first-party
  recharts component (imported directly `import { Brush } from 'recharts'`); no second charting library
  (lightweight-charts is trader-OHLCV-only, `services/xstockstrat-ui/CLAUDE.md` § Styling; design.md
  rejected it).
- Browser-client baseUrl precedent: `insightsPortfolioClient.ts` (`makeBrowserTransport('/insights/api')`)
  and `traderConfigClient.ts` (a per-segment `ConfigService` client) — model the two new insights clients
  on these. `ledgerClient.ts`/`tradingClient.ts` are bound to `/trader/api`, so an `/insights`-segment
  ledger + config client is needed.
- Paper/live label reuse: `src/context/AccountContext.tsx:27-49` (`AccountProvider`, `environmentMode:
  'paper'|'live'` from `getTradingEnvironment`) + `src/components/shared/TradingModeBadge.tsx`
  (`variant paper|live`). `AccountProvider` is mounted per-page on `/insights` already by
  `src/components/insights/SignalOrderTicket.tsx:24-30`, and its browser `tradingClient` posts to
  `/trader/api` same-origin (the documented "Sanctioned exception", `services/xstockstrat-ui/CLAUDE.md`
  § Styling) — so the label resolves without a new insights trading client.
- Canonical state primitives (C-17): `Skeleton` (`src/components/ui/skeleton.tsx`), `EmptyState`
  (`src/components/shared/EmptyState.tsx`), `QueryStateMessages`/`CardNotice` (per `CLAUDE.md`
  § Opportunities-first shell "Non-happy states").
- React-Query `refetchInterval` poll precedent: `src/app/trader/positions/page.tsx:136`
  (`refetchInterval: 30_000`).

**TDD**: `red-green required` (exercised by the Step 11 Playwright e2e — xstockstrat-ui has no unit
threshold; e2e coverage applies)

**Covers**: `—` (behavioral coverage on Step 11)

**Instructions**:
1. Add the two `/insights/api` browser clients (mirror `insightsPortfolioClient.ts`):
   `insightsLedgerClient` (`createClient(LedgerService, makeBrowserTransport('/insights/api'))`) and
   `insightsConfigClient` (`createClient(ConfigService, makeBrowserTransport('/insights/api'))`).
2. `PerformanceDashboard.tsx` (client): three React-Query queries with `refetchInterval: 60_000` (the
   FR-5 default 60s poll, a named client constant `POLL_INTERVAL_MS = 60_000` — resolves design.md R4,
   no config key) — (a) `insightsLedgerClient.queryEvents({ eventType: 'portfolio.position.closed', timeRange })`
   (the BFF forces the stream key), (b) `insightsConfigClient.getConfig({ namespace: 'ui' })`, (c) the
   paper label via `useAccountContext().environmentMode`. Map events → `ClosedTrade[]`
   (`closedTradesFromEvents`), read config (`readRiskFreeRate`/`readStartDateMs`), and compute every
   metric with the Step-7 lib over the picker-selected window.
3. Render: the equity-curve line via `ChartContainer`/`ComposedChart`/`Line` with recharts `<Brush>`
   for zoom/pan (FR-6/AC-7 — Brush keeps the user on the page); a date-range picker that sets the window
   (FR-7/AC-8); drawdown ($ and %), rolling-Sharpe (or the not-available placeholder when `null`,
   AC-4), and summary-stat cards. Drive series color through `ChartConfig` → `--chart-*` tokens (C-17)
   — do **not** clone `EquityCurveChart.tsx`'s hardcoded `hsl(...)` literals. Loading → `Skeleton`,
   empty (no closed trades) → `EmptyState`, per-card error → `CardNotice`/`QueryStateMessages`.
4. Wrap the dashboard in `<AccountProvider>` and render `<TradingModeBadge mode={environmentMode} />`
   (shows "paper" in staging, nothing in production — AC-9/AC-10).
5. `page.tsx` (server) renders `PageBreadcrumb` + `<PerformanceDashboard />` inside the insights React
   Query provider (mirror a sibling `insights/*/page.tsx`).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit
grep -n "Brush\|refetchInterval: 60_000\|POLL_INTERVAL_MS\|TradingModeBadge\|--chart\|ChartContainer" src/components/insights/PerformanceDashboard.tsx
cd services/xstockstrat-ui && pnpm run build   # /insights/performance route compiles
```

---

### Step 10 — service: register `/insights/performance` in the shared nav + extend the reachability walk (C-10(a))

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/shared/navGroups.tsx` — modify
- `services/xstockstrat-ui/e2e/nav-reachability.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` service owner — shared-shell/nav contract, C-10(a) reachability

**Codebase Evidence**:
- The live shell nav model is `NAV_GROUPS` in `src/components/shared/navGroups.tsx:41-98` (Decide/
  Discover/Engine/Book/Settings) — the single source of truth walked by the reachability test;
  `PLATFORM_SUBNAV` is retained-legacy (recon; `CLAUDE.md` § Opportunities-first shell). The **Engine**
  group (`navGroups.tsx:58-69`) already holds Strategies/Formulas/P&L Patterns/Signal sources/Backfills
  — the analytics/engine home for a strategy-performance page.
- The reachability walk `GROUPS` array + assertions: `e2e/nav-reachability.spec.ts:21-92` (Engine block
  at `:30-39`) — asserts each item link resolves (not 404) and carries `aria-current="page"`.

**TDD**: `red-green required` (the extended reachability walk is the paired e2e assertion)

**Covers**: `—` (nav reachability is asserted by this spec; the page's AC scenarios are Step 11)

**Instructions**:
1. Add `{ label: 'Performance', href: '/insights/performance' }` to the Engine group's `items` in
   `NAV_GROUPS` (`navGroups.tsx`).
2. Add the same `{ label: 'Performance', href: '/insights/performance' }` to the Engine `items` in
   `e2e/nav-reachability.spec.ts` `GROUPS` (`:30-39`) so the walk clicks to it and asserts
   `aria-current="page"` — written RED (fails until Step 9's route resolves).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm exec playwright test e2e/nav-reachability.spec.ts
grep -n "Performance\|/insights/performance" src/components/shared/navGroups.tsx e2e/nav-reachability.spec.ts
```

---

### Step 11 — test: Playwright e2e for the dashboard (poll, zoom, date picker, paper label) + centralize the closed-position fixture

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/performance.spec.ts` — create
- `services/xstockstrat-ui/e2e/fixtures/ledgerEvents.ts` — create (centralized
  `portfolio.position.closed` events)
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (`queryEvents` returns the fixture; add
  `getConfig(namespace:'ui')` + `getTradingEnvironment` handlers for the insights segment)
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify (add the fixture row)

**Reviewers**: `xstockstrat-ui` service owner — analytics display accuracy, test-data inventory (C-12)

**Codebase Evidence**:
- Mock backend + segment e2e layout: `e2e/mock-backend.ts`, `e2e/global-setup.ts`,
  `e2e/insights/*.spec.ts` (`services/xstockstrat-ui/CLAUDE.md` § Testing).
- The `portfolio.position.closed`/`queryEvents` mock is **inline in `e2e/mock-backend.ts`** and listed
  "Not yet centralized → Ledger events → `e2e/mock-backend.ts (queryEvents)`"
  (`services/xstockstrat-ui/e2e/fixtures/INVENTORY.md:63`). This feature is the **second consumer** →
  C-12 forces centralization into an `e2e/fixtures/` module + an `INVENTORY.md` catalog row.
- Canonical auth helpers (never re-mint JWTs): `addAuthCookie`/`addAdminCookie` from
  `e2e/helpers/auth.ts` (used by `e2e/nav-reachability.spec.ts:2`).
- Paper/live e2e precedent: the trading-environment mock drives `AccountContext.environmentMode`
  (`AccountContext.tsx:46-49`).

**TDD**: `red-green required`

**Covers**: `AC-1, AC-6, AC-7, AC-8, AC-9, AC-10`

**Instructions**:
1. Centralize the closed-position events into `e2e/fixtures/ledgerEvents.ts` — a set of
   `portfolio.position.closed` `LedgerEvent`s (Connect-JSON camelCase) carrying `realizedPnl` and the
   feature-031 `cost_basis`/`opened_at` payload keys, plus at least one **legacy** event lacking both
   (AC-13). Add the `INVENTORY.md` row (domain "Ledger events (portfolio.position.closed)", symbol,
   module, consumers). Point `e2e/mock-backend.ts` `queryEvents` at the fixture; add `getConfig`
   (returns `ui.performance.*` values) and `getTradingEnvironment` handlers reachable from
   `/insights/api`.
2. `performance.spec.ts`:
   - **AC-1**: seed 10 closed trades + `equity_curve_start_date '2026-01-01'`; open
     `/insights/performance`; assert the equity curve renders and the final cumulative value = sum of
     the 10 `realizedPnl`.
   - **AC-6**: default poll; after the mock adds a new closed trade, metrics update within ≤65s with no
     full reload (assert via a stable page marker / no navigation). Use a shortened interval hook or
     Playwright clock if the suite supports it; otherwise assert the `refetchInterval` query re-runs.
   - **AC-7**: drag the recharts `Brush` to a narrower window → chart rescales and the URL/page stays on
     `/insights/performance` (not navigated away).
   - **AC-8**: set the date-range picker to 2026-06-01..2026-06-30 → equity curve, max drawdown, Sharpe,
     and summary cards all recompute for that window (assert changed values vs. full range).
   - **AC-9**: `getTradingEnvironment` → paper (staging) → the "Paper Trading" `TradingModeBadge` is
     visible.
   - **AC-10**: `getTradingEnvironment` → live (production) → the "Paper Trading" label is absent.
   - (AC-4 placeholder): with a zero-variance window, assert the Sharpe card shows the not-available
     placeholder, never "Infinity"/"NaN".
3. C-12: import the fixture from `e2e/fixtures/ledgerEvents.ts` and auth from `e2e/helpers/auth.ts` —
   no inline domain literals; the config/paper scenario overrides (staging vs production) stay inline as
   scenario one-offs.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -- performance
cd services/xstockstrat-ui && pnpm run lint
grep -n "from '../fixtures/ledgerEvents'\|helpers/auth" e2e/insights/performance.spec.ts
grep -n "ledgerEvents" e2e/fixtures/INVENTORY.md
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
