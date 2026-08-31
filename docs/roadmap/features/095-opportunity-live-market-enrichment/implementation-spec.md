# Implementation Spec: opportunity-live-market-enrichment

**Status**: `pending`
**Created**: 2026-08-31
**Feature**: `docs/roadmap/features/095-opportunity-live-market-enrichment/feature.md`
**Total Steps**: 13
**Feature Branch**: `feature/opportunity-live-market-enrichment`

---

## Execution Summary

The feature enriches the Decide surface with live market context, following `design.md`'s
**enrich-at-READ-time, never at rank-time** approach so FR-8/AC-14 (no look-ahead into ranking) holds
by construction. Order: (1) additive proto — the `Opportunity` 13-18 block on `analysis.proto` plus a
dedicated additive `GetLatestPrice` RPC on `marketdata.proto`; (2) regen stubs; (3-4) marketdata
implements `GetLatestPrice` (latest trade + prior close, cache/DB-backed); (5) register the
`analysis.opportunity.sparkline_bars` config key (no-seed, code-default pattern — matches every other
`analysis.opportunity.*` key); (6-7) analysis populates the enrichment — **strategy-derived** fields
(`target_price`/`stop_price`/`conditions`) at **compute time** persisted in the row JSONB and carried
by `_row_to_opportunity`, and **live-market** fields (`live_price`/`change_pct`/`sparkline`) at **read
time** on the returned message after ranking; (8-11) the four UI surfaces; (12-13) the read-only agent
`list_opportunities` MCP tool. **No DB migration** — the enrichment reads existing OHLCV/quotes, and
persisted `Opportunity` extras ride the existing `analysis.opportunities` row JSONB exactly as `muted`
rides the `"denied"` provenance marker (no column; `servicer.py:3873-3875`). **No new env vars/ports**
(recon § "New env vars / ports: none").

**Design-detail resolved at spec time (records the "how" `design.md` left open):** `target_price`/
`stop_price`/`conditions` are resolved and **persisted in `_compute_opportunities`** (where the
strategy definition and the traced `ConditionEval` leaves already exist — no recompute, no strategy
load added to the pure-read path) and carried in `_row_to_opportunity` (so they join `_MAPPED` in the
OR-F parity test); `live_price`/`change_pct`/`sparkline` are set at read time in `ListOpportunities`
and therefore join `_INTENTIONALLY_UNSET` in that same parity test. `change_pct` is **derived** in
analysis (`(last-prev)/prev`) from marketdata's `last_price`+`prev_close`, never carried on the
marketdata wire (design (a)). This split keeps the ranking hot path frozen (AC-14) while satisfying
the descriptor-parity guard.

**Open design risk carried into execution (surface, don't silently resolve — P-03):** `design.md`'s
Chosen Approach (a) commits to a **single-symbol** `GetLatestPrice(symbol)` RPC, while its unchecked
Open Risk asks the read-time enrichment to **batch** the ≤50 quote reads under the
`fix-ohlcv-chunk-lock-oom` budget. This spec follows the committed single-symbol RPC and bounds the
per-read fan-out with analysis's **existing** `analysis.opportunity.max_concurrent_bars_fetches`
semaphore (feature 141, `servicer.py:381`) plus a per-pass dedup, and serves `prev_close`/bars from
cache/DB (no extra Alpaca call). If the marketdata step's paired load check shows this is insufficient,
a `GetLatestPricesMulti` batch RPC is the follow-up — flagged here rather than pre-built (behavior #2).

### Scenario Coverage (C-15)

| Scenario | Covered by step(s) |
|---|---|
| AC-1 (queue card live price + change%) | 4 (price source), 7 (change_pct derivation), 9 (render) |
| AC-2 (Signal-detail header live price + change%) | 10 |
| AC-3 (queue-card sparkline from recent bars) | 7 (build), 9 (render) |
| AC-4 (sparkline gap → null, never NaN) | 7 (analysis unset close), 13 (agent null projection) |
| AC-5 (condition chips reuse ConditionEval, no client recompute) | 7 (analysis conditions field), 10 (render) |
| AC-6 (condition leaf with no value renders nothing) | 7, 9/10 |
| AC-7 (target/stop overlay lines + legend) | 10 |
| AC-8 (absent target/stop → no line, not a zero line) | 7 (analysis omit), 10 (UI no line), 13 (agent omit) |
| AC-9 (R:R + suggested shares, client-side) | 11 (vitest) |
| AC-10 (execution path unchanged) | 11 (e2e) |
| AC-11 (unavailable quote omitted, not fabricated) | 7 (analysis unset), 9/10 (UI em-dash), 13 (agent omit) |
| AC-12 (cross-surface price parity) | 10 (parity spec) |
| AC-13 (off-queue symbol → symbol + price only) | 10 |
| AC-14 (no look-ahead into ranking) | 7 (no-look-ahead parity test) |
| AC-15 (agent list_opportunities enrichment + omit absent target) | 13 |

### Consumer Surfaces (C-14)

Both surfaces the product spec names earn their own steps. **UI** — Opportunities queue cards (Step 9),
Signal-detail `trader/positions/[symbol]` header + chart overlays + chips (Step 10), order-ticket R:R +
sizing (Step 11); shared BFF/mock/fixtures plumbing in Step 8. **Agent** — the read-only
`list_opportunities` MCP tool (Steps 12-13). The target/stop **authoring** UI is deferred to the named
follow-up feature **`strategy-target-stop-authoring`** (see § Step Dependencies) — a C-14-legal named
deferral. No config-UI change.

## Step Dependencies

- **Merge order (merge-order.md, 2026-08-31):** feature 095 **blocks** 110 on the `analysis.Opportunity`
  field-number split — 095 pre-assigns fields 13-18, 110 appends at 19+. 095 lands first; in a combined
  `/sdd-execute … sequential` run its steps precede 110's, and 110 re-derives next-free from the merged
  tree. `029` also touches `analysis.proto` (new RPC + messages only, no `Opportunity` field) — no
  collision; re-run `./scripts/buf-gen.sh` after each merge.
- Step 2 (proto-gen) requires Step 1 (proto).
- Steps 3, 4 (marketdata Go) require Step 2 (generated Go stubs).
- Step 6 (analysis) requires Step 2 (Python stubs) and Step 5 (config key declared); at runtime it calls
  the RPC Step 3 implements, so Step 3 should land before Step 6 for a live integration — the Step 7
  unit tests mock the marketdata stub and need only Steps 1-2.
- Step 7 [test] covers Step 6 [service] (analysis) and the Step 5 config read.
- Step 8 (UI plumbing) requires Step 2 (regenerated TS `marketdata_pb`). Steps 9, 10, 11 require Step 8.
- Steps 12, 13 (agent) require Step 2; the Step 13 unit tests mock the analysis stub (need only Steps 1-2).
- **Read-pressure open risk** (design.md Open Risk, unchecked): validated in Step 4's paired test
  (`prev_close`/bars from cache/DB, no extra Alpaca call) and bounded in Step 6 by the existing
  `max_concurrent_bars_fetches` semaphore. A `GetLatestPricesMulti` batch is the flagged follow-up if
  needed — not built here.
- **Deferred surface:** target/stop **authoring** → named follow-up `strategy-target-stop-authoring`
  (allocated by `/sdd-story` when created). Fields 15/16 ship WIRED (fed from
  `StrategyDefinition.signal_params.{target,stop}`), rendering nothing until that follow-up populates them.

---

### Step 1 — proto: additive `Opportunity` enrichment block + marketdata `GetLatestPrice` RPC

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/analysis/v1/analysis.proto` — modify
- `packages/proto/marketdata/v1/marketdata.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness + backward compatibility (additive, `buf breaking` green); xstockstrat-analysis owner — no look-ahead bias; xstockstrat-marketdata owner — Alpaca feed integrity; xstockstrat-ui owner — Connect-RPC call safety; xstockstrat-agent owner — MCP tool contract stability

**Codebase Evidence**:
- `Opportunity` current max field = 12 (`muted = 12`), `packages/proto/analysis/v1/analysis.proto:542-555`.
- `ConditionEval` message already exists (reuse verbatim), `analysis.proto:558-566`.
- Explicit-presence null-safe series idiom already in the proto — `IndicatorValue { optional double value = 1; }`, `analysis.proto:682-684`; `NamedSeries` comment (`:668-679`) documents why a wrapper-message-with-`optional double` (not a bare `DoubleValue`/`repeated double`) is required to distinguish a gap from `0.0` (P-03).
- `SymbolReadiness` max field = 5 (`:568-574`) — **unchanged** (design (d): the Signal-detail header reuses `Opportunity`, so no `SymbolReadiness` field is added).
- `marketdata` `Quote` returns bid/ask only (max field 7, `marketdata.proto:60-68`); `MarketDataService` block `:12-42`; `GetLatestQuote`/`Quote` at `:23`. No latest-trade / prior-close anywhere (recon; `alpaca/client.go:223-267`).

**TDD**: `N/A (proto)`

**Covers**: —

**Instructions**:
1. In `analysis.proto`, append a new message after `ConditionEval` (or beside `IndicatorValue`): `message SparklinePoint { optional double close = 1; }` (explicit presence — an unset `close` models a warm-up/absent bar, never `NaN`/`0`; mirrors `IndicatorValue`).
2. In `message Opportunity`, append the pre-assigned contiguous block after `muted = 12` (field numbers **exactly** 13-18 so feature 110 lands at 19+):
   - `optional double live_price = 13;`
   - `optional double change_pct = 14;`
   - `optional double target_price = 15;`
   - `optional double stop_price = 16;`
   - `repeated SparklinePoint sparkline = 17;`
   - `repeated ConditionEval conditions = 18;`
   Add a comment noting 13/14/17 are read-time live-market fields, 15/16/18 are compute-time strategy-derived fields, and 15/16 stay unset until the `strategy-target-stop-authoring` follow-up populates `signal_params.{target,stop}`. No new enum (C-04 does not fire).
3. In `marketdata.proto`, add to `service MarketDataService` (after `GetLatestQuote`, `:23`): `rpc GetLatestPrice(GetLatestPriceRequest) returns (LatestPrice);`
4. Add the two messages:
   ```proto
   message GetLatestPriceRequest { string symbol = 1; }
   message LatestPrice {
     string symbol = 1;
     optional double last_price = 2;        // latest trade
     google.protobuf.Timestamp last_trade_time = 3;
     optional double prev_close = 4;         // prior session daily close
     string source = 5;                      // "alpaca"
   }
   ```
   `optional` on `last_price`/`prev_close` so absence is explicit presence → AC-11 omit-not-fabricate (never a cache-hit fabricated `0`).

**Verification**:
- `cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/opportunity-live-market-enrichment"` — both green (additive only).

---

### Step 2 — proto-gen: regenerate stubs

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/` — modify (generated; never hand-edit)

**Reviewers**: Proto Reviewer — field number uniqueness + backward compatibility (inherited from Step 1); xstockstrat-analysis owner; xstockstrat-marketdata owner; xstockstrat-ui owner; xstockstrat-agent owner

**Codebase Evidence**:
- `./scripts/buf-gen.sh` generates TS + Python + Go stubs and compiles the TS package (root CLAUDE.md § Generating Proto Stubs); the `proto-freshness` CI job enforces an empty `git diff packages/proto/gen/` after regen.

**TDD**: `N/A (proto-gen)`

**Covers**: —

**Instructions**:
1. Run `./scripts/buf-gen.sh` from the repo root.
2. Stage the regenerated `packages/proto/gen/` output (Go/Python/TS + compiled `gen/ts/dist/`). Do not hand-edit.

**Verification**:
- `./scripts/buf-gen.sh && git diff --exit-code packages/proto/gen/` — clean after commit (proto-freshness parity).

---

### Step 3 — service: marketdata `GetLatestPrice` (latest trade + prior close)

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/alpaca/client.go` — modify (add latest-trade fetch)
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify (add `GetLatestPrice`)
- `services/xstockstrat-marketdata/internal/handler/marketdata_handler.go` — modify (add `GetLatestPrice` handler)
- `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go` — modify (prior daily close read)

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- Existing quote handler `GetLatestQuote` (validates `symbol`, delegates to service, wraps errors), `internal/handler/marketdata_handler.go:98-107`; adapter form at `:214`.
- Existing service `GetLatestQuote` (cache → live Alpaca fallback → cache), `internal/service/marketdata_service.go:451`.
- Existing Alpaca REST client `GetLatestQuote` hits `/v2/stocks/{sym}/quotes/latest?feed=…` returning bid/ask only, `internal/alpaca/client.go:234-267`; `feedParam()` and the shared rate limiter are used by every call; multi variant `GetLatestQuotesMulti` at `:339` (the cache/multi shape to mirror).
- Recent daily bars read `QueryRecentBars(ctx, symbol, "1d", end, pageSize)` (`ORDER BY time DESC`), `internal/repository/marketdata_repo.go:169`; latest-quote cache read `GetLatestQuote` at repo `:269`. `GetBars` serves daily from `marketdata.ohlcv` (feature 143 — daily-only), `marketdata_service.go:128`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In `internal/alpaca/client.go`, add a `GetLatestTrade(ctx, symbol)` method mirroring `GetLatestQuote` (`:234`): hit Alpaca's latest-trade endpoint `/v2/stocks/{sym}/trades/latest?feed=<feedParam()>`, parse the trade price `p` + timestamp `t`, route through the same shared rate limiter and auth headers. (A snapshot endpoint is acceptable if it returns latest trade + prev daily bar in one call — pick the single-call shape that also yields `prev_close` to minimize Alpaca calls.)
2. In `internal/service/marketdata_service.go`, add `func (s *MarketDataService) GetLatestPrice(ctx context.Context, symbol string) (*marketdatav1.LatestPrice, error)`: resolve `last_price`+`last_trade_time` from the latest-trade fetch (cache-backed like `GetLatestQuote:451` where a cache is available); resolve `prev_close` from the **prior stored daily bar** via the repo (a DB read — the second-newest `1d` bar from `QueryRecentBars(symbol,"1d",now,2)`, or a dedicated repo query), so **no extra Alpaca call** is made for prev close. Leave `last_price`/`prev_close` **unset** when unavailable (never `0`). `source = "alpaca"`.
3. Add a repository method (or reuse `QueryRecentBars`) returning the prior session daily close for a symbol.
4. In `internal/handler/marketdata_handler.go`, add `GetLatestPrice` mirroring `GetLatestQuote:98` — reject empty `symbol` with `CodeInvalidArgument`, delegate to `s.svc.GetLatestPrice`, wrap errors; add the adapter method beside `:214`.
5. **Header propagation**: this step adds no new *outbound* gRPC to another backend (marketdata is a leaf that only reads Alpaca/DB), so the C-03 propagation rule does not add plumbing here.

**Verification**:
- `cd services/xstockstrat-marketdata && GOWORK=off go build ./...` — compiles.
- Lint + coverage run in the paired Step 4.

---

### Step 4 — test: marketdata `GetLatestPrice`

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/alpaca/client_test.go` — modify/create (latest-trade parse)
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify/create (`GetLatestPrice`)

**Reviewers**: xstockstrat-marketdata owner — Alpaca feed idempotency, OHLCV integrity

**Codebase Evidence**:
- Coverage command + threshold (40%) and the excluded-package set (`cmd/handler/repository/telemetry/service`) — `.claude/skills/sdd-spec/reference/spec-template.md` § coverage table. `internal/alpaca/` is **not** excluded, so the latest-trade parse is coverage-measured; the new `service`/`handler`/`repository` logic is in excluded packages.
- Test-data (C-13): marketdata has no `internal/testdata/` home today (`ls services/xstockstrat-marketdata/internal/testdata` — absent); a single-consumer inline HTTP-body/bar literal is compliant. Do not create a home speculatively.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-11`

**Instructions**:
1. Write the failing tests first (red): (a) in `internal/alpaca/client_test.go`, assert `GetLatestTrade` parses the trade price + time from a stub HTTP body (table-driven, one inline body literal — single consumer, C-13 compliant); (b) in `internal/service/marketdata_service_test.go`, assert `GetLatestPrice` sets `last_price` from the trade and `prev_close` from the **stored prior daily bar** with **no second Alpaca call** (AC-1 price source; read-pressure open risk), and that an **absent** trade/prev-bar leaves `last_price`/`prev_close` **unset** (`HasField`-equivalent — `Optional*` accessor returns not-present) rather than `0` (AC-11).
2. Note in the step: the new `service`/`handler`/`repository` logic is in coverage-**excluded** packages — the `alpaca` parse test carries the measurable assertion; integration verification of the service wiring is sufficient there. A `test` step is still required (C-08).

**Verification**:
- `cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod`
- `cd services/xstockstrat-marketdata && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"` — ≥ 40%.

---

### Step 5 — config: register `analysis.opportunity.sparkline_bars`

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify (Config Keys Consumed table)
- `docs/patterns/config-governance.md` — modify (Per-Feature Registered Keys log)

**Reviewers**: xstockstrat-analysis owner — strategy scoring determinism; xstockstrat-config owner — config key naming (`<service>.<category>.<key>`), scoping, WatchConfig stream stability

**Codebase Evidence**:
- The `analysis.opportunity.*` category uses the **no-config-service-seed-migration** pattern: read live via `self._cfg.get_int(...)` with the code default, resolving to that default until an operator `SetConfig`s it (features 131 `docs/patterns/config-governance.md:248-261` and 141 `:223-235`; matched by `analysis.opportunity.max_concurrent_bars_fetches`, `services/xstockstrat-analysis/servicer.py:381`). No seed migration required.
- The batch config-migration NNN pre-assignment note (merge-order.md:187-198) does **not** allocate a config migration to 095 — consistent with the no-seed pattern.
- Naming/registration rules — `docs/patterns/config-governance.md:53-57` (register a new key: declare default in the consuming service's `CLAUDE.md`; add a Per-Feature Registered Keys entry).

**TDD**: `N/A (config)` — the code read + its default are exercised by the analysis service step (Step 6) and its paired test (Step 7).

**Covers**: —

**Instructions**:
1. Add a row to `services/xstockstrat-analysis/CLAUDE.md` § "Config Keys Consumed" (`analysis` namespace): `| analysis.opportunity.sparkline_bars | int | 20 | Number of most-recent daily bar closes fetched per opportunity for the Decide-surface sparkline (feature 095, AC-3). Read live per read-time enrichment via get_int with a max(1, …) clamp; no config-service seed migration (analysis.opportunity.* no-seed pattern). |`. Default **20** (AC-3 renders 20 bar closes).
2. Add a `### feature 095 — opportunity-live-market-enrichment (xstockstrat-analysis)` entry at the top of the Per-Feature Registered Keys log in `docs/patterns/config-governance.md`, documenting the one key, its `20` default, F-07 env-overridability, and the no-seed rationale.

**Verification**:
- `grep -n "analysis.opportunity.sparkline_bars" services/xstockstrat-analysis/CLAUDE.md docs/patterns/config-governance.md` — present in both.

---

### Step 6 — service: analysis read-time enrichment in `ListOpportunities`

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, **no look-ahead bias**; Platform Lead — inter-service dependency graph correctness (new analysis→marketdata `GetLatestPrice` edge)

**Codebase Evidence**:
- `ListOpportunities` is a **pure DB read**: builds `propagation_meta` from the inbound metadata (`servicer.py:2958-2962`), reads the materialized queue, paginates `window = rows[offset:offset+page_size]` (`:2992`), returns `[_row_to_opportunity(r) for r in window]` (`:2994-2996`). `_DEFAULT_OPP_PAGE_SIZE = 50` (`:256`).
- `_row_to_opportunity(row)` is the OR-F descriptor-parity contract point — every `Opportunity` field is populated here (`:3855-3880`); `muted` rides the `"denied"` provenance marker with no DB column (`:3873-3875`).
- `_compute_opportunities` persists the queue rows and already runs the readiness **trace** + loads the attributed `StrategyDefinition` (`:3037`; the trace producing `ConditionEval` leaves — evaluator `evaluate_conditions_traced`, analysis CLAUDE.md § Decide-surface RPCs).
- marketdata stub already wired: `self._marketdata = MarketDataServiceStub(marketdata_channel)` (`:344`, `MARKETDATA_ENDPOINT` in `app/main.py`); existing bars fetch `self._marketdata.GetBars(..., metadata=propagation_meta)` via `_fetch_bars_paged` (`:1047-1078`) — the C-03-propagating call pattern to reuse for the new `GetLatestPrice`/sparkline reads.
- Existing read-pressure bound: `_bars_fetch_sem` from `max(1, self._cfg.get_int("analysis.opportunity.max_concurrent_bars_fetches", 2))` (`:381`).
- Null-safe explicit-presence idiom for series points — `IndicatorValue(value=v) if v is not None else IndicatorValue()` (`:2919-2924`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Compute-time, strategy-derived (persisted, carried by the mapper):** in `_compute_opportunities` (`:3037`), for each attributed row persist into the row's readiness JSONB (the same JSONB carrier `passing/total`/`muted` use — no new column, no migration): (a) the already-traced `ConditionEval` leaves (the trace already runs — **no recompute**, AC-5); (b) `target`/`stop` read from the attributed `StrategyDefinition.signal_params` (`Struct`, `analysis.proto` field 6) as **optional numeric** keys — present → store, absent → store nothing (AC-8, never fabricated; no ATR derivation, indicators out of scope).
2. In `_row_to_opportunity` (`:3855`), carry the persisted values onto the message: `conditions` (field 18) from the stored leaves; `target_price`/`stop_price` (15/16) **only when present** in the row (leave unset otherwise — `opp.target_price = …` guarded by presence, matching the `valid_until` conditional at `:3877-3879`). Unattributed rows carry no `conditions` (AC-6).
3. **Read-time, live-market (set on the returned message, post-ranking):** in `ListOpportunities`, after mapping the `window` (`:2994-2996`), enrich each returned `Opportunity` for its `symbol`, bounded by `_bars_fetch_sem` and deduped per symbol per pass: call `self._marketdata.GetLatestPrice(GetLatestPriceRequest(symbol=…), metadata=propagation_meta)` and, when `HasField("last_price")`, set `live_price = last_price`; when both `last_price` and `prev_close` are present and `prev_close != 0`, set `change_pct = (last_price - prev_close) / prev_close` (derived here, AC-1). Fetch the sparkline via `self._marketdata.GetBars(...timeframe_enum=1d, page.page_size=self._cfg.get_int("analysis.opportunity.sparkline_bars", 20) clamped max(1,…))` newest page (reuse `_fetch_bars_paged`), and set `sparkline` = one `SparklinePoint(close=b.close)` per bar in order, an **unset-close** `SparklinePoint()` for a warm-up/missing bar (AC-4, P-03 — never `NaN`/`0`). A `GetLatestPrice`/`GetBars` miss or RPC error → leave the live fields **unset** (AC-11), never abort the read.
4. **No look-ahead (FR-8/AC-14):** all enrichment runs **after** `_row_to_opportunity` and outside `_compute_opportunities`' conviction/`signal_axis`/ORDER BY computation — a fixed ranking input yields an identical score/order whether or not enrichment is attached. Do not read live price inside the ranking path.
5. **Header propagation (C-03):** the new `GetLatestPrice` call and the sparkline `GetBars` call both pass `metadata=propagation_meta` (built at `:2958-2962`), matching the existing `_fetch_bars_paged` call (`:1070-1078`) — forwards `x-user-id`/`x-access-scope`/`x-trace-id`.

**Verification**:
- `cd services/xstockstrat-analysis && python -c "import ast,sys; ast.parse(open('app/handlers/servicer.py').read())"` — parses; full lint + coverage in Step 7.

---

### Step 7 — test: analysis enrichment + parity + no-look-ahead

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify

**Reviewers**: xstockstrat-analysis owner — no look-ahead bias, strategy scoring determinism

**Codebase Evidence**:
- OR-F descriptor-parity guard `TestOpportunityRowParity` — `_MAPPED` + `_INTENTIONALLY_UNSET` must equal `Opportunity.DESCRIPTOR.fields_by_name` (`tests/test_analysis_servicer.py:4847-4877`); `test_mapper_populates_all_fields` (`:4879-4906`). **Adding fields 13-18 fails `test_mapper_covers_every_proto_field` until they are added to one of the two sets** — this test MUST be updated in lockstep.
- Existing opportunity-action servicer tests (mock-stub pattern) `:5275-5334`; `_row_to_opportunity` import at `:4880`.
- Test-data (C-13): analysis has a `tests/conftest.py` home; the `_row_to_opportunity` row dicts are built inline per test today (`:4883-4894`) — a single-consumer inline row stays inline; centralize only on a second consumer.

**TDD**: `red-green required`

**Covers**: `AC-4, AC-5, AC-6, AC-8, AC-14`

**Instructions**:
1. **Update the parity guard** (red first): add `target_price`, `stop_price`, `conditions` to `_MAPPED` (carried by `_row_to_opportunity`) and `live_price`, `change_pct`, `sparkline` to `_INTENTIONALLY_UNSET` (set at read time, not by the mapper). `test_mapper_covers_every_proto_field` (`:4868`) goes green only once all six are accounted for.
2. Assert `_row_to_opportunity` carries `conditions` from the persisted trace leaves (AC-5) and none for an unattributed row (AC-6); carries `target_price`/`stop_price` when the row has them and **leaves them unset when absent** (AC-8).
3. Assert `ListOpportunities` read-time enrichment against a **mocked** `self._marketdata` stub: a `GetLatestPrice` returning `last_price`+`prev_close` sets `live_price` and the **derived** `change_pct`; a `GetBars` page builds `sparkline` with a `SparklinePoint()` **unset close** for a missing bar (AC-4 — assert `HasField("close")` is False for the gap, never `NaN`/`0`); a `GetLatestPrice` **miss** leaves `live_price`/`change_pct` unset (AC-11 reinforced).
4. **No-look-ahead parity (AC-14):** assert conviction score + row ordering are **identical** with the marketdata enrichment attached vs. a stubbed-empty marketdata (enrichment off) for a fixed queue input — proving the live quote never enters the ranking path.

**Verification**:
- `cd services/xstockstrat-analysis && ruff check . && ruff format --check .`
- `cd services/xstockstrat-analysis && pytest --cov=app --cov-fail-under=40` — passes.

---

### Step 8 — service: UI marketdata `getLatestPrice` plumbing (BFF + mock + fixtures)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/insightsBff.ts` — modify (add `getLatestPrice` route)
- `services/xstockstrat-ui/src/lib/traderBff.ts` — modify (add `getLatestPrice` route)
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (add `getLatestPrice` handler)
- `services/xstockstrat-ui/e2e/fixtures/opportunities.ts` — modify (add enrichment fields + a `latestPrice` fixture)
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify (update rows 25-26 / add a marketdata latest-price fixture row)

**Reviewers**: xstockstrat-ui owner — Connect-RPC call safety, analytics display accuracy

**Codebase Evidence**:
- Both BFFs register `MarketDataService` with **only** `getBars` today — `insightsBff.ts:79-80`, `traderBff.ts:73-74` (the `forward((req, opts) => marketDataClient.getBars(req, opts))` pattern to mirror for `getLatestPrice`).
- Browser client is the full-service generated client `marketDataClient = createClient(MarketDataService, transport)` (`src/lib/browserClients/marketDataClient.ts:6`) — the new `getLatestPrice` RPC is **automatically** available on it once the stub is regenerated (Step 2); **no edit to `marketDataClient.ts`** is needed.
- e2e mock `MarketDataService` has **only** `getBars` (`e2e/mock-backend.ts:457-458`) — a `getLatestPrice` handler must be added.
- Fixtures: `OPPORTUNITIES` (incl. the two `CAPR` rows the ACs name) + `symbolReadiness(symbol)` in `e2e/fixtures/opportunities.ts:11,127-149,179`; catalogued in `INVENTORY.md:25-26` (`xstockstrat.analysis.v1.Opportunity` / `SymbolReadiness`).

**TDD**: `red-green required` (behavioral e2e lands in the consuming Steps 9-11)

**Covers**: —

**Instructions**:
1. Add `getLatestPrice: forward((req, opts) => marketDataClient.getLatestPrice(req, opts))` to the `MarketDataService` router block in **both** `insightsBff.ts:79-80` and `traderBff.ts:73-74` (C-10(b) — enrich **both** read paths so the queue card and Signal-detail header read the same source; do not wire one only).
2. Add a `getLatestPrice` handler to `e2e/mock-backend.ts:457` returning a `LatestPrice` for the requested symbol (drive it from the new fixture); model an unavailable symbol by returning unset `last_price`/`prev_close` (AC-11 path).
3. Extend `OPPORTUNITIES` in `e2e/fixtures/opportunities.ts` with the new enrichment fields on the `CAPR` rows (`livePrice`, `changePct`, `sparkline` bar closes with one gap, `targetPrice`/`stopPrice`, `conditions`) — Connect-JSON camelCase; add a `CAPR_LATEST_PRICE` fixture (`lastPrice: 12.34`, `prevClose: 12.09` per AC-1/AC-2/AC-12). Update `INVENTORY.md` rows 25-26 and add a marketdata latest-price fixture catalog row (C-12).

**Verification**:
- `cd services/xstockstrat-ui && pnpm lint && pnpm build` — the BFF handler-map typechecks against the regenerated `MarketDataService` (a missing/misnamed method fails `tsc`); confirms the route resolves (nextjs-frontends.md § BFF handler-map).

---

### Step 9 — service: UI Opportunities queue cards (price, change%, sparkline, condition chip)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/opportunities/page.tsx` — modify
- `services/xstockstrat-ui/src/lib/opportunityShared.tsx` — modify (if a shared chip/sparkline helper is added)
- `services/xstockstrat-ui/e2e/insights/opportunities.spec.ts` — modify (e2e)

**Reviewers**: xstockstrat-ui owner — trading UI correctness, analytics display accuracy, no secret values rendered

**Codebase Evidence**:
- The queue page already reads `useOpportunities(0)` (`opportunities/page.tsx:95`) and documents the intentional omission this feature closes: "live price/change, sparkline, per-condition values, R:R … intentionally omitted rather than faked" (`:91-92`). Buying power already fetched via `insightsPortfolioClient.listPortfolios({})` (`:131`).
- Enum render maps are over **enums** (`OPPORTUNITY_ACTION`/`CONDITION_STATE`/…) — exhaustive `Record<Enum,…>` at `src/lib/opportunityShared.tsx:29-52`; this feature adds **fields**, not enum values, so C-10(a/d) does not fire (recon; no map edit forced).
- e2e fixture + spec home per INVENTORY.md:25 (`opportunities.spec.ts`).

**TDD**: `red-green required` (e2e)

**Covers**: `AC-1, AC-3, AC-11`

**Instructions**:
1. On each queue card render `livePrice` + `changePct` (formatted `+2.1%`), a compact sparkline of the `sparkline` closes in order, and the blocking-condition chip from `conditions` (reusing the `ConditionState` render map in `opportunityShared.tsx` and the emitted `ConditionEval` values — `close > sma_20 +1.4%`, **no client recompute**, AC-5 support). Remove the "intentionally omitted" doc comment at `:91-92`.
2. **No-fabrication (FR-6/AC-11):** when a card's `livePrice`/`changePct` is unset, render an em-dash / omit the stat — never a stale or recomputed value. A `SparklinePoint` with unset `close` renders a gap (AC-4 render side). Use design-role tokens + a canonical `ui/*` primitive for the chip/sparkline (C-17 — no hardcoded color).
3. Extend `opportunities.spec.ts` (red first) driving the mock fixtures: assert the `CAPR` card shows live price `12.34` and change `+2.1%` (AC-1), a 20-point sparkline (AC-3), and that an unavailable-quote fixture renders the price omitted/em-dashed, not fabricated (AC-11).

**Verification**:
- `cd services/xstockstrat-ui && pnpm lint`
- `cd services/xstockstrat-ui && pnpm test:e2e -g "opportunities"` — the new assertions pass.

---

### Step 10 — service: UI Signal-detail page (header, target/stop overlays, chips, parity)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` — modify
- `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts` — modify (e2e + parity)

**Reviewers**: xstockstrat-ui owner — trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- The **real** Signal-detail surface is `trader/positions/[symbol]/page.tsx` (feature 125; `insights/market/[symbol]` is a redirect stub — recon). It already reads `useOpportunities(0)` → `symbolOpportunities` for this symbol (`:185-189`), renders `SignalReadiness` (`:30`, `:464`) and `OrderForm` (`:58`, `:342`), and draws chart price lines via `priceLinesRef` in `SymbolPriceChart` (`:129`, `:222-237`, `:501-554`) — the exact overlay mechanism to reuse for target/stop.
- Held-only price gap: `last = Number(position?.currentPrice ?? 0)` (`:136`) → `0` for a non-held/off-queue symbol (the FR-1 gap AC-13 closes); `avg`/`stop`/`hasStop` are position fields (`:134-137`).
- Cross-surface parity holds structurally — both surfaces read `Opportunity.live_price` from the shared `useOpportunities` React-Query cache (design (d)).

**TDD**: `red-green required` (e2e)

**Covers**: `AC-2, AC-7, AC-8, AC-12, AC-13`

**Instructions**:
1. Header: render `livePrice` + `changePct` + sparkline from the matching `symbolOpportunities` row (`:185-189`) — same field the queue card reads (AC-2, AC-12 same-source parity). For an **off-queue** symbol (no matching row) fall back to a direct `marketDataClient.getLatestPrice({symbol})` call → show symbol + live price only, **no** chips/overlays/R:R (AC-13).
2. Target/stop overlays: in `SymbolPriceChart` (`:501`), when the row carries `targetPrice`/`stopPrice`, push horizontal price lines via `priceLinesRef` (mirror the avg/stop lines at `:222-237`) labeled `target`/`stop`, and extend the legend (`:526`, `:537-544`) to name target, stop, and the signal bar (AC-7). When `targetPrice`/`stopPrice` are **absent**, draw **no line** — in particular never a line at price `0` (AC-8; guard on presence, not on `> 0` of a fabricated default).
3. Per-condition chips on the readiness leaves from the row's `conditions` / `SignalReadiness` `ConditionEval` values (reuse, no recompute — AC-5).
4. C-17: design-role tokens for the overlay legend/chips; reuse `SymbolPriceChart`/`priceLinesRef` and existing primitives (no near-duplicate).
5. Extend `position-detail.spec.ts` (red first): header shows `12.34`/`+2.1%` (AC-2); with `targetPrice 14.00`/`stopPrice 11.50` two labeled overlay lines + legend render (AC-7); with no target/stop **no** overlay line is drawn (AC-8); an off-queue symbol shows symbol + price only (AC-13); **cross-surface parity** — assert the queue card and this header show the **same** `12.34` from one fetch cycle (AC-12).

**Verification**:
- `cd services/xstockstrat-ui && pnpm lint`
- `cd services/xstockstrat-ui && pnpm test:e2e -g "position-detail"` — new assertions pass.

---

### Step 11 — service: UI order ticket R:R + suggested sizing (client-side)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/orderSizing.ts` — create (pure R:R + sizing helpers)
- `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` — modify (render R:R + sizing on the ticket)
- `services/xstockstrat-ui/src/lib/orderSizing.test.ts` — create (vitest unit)
- `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts` — modify (execution-path-unchanged e2e)

**Reviewers**: xstockstrat-ui owner — trading UI correctness, config mutation safety (execution path unchanged)

**Codebase Evidence**:
- Vitest is the node-environment unit runner, coverage scoped to `src/lib/**` (root CLAUDE.md § Language Versions; feature 065) — the canonical home for a pure client-side computation like R:R/sizing.
- `OrderForm` is the ticket component (`positions/[symbol]/page.tsx:58`, `:342`); the order execution path is `usePlaceOrder`, environment-fixed PAPER/LIVE (design (c), FR-5/AC-10 — presentation only, no execution change).
- Buying power already on hand via `insightsPortfolioClient.listPortfolios` (queue page `:131`; available on the symbol page).

**TDD**: `red-green required`

**Covers**: `AC-9, AC-10`

**Instructions**:
1. Create `src/lib/orderSizing.ts` with pure functions: `riskReward(entry, stop, target)` → reward/risk per share and the `"2.0:1"` ratio; `suggestedShares(buyingPower, entry, stop)` → floor of a buying-power/per-share-risk sizing, `> 0`. No hardcoded colors/side effects.
2. Render R:R + suggested share count on the Signal-detail order ticket from values already on hand (`livePrice` as entry, `targetPrice`, `stopPrice`, buying power) — **presentation only**. Do **not** touch the `usePlaceOrder` path or send R:R/suggested-size to execution (AC-10). Omit the rows when inputs are missing (FR-6). C-17 tokens.
3. Write `src/lib/orderSizing.test.ts` (red first): entry 12.34, stop 11.50, target 14.00, buying power 5000 → R:R `2.0:1` (reward 1.66 vs risk 0.84 per share) and a suggested share count `> 0`, all client-side (AC-9).
4. Add an e2e assertion to `position-detail.spec.ts` that placing the order still goes through the same `usePlaceOrder`/`OrderForm` path with the environment-fixed mode, R:R/size not sent (AC-10).

**Verification**:
- `cd services/xstockstrat-ui && pnpm lint`
- `cd services/xstockstrat-ui && pnpm vitest run src/lib/orderSizing.test.ts` — passes (AC-9).
- `cd services/xstockstrat-ui && pnpm test:e2e -g "position-detail"` — execution-path assertion passes (AC-10).

---

### Step 12 — service: agent `list_opportunities` MCP tool + client projection + doc/count surfaces

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify (add `list_opportunities` projection)
- `services/xstockstrat-agent/app/tools.py` — modify (add `list_opportunities` tool + docstring count)
- `docs/runbooks/mcp-tools.md` — modify (count ×2 + reference entry)
- `services/xstockstrat-agent/CLAUDE.md` — modify (count + tool-table row)

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability, `mcp-tools.md` parity, tool-count in sync across all inventory surfaces, read-only caller-scoped correctness

**Codebase Evidence**:
- Agent has **no** opportunities tool today — `screen_symbols` reads a **different** RPC (`ScreenSymbols`→`ScreenResult`) carrying none of the 13-18 enrichment (design (e); grep-confirmed absence, F-04). So a new tool over the existing `ListOpportunities` RPC (`analysis.proto:34`, `ListOpportunitiesResponse:596`) is necessary.
- `client.screen_symbols` dict-projection pattern to mirror — `app/client.py:617-698` (per-result dict, enum `.Name()`, int64→str). `list_strategy_definitions` (`:794-807`) and `screen_symbols` (`:663-676`) show the `AnalysisServiceStub` + `_metadata(("x-user-id", user_id))` read-only caller-scoped call.
- `list_strategies` tool template (read-only, `_caller_user_id`, `{"strategies": …}` return) — `app/tools.py:1129-1142`; `_caller_user_id(ctx, tool)` helper `:118`.
- `ListOpportunitiesRequest` carries **no** `user_id` — resolved server-side from the propagated `x-user-id` (`analysis.proto:590-591`), which the agent forwards via `CallerPropagationMiddleware` (AGENT-4). Caller-scoped, **no admin scope** — matches `list_watchlists`/`list_strategies`.
- Tool-count invariant surfaces (currently **thirty-two**): `app/tools.py:4` ("Thirty-two tools:"), `docs/runbooks/mcp-tools.md:3` and `:37`, `services/xstockstrat-agent/CLAUDE.md:43`, and the exact name-set in `tests/test_tools_endpoint.py:23-56` (updated in Step 13). Feature 164 is the precedent for a two-surface count bump (`164-agent-broker-account-tools/implementation-spec.md:236-244`).
- `list_opportunities` is **not** one of the four APIs (`run_backtest`/`manage_strategy`/`trigger_backfill`/`set_strategy_live`) the `strat-lab` plugin encodes, so no plugin update is required (root CLAUDE.md).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In `app/client.py`, add `async def list_opportunities(user_id, min_conviction=0.0, ...) -> dict` mirroring `screen_symbols` (`:617-698`): call `AnalysisServiceStub.ListOpportunities(ListOpportunitiesRequest(min_conviction=…), metadata=_metadata(("x-user-id", user_id)))` and project each `Opportunity` to a dict — base fields (`symbol`, `action` name, `conviction`, `thesis`, `strategy_id`, `source`, `opportunity_key`, `provenance`, `muted`) **plus** the enrichment with **omit-not-fabricate**: `live_price`/`change_pct`/`target_price`/`stop_price` only under `o.HasField(...)` (unset → key omitted, AC-11/AC-8/AC-15); `sparkline` as bar closes with `None`→JSON `null` for each `SparklinePoint` whose `close` is unset (P-03/AC-4 — never `NaN`); `conditions` as per-`ConditionEval` leaves (`ref_name`/`lhs_value`/`threshold`/`fn`/`state` name/`distance_to_threshold`). **Do not** project R:R/suggested-size (UI-only, no wire field).
2. In `app/tools.py`, add a `@server.tool()` `async def list_opportunities(ctx, min_conviction=0.0) -> dict` mirroring `list_strategies` (`:1129-1142`): resolve `user_id = _caller_user_id(ctx, "list_opportunities")`, return `{"opportunities": await client.list_opportunities(user_id, min_conviction)}`, wrap `grpc.aio.AioRpcError`. Read-only, **no** admin `x-access-scope`. Update the module docstring header (`:4`) count `Thirty-two`→`Thirty-three` and add a `list_opportunities` line.
3. In `docs/runbooks/mcp-tools.md`, change `thirty-two`→`thirty-three` at `:3` and `:37`, and add a full reference entry (params `min_conviction`; return shape with the enrichment + omit-not-fabricate contract + `sparkline` null-gap note; error cases) mirroring an existing read-only tool entry.
4. In `services/xstockstrat-agent/CLAUDE.md`, change `registers thirty-two tools`→`thirty-three` (`:43`) and add a `| list_opportunities | List the caller's ranked Decide-queue opportunities with live-market enrichment (read-only, feature 095) |` row to the MCP Tools table.

**Verification**:
- `cd services/xstockstrat-agent && ruff check . && ruff format --check .`
- `grep -rn "thirty-three" docs/runbooks/mcp-tools.md services/xstockstrat-agent/CLAUDE.md services/xstockstrat-agent/app/tools.py` — count updated on every surface; `grep -rn "thirty-two" docs/runbooks/mcp-tools.md services/xstockstrat-agent/CLAUDE.md services/xstockstrat-agent/app/tools.py` — no stale count.

---

### Step 13 — test: agent `list_opportunities` projection + tool + catalog name-set

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_client.py` — modify (projection)
- `services/xstockstrat-agent/tests/test_tools.py` — modify (tool + caller-scoping)
- `services/xstockstrat-agent/tests/test_tools_endpoint.py` — modify (exact name-set)

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability, read-only caller-scoped correctness

**Codebase Evidence**:
- The catalog name-set assertion pins the exact registered-tool set — `tests/test_tools_endpoint.py:23-56` (must gain `"list_opportunities"` or the test fails).
- Mock-stub client/tool test patterns — `tests/test_client.py`, `tests/test_tools.py`; `conftest.py` for the agent's fixtures (C-13 home).

**TDD**: `red-green required`

**Covers**: `AC-4, AC-8, AC-11, AC-15`

**Instructions**:
1. Add `"list_opportunities"` to the exact name-set in `test_tools_endpoint.py:23-56` (red first — the set-equality assertion fails until added).
2. In `test_client.py`, assert `client.list_opportunities` against a mocked `AnalysisServiceStub`: an `Opportunity` with `live_price=12.34` set and **no** `target_price`/`stop_price` projects `live_price` and **omits** `target_price`/`stop_price` entirely (AC-15/AC-8); an unset `live_price` omits the key (AC-11); a `sparkline` with an unset-`close` `SparklinePoint` projects a JSON `null` for that point, never `NaN` (AC-4); `conditions` project the `ConditionEval` leaves. Assert the outbound call carries `x-user-id` (caller-scoped) and **no** admin `x-access-scope`.
3. In `test_tools.py`, assert the `list_opportunities` tool resolves the caller via `_caller_user_id` and returns `{"opportunities": [...]}`.

**Verification**:
- `cd services/xstockstrat-agent && ruff check . && ruff format --check .`
- `cd services/xstockstrat-agent && uv run pytest --cov=app --cov-fail-under=40` — passes (name-set + projection green).

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
