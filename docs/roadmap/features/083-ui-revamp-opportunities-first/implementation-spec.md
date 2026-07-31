# Implementation Spec: ui-revamp-opportunities-first

**Status**: `pending`
**Created**: 2026-07-31
**Feature**: `docs/roadmap/features/083-ui-revamp-opportunities-first/feature.md`
**Total Steps**: 31
**Feature Branch**: `feature/ui-revamp-opportunities-first`

---

## Execution Summary

Backend-first, then frontend, per the approved `design.md` § Ordering (user override: all backend gaps
ship in 083, no phased split). One additive proto pass across `analysis`/`portfolio`/`ingest` (four new
enums, each `_UNSPECIFIED=0`) → codegen + the four exhaustive TS `Record<Enum,…>` maps → the five
additive backend subsystems on an "analysis-owns-the-queue" spine (traced conviction evaluator →
`EvaluateReadiness` → `ListOpportunities`; ingest source-health migration 008; portfolio risk/factor;
analysis analytics + screener enrichment) → then the Nocturne UI (theme → shell/nav + C-10(a) test →
per-tab screens consuming the now-real RPCs → Copilot shallow beta on the ledger append-store → mobile
companion → non-happy states) → docs. No new DB pool (F-06 held: Copilot uses the ledger append-store,
ingest 008 adds columns not a pool, portfolio resting-stops are in-memory). No new synchronous
inter-service cycle (the `analysis→trading` edge is non-cyclic; portfolio learns stops from a ledger
order-event, not a reverse `portfolio→trading` edge).

## Step Dependencies

- Step 2 (proto-gen) requires Step 1 (proto): stubs + TS maps are generated from the new messages/enums.
- Steps 3–18 (all backend service/test/migration/config) require Step 2: they import the generated stubs.
- Step 5 (`EvaluateReadiness`) requires Step 3 (traced evaluator sibling).
- Step 7 (`ListOpportunities`) requires Step 5 (conviction/readiness) + the existing portfolio
  `ListPositions` and ingest `QuerySignals` edges.
- Step 12 (portfolio risk/factor) requires Step 13 (config key `portfolio.exposure.factor_map`) — the
  factor map is read at Step 12's factor-grouping code path; land 13 first or in the same PR.
- Step 15 (`GetStrategyAnalytics`) requires Step 1's proto + the new `analysis→trading` edge env vars.
- Steps 19–30 (frontend) require Step 2 (TS stubs + enum maps) and their respective backend RPC steps:
  22 needs 5+7; 23 needs 7+17; 24 needs 10; 25 needs 12; 27 (Copilot) needs only the existing ledger RPCs.
- Step 21 (nav-reachability e2e, C-10(a)) requires Step 20 (shell/nav) and must enumerate every screen
  incl. the pinned `accounts` surface.
- Step 26 (FR-20 order-parity + AC-8 valuation-parity + per-screen e2e) requires Steps 22–25.
- Step 31 (docs + context-scrubber) is last; it reconciles every CLAUDE.md / registered-keys surface the
  backend + config steps changed.
- **fails-082 guard:** every step PR targets `feature/ui-revamp-opportunities-first` **directly** — NOT
  base-chained step branches (they silently drop steps, fails.md 082). Diff landed content against this
  spec before the integration PR.
- **fails-082 branch-lineage guard:** confirm `git branch --show-current` is (or is a normal
  ancestor/descendant of) `feature/ui-revamp-opportunities-first` before the first write (design.md Open
  Risk; the session ran design on a `claude/*` branch).

---

### Step 1 — proto: additive pass on analysis / portfolio / ingest (four new enums)

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/analysis/v1/analysis.proto` — modify
- `packages/proto/portfolio/v1/portfolio.proto` — modify
- `packages/proto/ingest/v1/ingest.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking change, `buf lint`/`buf breaking` pass; `xstockstrat-analysis` (service owner) — opportunity-queue/readiness/analytics message shape; `xstockstrat-portfolio` (service owner) — Position risk-field shape; `xstockstrat-ingest` (service owner) — SignalSource health-field shape; Platform Lead — additive proto pass sign-off (approval-flow: 2 proto owners + platform lead)

**Codebase Evidence**:
- `analysis.proto` service block `AnalysisService` at `:12-31` (12 RPCs today); `ScreenResult` at `:340-347` uses field numbers **1–6** → raw enrichment fields start at **7**; `StrategyDefinition.active = 7` / `live_enabled = 8` (`:241-242`) are the booleans the UI derives Active/Paused/Off from (no state enum needed for that; `GetStrategyAnalytics` returns metrics, not state).
- `portfolio.proto` `Position` at `:43-63` uses field numbers **1–13** (last is `day_pnl_pct = 13`) → risk fields start at **14**.
- `ingest.proto` `SignalSource` at `:135-143` uses field numbers **1–7** (last is `config_json = 7`) → health fields start at **8**; `ExternalSignal.direction` at `:108` (`"buy"|"sell"|"hold"|"watchlist"`).
- Governance: root `CLAUDE.md` § Proto Contract Governance — every enum has `<NAME>_UNSPECIFIED = 0` (C-04); prefer enums for closed sets.

**TDD**: `N/A (proto)` — verification is `buf` + freshness.

**Instructions**:
Add, additively (append field numbers only; never renumber/retype existing fields — `BacktestResult`
carries the `:61-64` "persisted verbatim" warning, unaffected here since these are new messages):

1. **`analysis.proto`** — add to `AnalysisService`:
   - `rpc ListOpportunities(ListOpportunitiesRequest) returns (ListOpportunitiesResponse);`
   - `rpc EvaluateReadiness(EvaluateReadinessRequest) returns (EvaluateReadinessResponse);`
   - `rpc GetStrategyAnalytics(GetStrategyAnalyticsRequest) returns (StrategyAnalytics);`
   Add messages/enums:
   - `enum OpportunityActionTag { OPPORTUNITY_ACTION_TAG_UNSPECIFIED = 0; OPPORTUNITY_ACTION_TAG_ENTER = 1; OPPORTUNITY_ACTION_TAG_ADD = 2; OPPORTUNITY_ACTION_TAG_REDUCE = 3; }` — TRIM/EXIT deliberately collapsed to `REDUCE` (design.md § Rejected Alternatives; insights.md 2026-07-31).
   - `enum ConditionState { CONDITION_STATE_UNSPECIFIED = 0; CONDITION_STATE_PASS = 1; CONDITION_STATE_SOFT = 2; CONDITION_STATE_FAIL = 3; }`
   - `message Opportunity { string symbol; OpportunityActionTag action; double conviction; int32 passing_conditions; int32 total_conditions; string thesis; string strategy_id; string source; google.protobuf.Timestamp valid_until; }` (conviction is the deterministic ordinal `passing/total` + normalized worst-distance — NOT a probability; design.md § 2).
   - `message ConditionEval { string ref_name; double lhs_value; double threshold; string fn; ConditionState state; double distance_to_threshold; }`
   - `message SymbolReadiness { string symbol; double conviction; int32 passing_conditions; int32 total_conditions; repeated ConditionEval conditions; }`
   - `message StrategyAnalytics { string strategy_id; double expectancy; double blended_hit_rate; double max_drawdown; int32 signals_30d; int32 taken; double queue_share; }`
   - `ListOpportunitiesRequest { xstockstrat.common.v1.PageRequest page; double min_conviction; }` (`user_id` intentionally absent — taken from the propagated `x-user-id` header, matching the portfolio watchlist convention at `portfolio.proto:157-158`); `ListOpportunitiesResponse { repeated Opportunity opportunities; xstockstrat.common.v1.PageResponse page; }`.
   - `EvaluateReadinessRequest { string strategy_id; repeated string symbols; }`; `EvaluateReadinessResponse { repeated SymbolReadiness readiness; }`.
   - `GetStrategyAnalyticsRequest { string strategy_id; }`.
   - Extend `ScreenResult` (`:340`) additively with fields **7+**: `double pe = 7; double rsi = 8; double atr = 9; double rev_growth = 10; bool held = 11;` (raw column values for the screener results table, FR-8).
2. **`portfolio.proto`** — add `enum PositionRiskFlag { POSITION_RISK_FLAG_UNSPECIFIED = 0; POSITION_RISK_FLAG_ADD_SIGNAL = 1; POSITION_RISK_FLAG_REDUCE_SIGNAL = 2; POSITION_RISK_FLAG_STOP_NEAR = 3; }` and extend `Position` (`:43`) with fields **14+**: `double stop_price = 14; double risk_at_stop = 15; double stop_distance_pct = 16; string factor = 17; PositionRiskFlag flag = 18; string exit_rule = 19;`.
3. **`ingest.proto`** — add `enum SourceHealthStatus { SOURCE_HEALTH_STATUS_UNSPECIFIED = 0; SOURCE_HEALTH_STATUS_LIVE = 1; SOURCE_HEALTH_STATUS_STALE = 2; SOURCE_HEALTH_STATUS_DOWN = 3; }` and extend `SignalSource` (`:135`) with fields **8+**: `SourceHealthStatus health = 8; google.protobuf.Timestamp last_seen_at = 9; string last_error = 10; int64 signals_fed = 11;`.

**Verification**:
`cd packages/proto && buf lint && buf breaking --against '.git#branch=feature/ui-revamp-opportunities-first'`
— both clean (additive change, no breaking). Confirm every new enum's `_UNSPECIFIED = 0` present.

---

### Step 2 — proto-gen: regenerate stubs + author the four exhaustive TS `Record<Enum,…>` maps

**Status**: `pending`
**Service**: `packages/proto` + `xstockstrat-ui`
**Files**:
- `packages/proto/gen/**` — regenerate (do not hand-edit)
- `services/xstockstrat-ui/src/lib/opportunityShared.tsx` — create (the four render maps)

**Reviewers**: Proto Reviewer + `xstockstrat-analysis` + `xstockstrat-portfolio` + `xstockstrat-ingest` (inherited from Step 1)

**Codebase Evidence**:
- Codegen entrypoint: root `CLAUDE.md` § Generating Proto Stubs → `./scripts/buf-gen.sh` (regenerates TS/Python/Go + compiles the TS package); `proto-freshness` CI gate enforces an empty `git diff packages/proto/gen/` afterwards.
- Exhaustive-map trap: `services/xstockstrat-ui/src/components/insights/BacktestDiagnostics.tsx:9,18` (`ACTION_LABEL: Record<BarAction,…>`, `NO_TRADE_MESSAGE: Record<NoTradeReason,…>`) — the pattern a new enum must follow (fails.md 2026-07-21, C-10(a/d)). These are **new** enums so no existing exhaustive map breaks `tsc`, but each new enum MUST ship its own exhaustive map in this PR (product-spec § Proto Contract Changes enum-map caveat).
- Existing enum-map home precedent: `src/components/trader/orderShared.tsx:10` `STATUS_VARIANT: Record<…>`, `:23` `TYPE_LABEL`.

**TDD**: `N/A (proto-gen)`.

**Instructions**:
1. Run `./scripts/buf-gen.sh`. Commit only regenerated `packages/proto/gen/**` — no hand edits.
2. In `services/xstockstrat-ui/src/lib/opportunityShared.tsx`, author four exhaustive `Record<Enum,…>`
   render maps (one entry per value incl. `_UNSPECIFIED`), matching the `BacktestDiagnostics.tsx` shape:
   - `OpportunityActionTag` → label + semantic color role (`ENTER`/`ADD` = gain/`buy`, `REDUCE` = loss/`sell`, `UNSPECIFIED` = neutral).
   - `ConditionState` → label + role (`PASS` = gain, `SOFT` = paper, `FAIL` = loss, `UNSPECIFIED` = neutral).
   - `PositionRiskFlag` → label + role.
   - `SourceHealthStatus` → label + role (`LIVE` = gain, `STALE` = paper, `DOWN` = loss).

**Verification**:
`./scripts/buf-gen.sh && git diff --exit-code packages/proto/gen/` (empty diff — freshness) and
`cd services/xstockstrat-ui && pnpm build` — `tsc` compiles the four exhaustive maps (a missing enum key
fails the build).

---

### Step 3 — service: analysis traced-evaluator sibling + deterministic conviction

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/services/evaluator.py` — modify

**Reviewers**: `xstockstrat-analysis` (service owner) — strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `evaluate_with_series` at `evaluator.py:118-169` returns `(list[BarDecision], component_series)`; the hot path `evaluate` at `:102-116` delegates to it — the additive-sibling pattern (insights.md 2026-07-08).
- `_eval_condition` at `:415-459` returns a **bare bool**; leaf shape is `{lhs, rhs, fn}` (`:426-428`); it resolves `lhs_val = _resolve_term(lhs_ref, series, i)` (`:430`) and `rhs_val` from a ref or numeric threshold (`:431`); supported `fn` set is `>`, `<`, `>=`, `<=`, `crosses_above`, `crosses_below` (`:436-459`). So a traced sibling can emit `{lhs_value, threshold, fn, state, distance_to_threshold}` per leaf from the same `_resolve_term` values.
- Frozen conviction: `conviction = 1.0 if entry else 0.0` at `:165` — must stay frozen for the backtest/live hot path (design.md § 2; insights.md 2026-07-08).

**TDD**: `red-green required`.

**Instructions**:
1. Add `evaluate_conditions_traced(self, definition, bars, symbol, signals_map=None)` **beside**
   `evaluate_with_series` (do NOT change `evaluate`, `evaluate_with_series`, or `_eval_condition`'s bool
   contract — the live loop `app/engine/live_loop.py` and list-mocking tests depend on them). Reuse
   `_compute_component`/`component_series` assembly, then walk the parsed `entry_rule` leaves at the last
   bar and, for each leaf, emit a `ConditionEval`-shaped dict: `lhs_value = _resolve_term(lhs,…)`,
   `threshold = _resolve_term(rhs,…) or float(rhs)`, `fn`, `state` ∈ {PASS, SOFT, FAIL} and
   `distance_to_threshold` (normalized). Define the **PASS/SOFT/FAIL rule and the conviction ordinal in
   one pure helper** so the formula is pinned and unit-testable (design.md Open Risk "Conviction/readiness
   formula", C-01): `conviction = passing_leaves / total_leaves` combined with a normalized
   worst-distance; SOFT = within a configurable soft-band of the threshold but not passing.
2. Conviction is a **deterministic ordinal, not a probability** — the UI renders "N/M conditions" +
   strength bars, never a fabricated %.

**Verification**: covered by Step 4 (red-green). Lint: `cd services/xstockstrat-analysis && ruff check . && ruff format --check .`

---

### Step 4 — test: analysis evaluator trace + conviction ordinal

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_evaluator_traced.py` — create

**Reviewers**: `xstockstrat-analysis` (service owner)

**Codebase Evidence**:
- Test home: `services/xstockstrat-analysis/tests/` (pytest, `--cov=app --cov-fail-under=40`); Python fixtures home is `tests/conftest.py` (C-13). A single-consumer inline strategy-definition literal is compliant inline; a second consumer forces it into `conftest.py`.
- Existing determinism-test precedent: `tests/test_analysis_servicer.py` `_canonical`/teeth-test pattern (insights.md 2026-07-27).

**TDD**: `red-green required`.

**Instructions**:
Write cases (fail against the pre-Step-3 tree): (a) each supported `fn` (`>`,`<`,`>=`,`<=`,
`crosses_above`,`crosses_below`) emits correct `lhs_value`/`threshold`/`state`; (b) a passing/soft/fail
mix yields the exact ordinal `passing/total`; (c) a **teeth** companion asserting the conviction actually
moves when a leaf flips (guard against an inert formula, insights.md 2026-07-27). Reuse an inline
definition literal (single consumer → inline is compliant; state that verdict).

**Verification**:
`cd services/xstockstrat-analysis && pytest tests/test_evaluator_traced.py -q` (red before Step 3, green
after) and `pytest --cov=app --cov-fail-under=40` and `ruff check . && ruff format --check .`.

---

### Step 5 — service: analysis `EvaluateReadiness` RPC

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` (service owner)

**Codebase Evidence**:
- Servicer entrypoint `app/handlers/servicer.py:94` (Phase-0b recon); C-03 propagation pattern at `servicer.py:222` (recon: "any new request-scoped readiness RPC must add the C-03 tuple"); `evaluate_conditions_traced` from Step 3.
- Existing outbound edges reused: `analysis→indicators` (`ComputeIndicator`, `evaluator.py:183`), `analysis→marketdata` (`GetBars`, `servicer.py:357` per recon) — no new edge for readiness.

**TDD**: `red-green required`.

**Instructions**:
Implement `EvaluateReadiness(request, context)` — load the `StrategyDefinition` (existing `GetStrategy`
path), fetch bars per symbol (existing marketdata edge), call `evaluate_conditions_traced` per symbol,
map to `SymbolReadiness`/`ConditionEval`. Propagate `x-user-id`/`x-access-scope`/`x-trace-id` on the
indicators/marketdata calls via the existing per-method `metadata` pattern (`servicer.py:222`,
`docs/patterns/header-propagation.md` Python section).

**Verification**: covered by Step 6. Lint: `ruff check . && ruff format --check .`.

---

### Step 6 — test: analysis `EvaluateReadiness`

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify (add `EvaluateReadiness` cases)

**Reviewers**: `xstockstrat-analysis` (service owner)

**Codebase Evidence**: existing servicer test suite `tests/test_analysis_servicer.py`; indicators/marketdata stubs already mocked there.

**TDD**: `red-green required`.

**Instructions**: Cases (red first): a firing symbol returns PASS conditions + high ordinal; an N-away
symbol returns SOFT/FAIL + `distance_to_threshold`; assert the three headers reach the mocked
indicators/marketdata stubs (C-03).

**Verification**: `cd services/xstockstrat-analysis && pytest tests/test_analysis_servicer.py -k EvaluateReadiness -q` (red→green) and `pytest --cov=app --cov-fail-under=40` and `ruff check . && ruff format --check .`.

---

### Step 7 — service: analysis `ListOpportunities` RPC (queue aggregation)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` (service owner) — opportunity-queue aggregation correctness

**Codebase Evidence**:
- Inputs analysis already terminates: ingest `QuerySignals` (`ingest.proto:120-131`; `ExternalSignal.direction` `:108`); portfolio `ListPositions` — `ListPositions(user_id)` with `account_id` **unset** + `TradingMode UNSPECIFIED` returns all held positions across accounts/modes (`portfolio.proto:105-114`, mode filter `:93,:108`); the traced conviction from Step 5. Analysis already dials ingest + portfolio (analysis `CLAUDE.md` Dependencies) — **zero new edges** for the queue.
- Action-tag derivation from real data only (design.md § 1): `buy & !held → ENTER`, `buy & held → ADD`, `sell & held → REDUCE`. TRIM/EXIT collapsed to `REDUCE`.
- Ranking/dedup is **compute-on-read** — no ranking table, no migration.

**TDD**: `red-green required`.

**Instructions**:
Implement `ListOpportunities(request, context)`: read `x-user-id` from context metadata; fan out to
`QuerySignals` (active window) + `ListPositions(user_id, page)` (drain pages via `PageRequest`) +
`EvaluateReadiness`/traced conviction; join per symbol; derive `OpportunityActionTag` from
`direction × held`; rank by conviction; filter by `request.min_conviction`; paginate. Propagate the three
headers on every outbound call (existing per-method `metadata`).

**Verification**: covered by Step 8. Lint: `ruff check . && ruff format --check .`.

---

### Step 8 — test: analysis `ListOpportunities`

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` (service owner)

**Codebase Evidence**: mocked ingest/portfolio stubs in the existing suite.

**TDD**: `red-green required`.

**Instructions**: Cases (red first): `buy`+not-held → `ENTER`; `buy`+held → `ADD`; `sell`+held → `REDUCE`;
ranking order by conviction; `min_conviction` filter drops low rows; multi-page `ListPositions` drain
covers all held symbols (guards the single-page trap, insights.md 2026-07-27); assert the three headers
propagate.

**Verification**: `cd services/xstockstrat-analysis && pytest tests/test_analysis_servicer.py -k ListOpportunities -q` (red→green) and `pytest --cov=app --cov-fail-under=40` and `ruff check . && ruff format --check .`.

---

### Step 9 — migration: ingest 008 — signal-source health columns

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/migrations/008_signal_source_health.up.sql` — create
- `services/xstockstrat-ingest/migrations/008_signal_source_health.down.sql` — create

**Reviewers**: DBA — NNN numbering (no gap/conflict), up+down pair, index correctness; `xstockstrat-ingest` (service owner) — signal-source schema stability

**Codebase Evidence**:
- Last ingest migration is `007_signal_source_type_mediated` → next is **008** (confirmed via `ls services/xstockstrat-ingest/migrations/`); table `ingest.signal_sources` created in `002_add_signal_sources_registry.up.sql` (recon Phase-0b) with `created_at` only, no health fields.
- Migration naming `NNN_description.up.sql` + `.down.sql`, never edit an applied one (C-07, F-01).

**TDD**: `N/A (migration)` — proven by Step 11.

**Instructions**: `ALTER TABLE ingest.signal_sources ADD COLUMN IF NOT EXISTS health TEXT NOT NULL
DEFAULT 'unspecified', ADD COLUMN last_seen_at TIMESTAMPTZ, ADD COLUMN last_error TEXT, ADD COLUMN
signals_fed BIGINT NOT NULL DEFAULT 0;`. `.down.sql` drops the four columns. Mirror the additive style of
`006`/`007`.

**Verification**: `./scripts/db-migrate.sh` applies 008 with no error; `.down.sql` reverses cleanly on a scratch DB.

---

### Step 10 — service: ingest source-health population + `ListSignalSources` enrichment

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify
- `services/xstockstrat-ingest/app/repositories/` — modify (signal-sources repo)

**Reviewers**: `xstockstrat-ingest` (service owner) — signal normalization/idempotency, source schema stability

**Codebase Evidence**:
- Servicer `app/handlers/servicer.py:113` (9 RPCs, Phase-0b recon); `QuerySignals` at `:743` orders `ingested_at DESC` (`:807`); C-03 propagation at `servicer.py:150-156`.
- `SignalSource` proto now carries `health`/`last_seen_at`/`last_error`/`signals_fed` (Step 1). "Strategies that read this source" is a reverse index over `StrategyDefinition.signal_params` (design.md § 6) — surfaced by the UI, not necessarily a proto field.

**TDD**: `red-green required`.

**Instructions**: Populate the new columns — derive `health` from freshness (`last_seen_at` vs a
staleness threshold → LIVE/STALE/DOWN), update `last_seen_at`/`signals_fed` on `IngestSignal`, record
`last_error`. Return the enriched `SignalSource` from `ListSignalSources`. Keep `IngestSignal` idempotency
behavior unchanged (analysis owns the dedup guard — ingest `CLAUDE.md`).

**Verification**: covered by Step 11. Lint: `ruff check . && ruff format --check .`.

---

### Step 11 — test: ingest source-health

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/` — create/modify a source-health test

**Reviewers**: `xstockstrat-ingest` (service owner)

**Codebase Evidence**: pytest suite under `services/xstockstrat-ingest/tests/`; `--cov=app --cov-fail-under=40`.

**TDD**: `red-green required`.

**Instructions**: Cases (red first): a fresh `IngestSignal` sets `health=LIVE` + bumps `signals_fed`; an
aged `last_seen_at` maps to STALE/DOWN; `ListSignalSources` returns the enriched fields.

**Verification**: `cd services/xstockstrat-ingest && pytest -k source_health -q` (red→green) and `pytest --cov=app --cov-fail-under=40` and `ruff check . && ruff format --check .`.

---

### Step 12 — service: portfolio Position risk/factor fields + ledger-event stop learning

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify
- `services/xstockstrat-portfolio/internal/repository/portfolio_repo.go` — modify (scan the risk fields onto Position; no schema change)

**Reviewers**: `xstockstrat-portfolio` (service owner) — P&L/valuation accuracy, concurrent write safety

**Codebase Evidence**:
- `Position` risk fields (`stop_price`/`risk_at_stop`/`stop_distance_pct`/`factor`/`flag`/`exit_rule`) added in Step 1 (fields 14–19).
- Portfolio consumes ledger events via `ConsumeOrderFills` / `ConsumePositionSyncs` / `ConsumeBalanceSyncs` (`cmd/server/main.go:63-65`) — resting-stop price is learned by **extending `ConsumeOrderFills`** to read trading's order-event `stop_price` (trading→portfolio edge already exists; a reverse `portfolio→trading` edge would create a cycle — design.md § 4, insights.md 2026-07-31). **Store the learned stop in-memory** (rebuilt from ledger replay at boot, mirroring the existing position-state-from-events pattern) → **no portfolio migration**.
- C-10(b) valuation seam is HEALED: `ListPositions`/`ListPortfolios` share `positionColumns`/`scanPositionRow` (`portfolio_repo.go:225,114-118`); `current_price` is broker-authoritative. Stop-distance `= (current_price − stop_price) / current_price` off that same `current_price` (design.md § 4).
- **Factor grouping REQUIRES the config key** — marketdata exposes **no `sector`**: the `Fundamentals` proto message has fields 1–17 with no `sector` (`marketdata.proto` `message Fundamentals`), and the screener whitelist `_FUNDAMENTAL_FIELDS` (`screener.py:32`) has no sector either. So the design's "reuse portfolio→marketdata sector" path is unavailable; factor comes from `portfolio.exposure.factor_map` (Step 13). This resolves design.md Open Risk "Factor source unverified" decisively.
- Go propagation interceptor `internal/middleware/propagation.go:27` (C-03) — reuse for any new outbound call.

**TDD**: `red-green required`.

**Instructions**: (1) Compute `risk_at_stop`, `stop_distance_pct` on read from the learned `stop_price` +
broker `current_price`; derive `flag` (`STOP_NEAR` when stop-distance within a threshold; `ADD_SIGNAL`/
`REDUCE_SIGNAL` from held-vs-signal cross-ref where available). (2) Extend `ConsumeOrderFills` to capture
`stop_price` from the order event into an in-memory per-(user,symbol,mode) map, hydrated at boot from a
ledger `QueryEvents` replay. (3) Map `factor` via the `portfolio.exposure.factor_map` config value
(Step 13) keyed by symbol; empty → `""` (UI groups as "Unclassified"). No new DB pool, no migration
(F-06 held).

**Verification**: covered by Step 14. Lint: `cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod`.

---

### Step 13 — config: `portfolio.exposure.factor_map`

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/config/config.go` — modify (register the key + default)
- `services/xstockstrat-portfolio/CLAUDE.md` — modify (Config Keys Consumed table)
- `docs/patterns/config-governance.md` — modify (Per-Feature Registered Keys log)

**Reviewers**: `xstockstrat-portfolio` (service owner) + `xstockstrat-config` (config team) — key naming `<service>.<category>.<key>`, WatchConfig read at startup

**Codebase Evidence**:
- Config read pattern: portfolio `internal/config/config.go:60` (`config.Watcher`, recon Phase-0b). Naming `<service>.<category>.<key>` (C-05); defaults declared in the service CLAUDE.md; read via `WatchConfig` (F-07 — env-overridable/config-served, never a bare source literal).
- Key is REQUIRED (not conditional) because marketdata has no `sector` (Step 12 evidence). This is the design.md Open Risk resolution.

**TDD**: `N/A (config)`.

**Instructions**: Register `portfolio.exposure.factor_map` (type: JSON string; default `"{}"`) read via
the existing `config.Watcher`; document it in `services/xstockstrat-portfolio/CLAUDE.md` Config Keys and
in the `docs/patterns/config-governance.md` Per-Feature Registered Keys log (feature 083). Follow
`docs/runbooks/config-rollout.md` for the rollout note.

**Verification**: `grep -n "portfolio.exposure.factor_map" services/xstockstrat-portfolio/internal/config/config.go services/xstockstrat-portfolio/CLAUDE.md docs/patterns/config-governance.md` — present in all three; no bare-literal factor map in source (F-07).

---

### Step 14 — test: portfolio risk/factor + stop-distance

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service_test.go` — create/modify
- `services/xstockstrat-portfolio/internal/testdata/` — only if a Position literal gains a second consumer (C-13)

**Reviewers**: `xstockstrat-portfolio` (service owner)

**Codebase Evidence**: Go test home + `internal/testdata/` (C-13; create only on a second consumer). Coverage excludes `service`/`repository` packages from the CI measure — note the excluded-package rule.

**TDD**: `red-green required`.

**Instructions**: Cases (red first): stop-distance = `(current_price − stop)/current_price` off the shared
broker `current_price`; `STOP_NEAR` flag fires within threshold; a ledger order-event feeds the in-memory
stop map and survives a boot-replay; empty factor map → `factor=""`. If risk logic lands in a
CI-excluded package (`service`/`repository`), note "New logic is in an excluded package — integration/unit
test verification is sufficient; no coverage threshold applies" and still ship the test.

**Verification**: `cd services/xstockstrat-portfolio && GOWORK=off go test ./... -race -count=1` (red→green) and the Go coverage command from `reference/spec-template.md` (confirm ≥40% on measured packages) and `GOWORK=off golangci-lint run --modules-download-mode=mod`.

---

### Step 15 — service: analysis `GetStrategyAnalytics` (+ new `analysis→trading` edge)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/app/main.py` — modify (dial trading; new stub)
- `docker-compose.yml` — modify (add `TRADING_ENDPOINT` + `WAIT_FOR` to the analysis block)
- `.do/app.dev.yaml` — modify (add `TRADING_ENDPOINT` to the analysis component `envs`)
- `.do/app.yaml` — modify (add `TRADING_ENDPOINT` to the analysis component `envs`)

**Reviewers**: `xstockstrat-analysis` (service owner) — per-strategy analytics; Platform Lead — new inter-service edge in the dependency graph

**Codebase Evidence**:
- **Expectancy is derivable from summary metrics — no per-trade column, no analysis migration:** `analysis.backtest_runs` (migration 006) stores `win_rate` and `profit_factor`; payoff-ratio `= profit_factor·(1−win_rate)/win_rate` and `expectancy = win_rate·payoff − (1−win_rate)` (in avg-loss units) — both from stored columns. This resolves design.md Open Risk "Expectancy source" toward **no new schema**. `max_drawdown` is also a `backtest_runs` column.
- `signals_30d` from ingest `QuerySignals` (existing edge); `taken` from a **new `analysis→trading ListOrders` edge** — non-cyclic (trading does not dial analysis); `Order.strategy_id = 15` (`trading.proto:47`), `ListOrders` (`:14`), `ListOrdersRequest.strategy_id = 2` (`:121`). `queue_share` from the Step 7 queue join.
- **Deployment audit — `TRADING_ENDPOINT` is ABSENT from the analysis block** in all three: `docker-compose.yml` analysis env has CONFIG/MARKETDATA/INDICATORS/INGEST/PORTFOLIO/LEDGER/NOTIFY only (no TRADING); the analysis component in `.do/app.yaml` / `.do/app.dev.yaml` lists CONFIG/LEDGER/NOTIFY/MARKETDATA/INDICATORS/INGEST/PORTFOLIO (no TRADING — the `TRADING_ENDPOINT@427` hit belongs to the `xstockstrat-ui` block). Convention: `TRADING_ENDPOINT=xstockstrat-trading:50051` (root `CLAUDE.md` env-var table; trading gRPC port 50051).
- C-03 propagation for the new outbound `ListOrders` call: existing per-method `metadata` pattern (`servicer.py:222`); `docs/patterns/header-propagation.md` Python section.

**TDD**: `red-green required`.

**Instructions**: (1) Dial trading in `main.py` from a new `TRADING_ENDPOINT` env var, build the stub.
(2) Implement `GetStrategyAnalytics` — expectancy/hit-rate/max-DD from `backtest_runs` (reuse the existing
`BacktestRunsRepository` read), `signals_30d` from `QuerySignals`, `taken` from `ListOrders(strategy_id)`,
`queue_share` from the queue join; propagate the three headers on the new `ListOrders` call. (3) Add
`TRADING_ENDPOINT: xstockstrat-trading:50051` to the analysis block in `docker-compose.yml` (+ trading in
`WAIT_FOR` for boot order) and `- key: TRADING_ENDPOINT` / `value: ${xstockstrat-trading.PRIVATE_DOMAIN}:50051`
to the analysis component `envs` in both `.do` specs.

**Verification**: covered by Step 16, plus `grep -n "TRADING_ENDPOINT" docker-compose.yml .do/app.dev.yaml .do/app.yaml` shows it in the analysis block in all three. Lint: `ruff check . && ruff format --check .`.

---

### Step 16 — test: analysis `GetStrategyAnalytics`

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` (service owner)

**Codebase Evidence**: existing suite; mock the new trading `ListOrders` stub alongside the ingest stub.

**TDD**: `red-green required`.

**Instructions**: Cases (red first): expectancy matches the closed-form from a known `win_rate`+
`profit_factor` row; `taken` reads the mocked `ListOrders(strategy_id)`; assert the three headers reach the
trading stub (C-03 on the new edge).

**Verification**: `cd services/xstockstrat-analysis && pytest tests/test_analysis_servicer.py -k GetStrategyAnalytics -q` (red→green) and `pytest --cov=app --cov-fail-under=40` and `ruff check . && ruff format --check .`.

---

### Step 17 — service: analysis `ScreenResult` enrichment (raw pe/rsi/atr/rev_growth/held)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/services/screener.py` — modify
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify (`ScreenSymbols` assembly)

**Reviewers**: `xstockstrat-analysis` (service owner) — screener enrichment, no look-ahead

**Codebase Evidence**:
- `ScreenResult` raw fields 7–11 added in Step 1; `ScreenSymbols` at `servicer.py:1727` (recon Phase-0b).
- `_FUNDAMENTAL_FIELDS` whitelist at `screener.py:32` has `pe_ratio` but **not** `rsi`/`atr`/`rev_growth`. `pe` → the existing marketdata fundamentals cache (`Fundamentals.pe_ratio`). `rsi`/`atr` → the existing `analysis→indicators` edge; **ATR/VWAP are close-only approximations** (`indicators_engine.py:103,112`) — surface as a known accuracy caveat, not exact (design.md § 5). `rev_growth` → **best-effort from `Fundamentals.extra_metrics`** (the FMP open-ended `map<string,double>` at `marketdata.proto` field 13); absent for symbols FMP does not report it → `0` with the same caveat. `held` → cross-ref the caller's positions.

**TDD**: `red-green required`.

**Instructions**: Populate the five raw fields on each `ScreenResult`: `pe` from cached fundamentals,
`rsi`/`atr` via `ComputeIndicator` (note the close-only ATR caveat inline), `rev_growth` from
`extra_metrics` (best-effort), `held` from the held-position cross-ref. Widen the relevant whitelist only
where a raw column is legitimately a fundamental; keep the blended `criterion_scores` behavior unchanged.

**Verification**: covered by Step 18. Lint: `ruff check . && ruff format --check .`.

---

### Step 18 — test: analysis screener enrichment

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/` — modify the screener test

**Reviewers**: `xstockstrat-analysis` (service owner)

**TDD**: `red-green required`.

**Instructions**: Cases (red first): `pe` reflects the cached fundamental; `rsi`/`atr` come from the mocked
indicator; `rev_growth` present when `extra_metrics` carries it and `0` when absent; `held` true for a held
symbol. Assert the blended `criterion_scores`/`passed` behavior is unchanged (no regression).

**Verification**: `cd services/xstockstrat-analysis && pytest -k screen -q` (red→green) and `pytest --cov=app --cov-fail-under=40` and `ruff check . && ruff format --check .`.

---

### Step 19 — service: UI Nocturne token remap (two-file, additive Phosphor)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/globals.css` — modify
- `services/xstockstrat-ui/tailwind.config.js` — modify
- `services/xstockstrat-ui/package.json` — modify (add `@phosphor-icons/react`)

**Reviewers**: `xstockstrat-ui` (service owner) — Nocturne fidelity, no parallel token system

**Codebase Evidence**:
- Tokens live inline in exactly two files (no token module): `globals.css:6-27` (single dark `:root`, HSL triplets) + `tailwind.config.js:40-42` (`buy`/`sell`/`paper`/accent) — recon Patterns to REUSE. App is **already dark-only** (no `.dark`/toggle/next-themes) — a two-file value remap, not a new system.
- Nocturne mapping: gain `#4cc79c`→`buy`, loss `#e0787a`→`sell`, paper `#c9b47e`→`paper`, blurple `#9184d9`→accent, `#161826`→`--background`. Add a mono `fontFamily` + `tabular-nums`. Icons are `lucide-react ^0.460.0` (`package.json:45`) — add Phosphor **additively**, retire lucide per-screen (no big-bang) — design.md § Frontend.

**TDD**: `N/A (styling)` — validated by the Step 21 nav test rendering + Step 26 per-screen e2e.

**Instructions**: Remap the `:root` variables in `globals.css:6-27` and the `buy`/`sell`/`paper`/accent
tokens + `--background` in `tailwind.config.js:40-42` to the Nocturne values; add a mono `fontFamily`
(numbers/tickers/IDs/thresholds/timestamps render mono + `tabular-nums`, FR-3); add
`@phosphor-icons/react`. Do not introduce a parallel token file.

**Verification**: `cd services/xstockstrat-ui && pnpm lint && pnpm build` — compiles; visually confirm the accent/gain/loss/paper roles resolve to Nocturne values.

---

### Step 20 — service: UI Decide/Discover/Engine/Book shell + nav regroup + pinned `accounts` surface

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx` — modify (nav grouping, badges, breadcrumb)
- `services/xstockstrat-ui/src/components/ui/` — create missing primitives as needed (Dialog/Tabs/Tooltip/Slider/Skeleton/Chip)
- `services/xstockstrat-ui/src/app/**` — modify layouts for the 212px sidebar / 49px top bar / content region

**Reviewers**: `xstockstrat-ui` (service owner) — nav reachability, shell correctness

**Codebase Evidence**:
- `PLATFORM_NAV` at `PlatformHeader.tsx:44-64` (4 items), `PLATFORM_SUBNAV` at `:79-101` (per-segment submodule lists), `accounts` segment already carries `authorized-apps` + `mcp-tools` (`:97-100`), active-item logic `isItemActive` at `:103-106`. **No badge/count rendering exists today** — add it (FR-1). Physical routes stay `/trader|/insights|/config-ui|/accounts`; Decide/Discover/Engine/Book is a **presentation grouping**, breadcrumb driven by the grouping (design.md § Frontend; new Decide routes live under `/insights`).
- Existing `components/ui/`: `badge, button, card, combobox, input, select, separator, sheet, table, utils(cn)`; `@radix-ui/react-dialog` already a dep (used in `sheet.tsx`) — recon.
- Middleware matcher is global negative-lookahead (`middleware.ts:10-15`) — any new top-level route inherits protection automatically (recon); no matcher change needed for the presentation regroup.

**TDD**: `N/A (shell)` — proven by Step 21.

**Instructions**: Rebuild the shell chrome (212px sidebar with Decide/Discover/Engine/Book sections +
per-item count badges + 3px accent active-mark; 49px sticky top bar with `Module / Page` breadcrumb,
account switcher, PAPER/LIVE tag from `AccountContext`/`TradingModeBadge`, Copilot toggle; sidebar footer
"Mobile companion →" + "Signal engine live" card). Regroup `PLATFORM_SUBNAV` under the four tabs; keep
`accounts` (`authorized-apps` + `mcp-tools`) reachable from the pinned top-bar account/settings surface.
Build only the `components/ui/*` primitives the shell needs.

**Verification**: `cd services/xstockstrat-ui && pnpm lint && pnpm build`; Step 21 asserts reachability.

---

### Step 21 — test: UI nav-reachability e2e (C-10(a), every screen incl. `accounts`)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/nav-reachability.spec.ts` — create

**Reviewers**: `xstockstrat-ui` (service owner)

**Codebase Evidence**:
- **No central nav-reachability spec exists today** (recon; SSR warmup list `e2e/warmup.setup.ts:14` even omits `/trader/positions`) — this closes the fails.md 2026-07-01 060 / C-10(a) trap.
- Auth helpers: `e2e/helpers/auth.ts` (`addAuthCookie`, `addAdminCookie`, `addCookieWithRoles`) — never re-implement JWT signing (C-12; INVENTORY.md auth row).

**TDD**: `red-green required` (asserts new-shell reachability; fails against the pre-Step-20 nav).

**Instructions**: For every screen — Opportunities, Signal detail, Watchlists, Screener, Strategies,
Backtest, Signal sources, Backfills, Exposure, Portfolio, Orders, **and** the `accounts`
`authorized-apps` + `mcp-tools` surfaces — assert it is reachable by walking the actually-rendered shell
from the sidebar/top-bar (not by direct-URL), and that the breadcrumb reflects the active screen. Use
`e2e/helpers/auth.ts` cookies; admin-only surfaces use `addAdminCookie`.

**Verification**: `cd services/xstockstrat-ui && pnpm test:e2e -- nav-reachability` — all screens reachable; breadcrumb assertions pass.

---

### Step 22 — service: UI Decide screens — Opportunities queue + Signal detail

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/**` — create Opportunities + Signal-detail routes (under `/insights`, per design)
- `services/xstockstrat-ui/src/lib/insightsBff.ts` + `src/lib/browserClients/*` — modify (wire `ListOpportunities`/`EvaluateReadiness`)
- `services/xstockstrat-ui/e2e/fixtures/opportunities.ts` — create (C-12 fixture + INVENTORY row)
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify

**Reviewers**: `xstockstrat-ui` (service owner) — Connect-RPC call safety, display accuracy

**Codebase Evidence**:
- BFF pattern: register `router.service(...)` in the segment router then dispatch (`src/lib/insightsBff.ts`, UI `CLAUDE.md` Auth+BFF); browser clients in `src/lib/browserClients/*` bound to `/insights/api`.
- Enum render maps from Step 2 (`src/lib/opportunityShared.tsx`); candlestick reuse `useCandlestickChart.ts:12` + `ChartPanel.tsx` (recon); FR-6 order ticket is a re-presentation of `OrderForm.tsx` (FR-20, execution unchanged).
- C-12: no fixture exists for `Opportunity`/`SymbolReadiness` (INVENTORY.md has no such row) → **new fixture module required** in `e2e/fixtures/` + catalog row (shape = Connect-JSON camelCase of the Step-1 messages).

**TDD**: `N/A (frontend service)` — e2e covered in Step 26.

**Instructions**: Build the Opportunities home queue (5-stat row, source-filter chips, min-conviction
slider, sort, ranked rows with action tag via `opportunityShared` maps, sparkline, expiry, Review/Snooze)
consuming `ListOpportunities`; build Signal detail (candlestick + conditions from `EvaluateReadiness`
using `ConditionEval` state maps + strength bars; order ticket re-presenting `OrderForm.tsx`). Conviction
renders as "N/M conditions" + bars, never a fake %. Add `e2e/fixtures/opportunities.ts` + INVENTORY row.

**Verification**: `cd services/xstockstrat-ui && pnpm lint && pnpm build`; per-screen e2e in Step 26. Confirm fixture import: `grep -n "from .*fixtures" e2e/insights/*opportun*`.

---

### Step 23 — service: UI Discover screens — Watchlists + Screener

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/watchlists/**`, `src/app/insights/screener/**` — modify
- `services/xstockstrat-ui/e2e/fixtures/` — modify/extend (readiness + enriched screener rows)

**Reviewers**: `xstockstrat-ui` (service owner)

**Codebase Evidence**:
- Reuse `useWatchlists.ts:17` (full CRUD), `useScreenSymbols.ts:9`, `screener/page.tsx` (recon). Readiness bar/state + blocking condition come from `EvaluateReadiness` (Step 5); enriched `ScreenResult` raw columns (pe/rsi/atr/rev_growth/held) from Step 17.
- Existing screener mock is inline in `mock-backend.ts` (`screenSymbols`) — extend it for the new raw fields; a second consumer of a screener literal centralizes it (C-12 INVENTORY "not yet centralized" policy).

**TDD**: `N/A (frontend service)` — e2e in Step 26.

**Instructions**: Watchlists (left list with "N ready" accent, right symbols with readiness bar/state +
blocking condition + action; editor add-by-symbol); Screener (weighted criteria rail, ranked results
table with the new raw columns, Save-as-watchlist / Run-scan). Note the close-only ATR caveat in any ATR
column tooltip.

**Verification**: `pnpm lint && pnpm build`; e2e in Step 26.

---

### Step 24 — service: UI Engine screens — Strategies + Backtest + Signal sources + Backfills

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/{strategies,backfills}/**`, signal-sources + backtest views — modify
- `services/xstockstrat-ui/e2e/fixtures/` — modify (StrategyAnalytics, source-health fixtures + INVENTORY rows)

**Reviewers**: `xstockstrat-ui` (service owner)

**Codebase Evidence**:
- Strategies: state renders **Active / Paused / Off** derived from `active`(field 7)/`live_enabled`(field 8) — never Live/Paper (AC-5; recon confirmed no "Live/Paper" string exists); no Universe field (correct). Per-strategy metrics from `GetStrategyAnalytics` (Step 15). Reuse `useStrategies.ts`/`useStrategyDefinitions.ts`.
- Backtest: reuse `BacktestDiagnostics.tsx` (`ACTION_LABEL: Record<BarAction,…>:9`, `NO_TRADE_MESSAGE: Record<NoTradeReason,…>:18`), `EquityCurveChart.tsx`, `useBacktest.ts`; coverage-gap notice + "Backfill this range →" reuse `strategies/[id]/page.tsx:290-334` + `e2e/fixtures/backtests.ts` `prefixGapRange:39-46` (the gap is the pre-window span, distinct from the requested range — insights.md 2026-07-27). **Backtest hot path frozen** (feature.md reviewers).
- Signal sources: consume the Step-10 health fields (`SourceHealthStatus` map from Step 2); "strategies that read this source" = reverse index over `StrategyDefinition.signal_params`.
- Backfills: reuse `useBackfills.ts` (4s poll `:29`, terminal-stop `:40-43`, cancel `:52`, delete `:65`), admin gate `useIsAdmin()` (`useLiveStrategies.ts:42`) + typed-`DELETE ALL` confirm `backfills/page.tsx:72,134-137`.

**TDD**: `N/A (frontend service)` — e2e in Step 26.

**Instructions**: Build all four Engine screens per FR-9/10/11/12, reusing the cited hooks/components.
Backfills stays admin-gated (create+delete panels only for admins; typed-symbol + "DELETE ALL" confirm;
4s poll to terminal). Add StrategyAnalytics + source-health fixtures + INVENTORY rows.

**Verification**: `pnpm lint && pnpm build`; e2e in Step 26.

---

### Step 25 — service: UI Book screens — Exposure + Portfolio + Orders

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/trader/**` (positions→Exposure reframe, orders) + Portfolio view — modify
- `services/xstockstrat-ui/e2e/fixtures/portfolios.ts` — reuse (`PORTFOLIO_ALPACA/IBKR/PORTFOLIOS`)

**Reviewers**: `xstockstrat-ui` (service owner)

**Codebase Evidence**:
- Exposure = risk reframe of `app/trader/positions/page.tsx`, consuming the Step-12 `Position` risk fields (risk_at_stop, stop_distance_pct, factor, flag); reuse `usePositions.ts:39`.
- Portfolio = read-only broker mirror; reuse `usePortfolio.ts` (`usePortfolios` 10s poll `:20-26`), `PortfolioPanel.tsx`, fixtures `PORTFOLIO_ALPACA/IBKR/PORTFOLIOS` (`e2e/fixtures/portfolios.ts:13-37`, INVENTORY row present). Footer states "xstockstrat never writes to the ledger" (AC-8, C-10(b)).
- Orders = re-presentation of `OrderBook.tsx`/`OrderFilters.tsx`; **FR-20 order parity** — reuse `orderShared.tsx:10` `STATUS_VARIANT` (7 statuses incl. `PARTIALLY_FILLED`/`FILLED`) + `:23` `TYPE_LABEL` (5 types MARKET/LIMIT/STOP/STOP_LIMIT/TRAILING_STOP); streamed fills via `useOrderUpdates.ts:20`. Execution semantics **unchanged**; confirmation surfaces behave identically under paper/live and carry the PAPER/LIVE tag.

**TDD**: `N/A (frontend service)` — parity tests in Step 26.

**Trading-domain constraints (step-constraints §A):** Order type coverage — all 5 `OrderType` values continue to render/submit via the reused `TYPE_LABEL` map (no type dropped/added). Fill state — both `PARTIALLY_FILLED` (rows show `filled < qty`) and `FILLED` render via the reused `STATUS_VARIANT` map. Trading-mode gate — this is display-only re-presentation; no order-submission gate changes (FR-20).

**Instructions**: Build Exposure (4-stat risk row + table with stop-distance bar, factor, flag, "N exit
flags in queue →"), Portfolio (read-only mirror, 5-stat, two account cards, positions table, 10s-poll
footer), Orders (filterable table with status/type via `orderShared` maps, origin strategy-or-Manual,
Why? trace). Reuse `portfolios.ts` fixtures; no new order/position fixture unless a second consumer forces
centralization of the inline `mock-backend.ts` order/position mocks.

**Verification**: `pnpm lint && pnpm build`; FR-20 + AC-8 tests in Step 26.

---

### Step 26 — test: UI per-screen e2e + FR-20 order parity + AC-8 valuation parity

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/*.spec.ts`, `e2e/trader/*.spec.ts` — create/modify (per-screen)
- `services/xstockstrat-ui/e2e/trader/order-parity.spec.ts` — create (FR-20)
- `services/xstockstrat-ui/e2e/trader/valuation-parity.spec.ts` — create (AC-8)
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (handlers for the new RPCs)

**Reviewers**: `xstockstrat-ui` (service owner)

**Codebase Evidence**:
- Playwright home `e2e/`, mock `mock-backend.ts`, fixtures + INVENTORY (C-12); a mock that echoes the request field back tests nothing — make distinguishing fields distinguishable (insights.md 2026-07-27).
- AC-8: valuation shown on Portfolio (Mkt value/Unrealized) and Exposure (Risk at stop/weight) must resolve to the **same broker-authoritative source per symbol** — assert against fixtures/mock-backend (producer agreement not verifiable from the UI; C-10(b) seam confirmed healed at `portfolio_repo.go:225`).
- FR-20: order surfaces (Orders table, Signal-detail ticket, order editor) all reuse `orderShared.tsx:10,23`.

**TDD**: `red-green required`.

**Instructions**: Per-screen specs against `screenshots/01–12` behavior; the FR-20 spec asserts all 5
order types render/submit and both partial+full fill states render across every order surface; the AC-8
spec asserts the same symbol's valuation is sourced identically on Portfolio and Exposure. Add
mock-backend handlers for `ListOpportunities`/`EvaluateReadiness`/`GetStrategyAnalytics`/enriched
`ScreenResult`/source-health/risk-`Position` using the new fixtures (distinguishable field values).

**Verification**: `cd services/xstockstrat-ui && pnpm lint && pnpm test:e2e` (all green) and `pnpm run test:coverage` (≥40% on exercised `src/lib/**`, feature-065 gate).

---

### Step 27 — service: UI Copilot shallow-beta rail (ledger append-store thread + client-side summary)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/**` — create the 310px Copilot rail
- `services/xstockstrat-ui/src/lib/insightsBff.ts` + `src/lib/browserClients/*` — modify (wire ledger `AppendEvent`/`QueryEvents`)
- `services/xstockstrat-ui/e2e/` — modify (rail e2e + thread fixture)

**Reviewers**: `xstockstrat-ui` (service owner); `xstockstrat-ledger` (owner, FYI) — append-store usage

**Codebase Evidence**:
- **No new agent tool, no agent DB, no LLM, no new pool (F-06 held).** Thread persistence uses the ledger append-only store: `AppendEvent` (`ledger.proto:14,33`) with `stream_key = "copilot:{user_id}:{thread_id}"` (`:37`), `event_type = "copilot.message"`, `payload = Struct{role,text}` (`:38`), `idempotency_key` (`:45`); replay via `QueryEvents(stream_key)` (`:15,54`); `sequence` monotonic per stream (`:29`). Ledger is UNCHANGED (existing RPCs). insights.md 2026-07-31 (083 design) — the append-only precondition holds: **no message edit/delete/clear-history** in the UX.
- "Read of the queue" + concentration-flag = **client-side templated summaries** over the already-fetched `ListOpportunities` + position weights — no LLM (design.md § 3).
- The input renders in a **beta/read-only** state — it does NOT perform a live authenticated MCP tool call in 083 (deferred feature). Footer: "MCP · N tools · read-only unless you confirm". Default off (FR-4, FR-19 `showCopilot`).

**TDD**: `N/A (frontend service)` — rail e2e folded here + Step 26 pattern.

**Instructions**: Build the rail (toggle from the top bar with accent-filled active state; "Read of the
queue" + concentration-flag cards computed client-side; "asked earlier" thread replayed from the ledger
via `QueryEvents`; sticky input persists the user's own notes via `AppendEvent`, append-only, beta/
read-only — no live tool call). Default off via `ChromeContext`/`showCopilot`.

**Verification**: `pnpm lint && pnpm build && pnpm test:e2e -- copilot` — rail opens/closes, defaults off, thread persists+replays, footer states "read-only unless you confirm", no edit/delete affordance.

---

### Step 28 — service: UI mobile companion (shared section renderer, ≥44px)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/**` — create the mobile section renderer + bottom tab bar
- `services/xstockstrat-ui/e2e/` — modify (mobile e2e)

**Reviewers**: `xstockstrat-ui` (service owner)

**Codebase Evidence**: FR-16 — one shared section renderer (section kinds `stat`/`signal`/`chart`/`row`/
`form`/`note`/`action`/`head`) across the same responsive routes; fixed bottom tab bar
(Decide/Discover/Engine/Book); all tap targets ≥ 44px. Full parity (11 phone frames), not a subset.

**TDD**: `N/A (frontend service)` — e2e folded in Step 30.

**Instructions**: Implement the shared section renderer driving a 1:1 mobile view of every desktop screen,
a fixed bottom tab bar, ≥44px tap targets. Same routes/screens in a responsive shell — full parity.

**Verification**: `pnpm lint && pnpm build`; mobile e2e in Step 30.

---

### Step 29 — service: UI non-happy-path states (loading / empty / error + destructive-confirm)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/**`, `src/components/**` — modify (skeletons, empty copy, per-card error)

**Reviewers**: `xstockstrat-ui` (service owner)

**Codebase Evidence**: FR-17/18 — every data screen: loading (skeleton per card/table), empty ("No backfill
jobs match the filter", "No portfolio data", "No equity curve data for this run"), per-card error; the
Backfills delete panel keeps destructive-confirm gating (`backfills/page.tsx:72,134-137`). Polling cadence:
portfolio/positions 10s (`usePortfolio.ts:20-26`), backfill jobs 4s while non-terminal (`useBackfills.ts:29,40-43`), orders stream (`useOrderUpdates.ts:20`).

**TDD**: `N/A (frontend service)` — e2e in Step 30.

**Instructions**: Add loading/empty/error states to every data screen using the `Skeleton` primitive;
preserve the Backfills destructive-confirm gates; reflect the real poll/stream cadence in stale/loading UI.

**Verification**: `pnpm lint && pnpm build`; states e2e in Step 30.

---

### Step 30 — test: UI mobile + non-happy-state e2e + full-suite/coverage gate

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/**` — create mobile + state specs

**Reviewers**: `xstockstrat-ui` (service owner)

**Codebase Evidence**: Playwright `e2e/` + fixtures/auth helpers (C-12); vitest coverage gate `src/lib/**`, `all:false`, 40% (`vitest.config.ts`, feature 065).

**TDD**: `red-green required`.

**Instructions**: Specs (red first): mobile renders 1:1 per desktop screen with the bottom tab bar and
≥44px targets; each data screen shows skeleton→data, empty copy on no-data, per-card error on RPC failure;
the Backfills delete panel enforces typed-symbol + "DELETE ALL". Reuse fixtures/auth helpers.

**Verification**: `cd services/xstockstrat-ui && pnpm lint && pnpm build && pnpm test:e2e && pnpm run test:coverage` — full suite green, coverage ≥ threshold (AC-11).

---

### Step 31 — docs: reconcile CLAUDE.md surfaces + registered keys + context-scrubber teardown

**Status**: `pending`
**Service**: `docs/` + service CLAUDE.md files
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify (new RPCs `ListOpportunities`/`EvaluateReadiness`/`GetStrategyAnalytics`; new `analysis→trading` dependency edge + `TRADING_ENDPOINT`; screener enrichment)
- `services/xstockstrat-portfolio/CLAUDE.md` — modify (Position risk/factor fields; ledger order-event stop consumer; `portfolio.exposure.factor_map` — done in Step 13, verify)
- `services/xstockstrat-ingest/CLAUDE.md` — modify (source-health fields + migration 008)
- `services/xstockstrat-ui/CLAUDE.md` — modify (new Decide screens, four-tab nav grouping, Copilot rail beta, `opportunityShared` maps)
- `docs/patterns/header-propagation.md` — modify (record the new `analysis→trading` request-scoped edge)
- `docs/patterns/config-governance.md` — verify the Per-Feature Registered Keys log row for `portfolio.exposure.factor_map` (Step 13)

**Reviewers**: none (docs)

**Codebase Evidence**:
- Root `CLAUDE.md` Teardown rule: run `/context-scrubber scan` scoped to touched context files as the last step before pushing; fix grounded findings. If the context-forge plugin is unavailable, say so in the PR body.
- **strat-lab plugin NOT affected:** the plugin's `backtest` skill tracks `run_backtest`/`manage_strategy`/`trigger_backfill`/`get_backfill_status`/`set_strategy_live` (root `CLAUDE.md`); 083 changes **none** of those RPCs (new RPCs are `ListOpportunities`/`EvaluateReadiness`/`GetStrategyAnalytics`) — no plugin update required. State this in the PR body.

**TDD**: `N/A (docs)`.

**Instructions**: Update each service CLAUDE.md and the two pattern docs to match the shipped behavior;
confirm the config-governance registered-keys row exists. Run `/context-scrubber scan` scoped to the
files this feature touched and fix grounded findings.

**Verification**: `/context-scrubber scan` reports no grounded drift on the touched files; `grep -n "ListOpportunities\|EvaluateReadiness\|GetStrategyAnalytics" services/xstockstrat-analysis/CLAUDE.md` present.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
