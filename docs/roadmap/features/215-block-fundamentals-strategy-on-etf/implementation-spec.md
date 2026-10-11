# Implementation Spec: block-fundamentals-strategy-on-etf

**Status**: `in-progress`
**Created**: 2026-10-10
**Feature**: `docs/roadmap/features/215-block-fundamentals-strategy-on-etf/feature.md`
**Total Steps**: 26
**Feature Branch**: `feature/block-fundamentals-strategy-on-etf`

---

## Execution Summary

The work runs from the contract inward, then outward to the consumers:

1. **Contract (Steps 1–6).** The additive proto lands first and is regenerated. It immediately turns three descriptor-parity guards red: the analysis `Opportunity` mapper, the agent `Opportunity` projection, and the agent `SymbolDiagnostics` summary keys. So the row contract and repository (Steps 3–4) and the agent projections and docstrings (Steps 5–6) land straight after it.
2. **Marketdata (Steps 7–10).** Absence encoding (FR-7) comes before the guard, because the analysis snapshot loaders depend on NotFound / FailedPrecondition being distinct. Then the cache-only `GetEtfFlags` label (FR-11).
3. **Analysis core (Steps 11–22).**
   - The pure guard module and its shared evaluator helper (11–12).
   - The bounded PIT pager plus error-distinct loaders (13–14). Every guarded surface reads through these.
   - The four guarded surfaces, each with its paired test: backtest refusal (15–16), derivation-time evidence exclusion H (17–18), live deny-entry (19–20), and the opportunity skip row plus heal (21–22).
4. **Consumers and docs (Steps 23–26).** The UI surfaces (23–24), the docs, strat-lab skill and C-16 CHANGE texts (25), and the staging measurement plus real-ETF proof (26, fails.md 2026-08-13 / feature 129).

Every change follows `design.md` § Chosen Approach (A–J, H, Fixes 2–6, round-4 fixes 1–3 and the /sdd-spec notes). There is no migration and no new config key.

**Consumer surfaces (C-14).**
- Agent `run_backtest`, `list_opportunities` and `set_strategy_live`: Step 5 (projection + docstrings), Step 25 (`mcp-tools.md` + the strat-lab skill).
- UI `/insights` backtest result (`BacktestDiagnostics`), the Decide queue (desktop + mobile) and the `/trader/positions/[symbol]` Signal-detail: Step 23.

**Scenario Coverage (C-15)**

| Scenario | Covered by |
|---|---|
| @AC-1 | Step 12 |
| @AC-2 | Steps 6, 16, 24, 26 |
| @AC-3 | Steps 12, 16, 26 |
| @AC-4 | Steps 6, 22, 24, 26 |
| @AC-5 | Steps 16, 20, 22 |
| @AC-6 | Step 20 |
| @AC-7 | Step 8 |
| @AC-8 | Steps 8, 14, 16, 22 |
| @AC-9 | Steps 14, 20, 22 |
| @AC-10 | Steps 12, 16 |
| @AC-11 | Step 18 |
| @AC-12 | Steps 14, 16, 18, 20, 26 |
| @AC-13 | Steps 4, 22 |
| @AC-14 | Step 10 |
| @AC-15 | Steps 4, 24 |

## Step Dependencies

- **Before Step 1:** rebase `feature/block-fundamentals-strategy-on-etf` onto `origin/main-dev`.
  - Feature 196 (#1237, commit `80d44449`) is on main-dev but not on the branch. It edits `services/xstockstrat-marketdata/internal/service/marketdata_service.go`, adding lines at ~L331 and ~L698.
  - The `marketdata_service.go` line numbers below are **origin/main-dev** numbers (re-verified 2026-10-11 via `git show origin/main-dev:…`). They read 12 lower on the pre-rebase branch.
  - **Locate by symbol at execute time.** Every `marketdata_service.go` citation names its enclosing symbol (`GetFundamentalsMulti`, `getEdgarSnapshot`, `resolveFundamentals`, `fundamentalsEnabled`, `maybeAlertQuota`, `GetHistoricalFundamentals`, `enrichmentUnderCap`, `type MarketDataService struct`). Line numbers drift; the symbol is the anchor.
- **Step 2 requires Step 1.** Codegen consumes the edited `.proto` files.
- **Steps 3, 5, 9, 11, 13, 15, 17, 19, 21 and 23 require Step 2.** They use the generated stubs.
- **Steps 2–6 must merge together**, in one PR or back-to-back in sequential mode.
  - Step 2 adds proto fields, which turns three parity guards red until Steps 3 and 5 carry the fields:
    - `services/xstockstrat-analysis/tests/test_analysis_servicer.py:6066` (`test_mapper_covers_every_proto_field`)
    - `services/xstockstrat-agent/tests/test_opportunity_projection.py:52`
    - `services/xstockstrat-agent/tests/test_backtest_view.py:210`
  - Precedent: fails.md 2026-10-07 "fundamentals-formula-inputs — scope-creep".
- **Step 9 requires Step 7.** Both edit `marketdata_service.go`, and Step 9 reuses the `atQuotaAlertThreshold` helper that Step 7 extracts.
- **Step 13 requires Step 7.** The snapshot loaders' NotFound → absent / FailedPrecondition → DISABLED mapping is only meaningful once marketdata emits those codes.
- **Step 13 requires Step 11.** The loaders record `Availability` values from the guard module.
- **Steps 15, 17, 19 and 21 require Steps 11 and 13.** Every surface calls `fundamentals_guard.assess(...)` over the paged, failure-tracked loaders.
- **Step 17 requires Step 15.** The RunBacktest trigger change (`status == OK or fund_refusals > 0`) and the run-level `fund_cache`/`fund_failures` hand-off build on Step 15's counters.
- **Steps 15 and 21 require Step 9.** They call `GetEtfFlags` for the ETF/NOT_ETF label.
- **Step 21 requires Step 3.** It needs the `replace_symbols` COALESCE and the `"fundamentals_unavailable"` structural marker / floor exemption.
- **Step 23 requires Steps 2 and 3.** It needs the TS stubs for `FundamentalsGap`, `NoTradeReason.FUNDAMENTALS_UNAVAILABLE` and `ListOpportunitiesRequest.symbol`, plus the server-side filter.
- **Step 25 must ship in the same PR as Steps 5 and 15** — that is, the feature's integration PR into `main-dev`.
  - This is the strat-lab rule (`docs/patterns/strat-lab-plugin.md:16-18`): a `run_backtest` / `set_strategy_live` behavior change updates the skill in the same PR.
- **Step 26:**
  - Its pre-merge half (the >50-period count, design Open Risk 4) runs before the integration PR merges.
  - Its post-deploy half runs after the dev deploy of `main-dev`.
- **Test pairing (C-08):**
  - Step 4 covers Step 3; Step 6 covers Step 5; Step 8 covers Step 7; Step 10 covers Step 9; Step 12 covers Step 11.
  - Step 14 covers Step 13; Step 16 covers Step 15; Step 18 covers Step 17; Step 20 covers Step 19; Step 22 covers Step 21; Step 24 covers Step 23.

---

### Step 1 — proto: Additive analysis + marketdata contract

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/analysis/v1/analysis.proto` — modify
- `packages/proto/marketdata/v1/marketdata.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness per message, no breaking changes, `buf lint`/`buf breaking` pass; `packages/proto` owner — field number uniqueness, backward compatibility, naming conventions; `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias; `xstockstrat-marketdata` owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- `enum NoTradeReason` (`analysis.proto:196-202`) has values 0–4. The last is `NO_TRADE_REASON_FORMULA_ERROR = 4;` (L201), so the next free number is **5**.
- `message SymbolDiagnostics` (`analysis.proto:226-232`) has fields 1–5 (`warmup_bars = 5;` L231), so the next free is **6**.
- `message Opportunity` (`analysis.proto:592`) ends at `optional double symbol_score = 22;`, so the next free numbers are **23, 24**.
- `message ListOpportunitiesRequest` (`analysis.proto:681-688`) ends at `OpportunitySort sort = 5;` (L687), so the next free is **6**.
- `service MarketDataService` (`marketdata.proto:12-69`):
  - Its last RPC is `rpc GetSectorHistory(...)` (L68). The sector RPCs (L64-68) are the store-only read precedent.
  - The file ends at L386 (`message GetSectorHistoryResponse` L384).
- `/sdd-review` overlap (context.md 2026-09-27): no other in-flight feature claims these numbers. A grep of the other features' `implementation-spec.md`/`design.md` files for `ListOpportunitiesRequest|SymbolDiagnostics|NoTradeReason|GetEtfFlags|= 23;` returns no hits.

**TDD**: `N/A (proto contract — no executable code)`

**Covers**: —

**Instructions**:
1. `analysis.proto`:
   - Add `NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE = 5;` after L201, with a trailing comment: "strategy requires fundamentals and the symbol has none usable in the window — refused, not evaluated (feature 215)".
   - Add a new top-level enum directly after `NoTradeReason`:
     `enum FundamentalsGap { FUNDAMENTALS_GAP_UNSPECIFIED = 0; FUNDAMENTALS_GAP_ETF = 1; FUNDAMENTALS_GAP_NOT_ETF = 2; }`
     Its comment: best-effort marketdata label, never affects the guard decision (FR-11).
   - Add `FundamentalsGap fundamentals_gap = 6;` to `SymbolDiagnostics`.
   - Add these two fields to `Opportunity` after `symbol_score = 22`, each with a `// feature 215 —` comment that mirrors the field-20 comment style:
     - `bool fundamentals_unavailable = 23;` — derived at read from the `"fundamentals_unavailable"` provenance marker, no column.
     - `FundamentalsGap fundamentals_gap = 24;`
   - Add `string symbol = 6;` to `ListOpportunitiesRequest`, with the comment `// feature 215 — empty = all symbols; exact (normalized) symbol filter`.
2. `marketdata.proto`:
   - Add `rpc GetEtfFlags(GetEtfFlagsRequest) returns (GetEtfFlagsResponse);` after L68. Its comment: cache-only read, never calls FMP on the request path, unknown → `is_etf` unset (feature 215).
   - Append these messages:
     - `message GetEtfFlagsRequest { repeated string symbols = 1; }`
     - `message EtfFlag { string symbol = 1; optional bool is_etf = 2; }`
     - `message GetEtfFlagsResponse { repeated EtfFlag flags = 1; }`

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/block-fundamentals-strategy-on-etf"
grep -n "NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE = 5\|FUNDAMENTALS_GAP_NOT_ETF = 2\|fundamentals_gap = 6\|fundamentals_unavailable = 23\|fundamentals_gap = 24\|string symbol = 6" analysis/v1/analysis.proto
grep -n "rpc GetEtfFlags\|optional bool is_etf = 2" marketdata/v1/marketdata.proto
```

---

### Step 2 — proto-gen: Regenerate stubs

**Status**: `done`
**Service**: `packages/proto`
**Files** (generated, never hand-edited; verified against `git ls-files packages/proto/gen`):
- Go:
  - `packages/proto/gen/go/analysis/v1/analysis.pb.go` — modify
  - `packages/proto/gen/go/marketdata/v1/marketdata.pb.go` — modify
  - `packages/proto/gen/go/marketdata/v1/marketdata_grpc.pb.go` — modify (new `GetEtfFlags` RPC)
  - `packages/proto/gen/go/marketdata/v1/marketdatav1connect/marketdata.connect.go` — modify (new `GetEtfFlags` RPC)
- Python:
  - `packages/proto/gen/python/analysis/v1/analysis_pb2.py` — modify
  - `packages/proto/gen/python/marketdata/v1/marketdata_pb2.py` — modify
  - `packages/proto/gen/python/marketdata/v1/marketdata_pb2_grpc.py` — modify (new `GetEtfFlags` RPC)
- TS (source + compiled `dist/`):
  - `packages/proto/gen/ts/analysis/v1/analysis_pb.ts`, `analysis.ts` — modify
  - `packages/proto/gen/ts/marketdata/v1/marketdata_pb.ts`, `marketdata.ts`, `marketdata_connect.ts` — modify
  - `packages/proto/gen/ts/dist/analysis/v1/analysis_pb.{js,d.ts}`, `analysis.{js,d.ts}` — modify
  - `packages/proto/gen/ts/dist/marketdata/v1/marketdata_pb.{js,d.ts}`, `marketdata.{js,d.ts}` — modify
- Expected unchanged (no new analysis RPC): `analysis_grpc.pb.go`, `analysisv1connect/analysis.connect.go`, `analysis_pb2_grpc.py`, `analysis_connect.ts`, and every `__init__.py`. If codegen touches any other `gen/` path, stop and record it in the Deviation Log.

**Reviewers**: Proto Reviewer — field number uniqueness per message, no breaking changes, `buf lint`/`buf breaking` pass; `packages/proto` owner — field number uniqueness, backward compatibility, naming conventions; `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias; `xstockstrat-marketdata` owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- Root `CLAUDE.md` § Generating Proto Stubs: `./scripts/buf-gen.sh` generates TS/Python/Go stubs and compiles the TS package. CI `proto-freshness` enforces it.

**TDD**: `N/A (generated code)`

**Covers**: —

**Instructions**:
- Run `./scripts/buf-gen.sh` from the repo root and commit only the generated files listed in **Files**.
- If Docker or GitHub egress is unavailable, follow `docs/runbooks/codegen-toolchain-host-setup.md`.
- Expected follow-on: the three descriptor-parity guards listed in § Step Dependencies go red until Steps 3 and 5 land.

**Verification**:
```bash
./scripts/buf-gen.sh && git status --porcelain packages/proto/gen | grep -Ev 'gen/(go|python|ts|ts/dist)/(analysis|marketdata)/' ; test -z "$(git status --porcelain packages/proto/gen | grep -Ev 'gen/(go|python|ts|ts/dist)/(analysis|marketdata)/')"   # only analysis/marketdata stubs changed
grep -rl "GetEtfFlags" packages/proto/gen/go packages/proto/gen/python packages/proto/gen/ts | head -3
grep -rl "FUNDAMENTALS_GAP_ETF" packages/proto/gen/python packages/proto/gen/ts | head -3
```

---

### Step 3 — service: Opportunity row contract + repository (symbol filter, floor exemption, heal action, structural marker)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/app/repositories/opportunities.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `_row_to_opportunity(row)` (`servicer.py:6188`) maps provenance markers to proto bools. Precedent: `data_unavailable=("unavailable" in provenance)` at L6211. `readiness = row.get("readiness_json") or {}` at L6193.
- `_PROVENANCE_STRUCTURAL_MARKERS = ["watchlist", "position", "denied"]` is defined at `repositories/opportunities.py:26`.
  - It is shared by `_primary_source` (`servicer.py:6097-6106`) and by both SQL LATERALs (`opportunities.py:230-233`, `$2` at L364-366).
  - Its comment says "unavailable" is deliberately absent.
- The `read()` floor exemption is at `opportunities.py:250`: `AND (o.conviction >= $2 OR o.provenance ? 'denied' OR o.provenance ? 'unavailable')`. The `read()` signature (L191-201) has keyword args `sources`, `action_filter`, `sort` and binds `$1..$8` (L263-271).
- `replace_symbols` (`opportunities.py:113-163`) UPDATEs conviction…symbol_score with binds `$1..$10`, and never writes `action`. The adversary found this in round 2 (context.md, objection C).
- `ListOpportunities` (`servicer.py:4175`) calls `self._opportunities_repo.read(...)` at L4206-4214 (fresh) and L4260-4268 (stale), passing `sources=req_sources, action_filter=request.action_filter, sort=request.sort`.
- The `_normalize_symbol(symbol)` helper is at `servicer.py:5963`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Structural marker.** In `opportunities.py:26`, set `_PROVENANCE_STRUCTURAL_MARKERS = ["watchlist", "position", "denied", "fundamentals_unavailable"]`, and extend the comment. This keeps the skip marker out of `Opportunity.source` and the source facet (C-16 PRESERVE feature-190; design § /sdd-spec notes).
2. **Floor exemption.** In `read()` (L250), add `OR o.provenance ? 'fundamentals_unavailable'` and extend the feature-185 comment block. This exempts skip rows from the floor (C-16 EXTEND `@AC-3 @feature-190`).
3. **Symbol filter.** Add a keyword parameter `symbol: str = ""` to `read()`.
   - Add `AND ($9::text = '' OR o.symbol = $9)` to the WHERE clause.
   - Append `symbol` as the 9th bind argument.
   - Leave `available_sources` untouched: the facet is unchanged (design Fix 6).
4. **Heal action rewrite.** In `replace_symbols`:
   - Add `action = COALESCE($11::int, action),` to the SET list.
   - Append `(int(r["action"]) if r.get("action") is not None else None)` as the 11th tuple element.
   - Extend the docstring: a heal row with no `"action"` key leaves the action unchanged.
5. **Request plumbing.** In `ListOpportunities`, compute `req_symbol = _normalize_symbol(request.symbol) if request.symbol else ""` once, next to `req_sources` (L4205), and pass `symbol=req_symbol` to both `read(...)` calls.
6. **Row → proto.** In `_row_to_opportunity`, add these to the `analysis_pb2.Opportunity(...)` constructor:
   - `fundamentals_unavailable=("fundamentals_unavailable" in provenance)`
   - `fundamentals_gap=int(readiness.get("fundamentals_gap", 0) or 0)`
   - Add a short `# feature 215 —` constraint comment: the gap rides `readiness_json` (no column), the same carrier as `target_price`.

**Verification**:
```bash
cd services/xstockstrat-analysis && grep -n "fundamentals_unavailable" app/repositories/opportunities.py app/handlers/servicer.py && grep -n "COALESCE(\$11::int, action)\|\$9::text = ''" app/repositories/opportunities.py
```

---

### Step 4 — test: Row contract + repository

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_opportunities_repo.py` — modify
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- The Opportunity descriptor-parity guard is `TestOpportunity…` in `tests/test_analysis_servicer.py`:
  - The `_MAPPED` set ends at L6059 (`"symbol_score"`), and `_INTENTIONALLY_UNSET` is at L6063.
  - `test_mapper_covers_every_proto_field` is at L6065-6068, `test_mapper_populates_all_fields` at L6076.
- `tests/test_opportunities_repo.py` exists and holds the AsyncMock-pool SQL assertions (the same style as `tests/test_backtest_run_symbols_repo.py:71-80`).

**TDD**: `red-green required`

**Covers**: `AC-13, AC-15`

**Instructions**:
1. **Parity guard.** Add `"fundamentals_unavailable"` and `"fundamentals_gap"` to `_MAPPED`. Extend `test_mapper_populates_all_fields` so its row carries `provenance` containing `"fundamentals_unavailable"` and `readiness_json={"fundamentals_gap": 1}`, and assert:
   - `opp.fundamentals_unavailable is True`
   - `opp.fundamentals_gap == analysis_pb2.FUNDAMENTALS_GAP_ETF`
2. **Repository tests** (AsyncMock pool):
   - (a) `read(..., symbol="SCHD")` binds `"SCHD"` as `$9`, and the SQL contains `$9::text = ''`. The default call binds `""` (empty means all, so existing callers are unchanged).
   - (b) The SQL contains `o.provenance ? 'fundamentals_unavailable'` (floor exemption).
   - (c) `_PROVENANCE_STRUCTURAL_MARKERS` contains `"fundamentals_unavailable"`, and `_primary_source(["fundamentals_unavailable", "uw"]) == "uw"` (facet unchanged, C-16 PRESERVE feature-190).
   - (d) `replace_symbols([{…, "action": 0}])` binds `0` at position 11 and the SQL contains `COALESCE($11::int, action)`.
   - (e) A heal row **without** an `"action"` key binds `None` at position 11. This means the action is unchanged; it covers the `@AC-13` "heal with no action key" clause.
   - (f) A row that round-trips `["watchlist", "fundamentals_unavailable"]` through `_row_to_opportunity` keeps `source == ""`, `fundamentals_unavailable is True` and `data_unavailable is False`.
3. **Servicer test.** `ListOpportunities` with `request.symbol=" schd "` passes `symbol="SCHD"` to both repo `read` calls (`@AC-15` backend half).
4. **C-13.** The literals are single-consumer and scenario-local, so they stay inline.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest tests/test_opportunities_repo.py tests/test_analysis_servicer.py -q && uv run pytest --cov=app --cov-fail-under=40 -q && uv run ruff check . && uv run ruff format --check .
grep -n "def .*fixture\|from .conftest\|conftest" tests/test_opportunities_repo.py | head -3   # C-13: single-consumer inline literal — compliant
```

---

### Step 5 — service: Agent projections + tool docstrings

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify
- `services/xstockstrat-agent/app/backtest_view.py` — modify
- `services/xstockstrat-agent/app/tools.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- `_SYMBOL_KEYS = ("symbol", "no_trade_reason", "bars_total", "warmup_bars")` is at `app/backtest_view.py:51`. The parity check `set(_SYMBOL_KEYS) | {"bars"} == SymbolDiagnostics fields` is at `tests/test_backtest_view.py:210-212`.
- `client.run_backtest` (`app/client.py:561`) serializes through `MessageToDict` without `use_integers_for_enums` (recon `client.py:637-641`). So `NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE` and `FUNDAMENTALS_GAP_ETF` arrive as names, with no code change needed.
- `_opportunity_to_dict(o, analysis_pb2)` (`app/client.py:782-804`) hand-builds the dict. Precedent: `"data_unavailable": o.data_unavailable` at L803, enum names via `analysis_pb2.OpportunityActionTag.Name(o.action)` at L791.
- Tool docstrings in `app/tools.py`:
  - `run_backtest` at L707. Its fundamental-operand paragraph is at L764-767 and says the operand "reads hold".
  - `set_strategy_live` at L1309-1323.
  - `list_opportunities` at L1499-1523, which lists `data_unavailable` at L1510-1511.
- `ListOpportunitiesRequest` is built at `app/client.py:863`. The design keeps `list_opportunities` unextended (no `symbol` arg, YAGNI — design Fix 6).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `backtest_view.py:51`: set `_SYMBOL_KEYS = ("symbol", "no_trade_reason", "bars_total", "warmup_bars", "fundamentals_gap")`. This keeps the summary O(symbols), and the gap label reaches the inline summary (C-14).
2. `client.py` `_opportunity_to_dict`: after L803, add
   - `"fundamentals_unavailable": o.fundamentals_unavailable`
   - `"fundamentals_gap": analysis_pb2.FundamentalsGap.Name(o.fundamentals_gap)`
   with a `# feature 215 —` comment: the non-actionable skip row, distinct from `data_unavailable`.
3. `tools.py` docstrings — text only; names, params and return shape are unchanged:
   - **`run_backtest`.** Replace the "else the operand reads hold" sentence (L764-767). New text: for a strategy that requires fundamentals (a fundamental operand, or a custom formula declaring `fundamental_inputs`), a symbol with no usable filing before each evaluated bar is **refused**, not evaluated.
     - It gets `no_trade_reason: NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE` plus `fundamentals_gap` (ETF / NOT_ETF / UNSPECIFIED), with no trades and no evidence cell.
     - A single refused symbol yields `BACKTEST_STATUS_INSUFFICIENT_DATA`.
     - A fundamentals fetch outage instead adds a `warnings` entry ("fundamentals fetch failed … — rerun") and no reason.
   - **`list_opportunities`.** Add `fundamentals_unavailable` (a non-actionable row: action UNSPECIFIED, no composite, the strategy needs fundamentals the symbol lacks) and `fundamentals_gap` to the per-row field list.
   - **`set_strategy_live`.** Add: enabling is not checked against fundamentals availability (the live universe is dynamic). At evaluation time, a symbol with no usable fundamentals is denied **entry** (exits still fire), with one WARN log and one WARNING alert when it becomes unavailable.

**Verification**:
```bash
cd services/xstockstrat-agent && grep -n "fundamentals_gap\|fundamentals_unavailable" app/backtest_view.py app/client.py app/tools.py
```

---

### Step 6 — test: Agent projections

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_opportunity_projection.py` — modify
- `services/xstockstrat-agent/tests/test_backtest_view.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- `_full_opportunity(analysis_pb2)` at `tests/test_opportunity_projection.py:18-44` populates every field. Parity is asserted at L48-52, and the teeth test is at L55-62.
- The `test_backtest_view.py` parity assertion is at L210-212. The per-symbol key loop is at L146.

**TDD**: `red-green required`

**Covers**: `AC-2, AC-4`

**Instructions**:
1. In `_full_opportunity`, add `fundamentals_unavailable=True, fundamentals_gap=analysis_pb2.FUNDAMENTALS_GAP_ETF`.
2. Add a test: a skip-row Opportunity (`action=UNSPECIFIED`, no `composite_score`, `fundamentals_unavailable=True`, `fundamentals_gap=ETF`) projects to:
   - `"fundamentals_unavailable": True`
   - `"fundamentals_gap": "FUNDAMENTALS_GAP_ETF"`
   - `"action": "OPPORTUNITY_ACTION_TAG_UNSPECIFIED"`
   - no `composite_score` key
3. In `test_backtest_view.py`, add a test: `summarize(...)` over a diagnostics dict carrying `"no_trade_reason": "NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE", "fundamentals_gap": "FUNDAMENTALS_GAP_ETF"` keeps both keys inline (the `@AC-2` agent surface). The existing parity assertion goes green with Step 5's `_SYMBOL_KEYS`.
4. **C-13.** These are single-consumer inline proto literals, so they are compliant.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run pytest tests/test_opportunity_projection.py tests/test_backtest_view.py -q && uv run pytest --cov=app --cov-fail-under=40 -q && uv run ruff check . && uv run ruff format --check .
```

---

### Step 7 — service: Marketdata absence encoding + shared 80% threshold

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/source/source.go` — modify
- `services/xstockstrat-marketdata/internal/fmp/fmp_client.go` — modify
- `services/xstockstrat-marketdata/internal/finnhub/finnhub_client.go` — modify
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify

**Reviewers**: `xstockstrat-marketdata` owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence** (`marketdata_service.go` line numbers are **origin/main-dev**; locate by the named symbol at execute time):
- `type FundamentalsSource interface` is at `internal/source/source.go:68`.
- The vendor single-symbol no-data paths:
  - `fmp_client.go:166` `return nil, fmt.Errorf("fmp: no fundamentals for %q", symbol)` (in `(*Client).GetFundamentals`). FMP's `GetFundamentalsMulti` returns a `fetchQuotes` error as-is (L177-180) and omits only symbols the quote call did not return (L203-209). So an empty result here **is** vendor absence.
  - `finnhub_client.go:56` `return nil, fmt.Errorf("finnhub: no fundamentals for %q", symbol)` (in `(*Client).GetFundamentals`, L50-59). It delegates to `GetFundamentalsMulti`, whose loop `continue`s on **any** `fetchOne` error (L71-75): non-200 (`getJSON` L131-134), transport failure, or decode error. A decoded symbol always yields a row (nil fields at worst). So this branch fires **only on an outage**, never on absence, and must **not** be wrapped as `ErrNoFundamentals` (FR-8: outage ≠ absence; found at /sdd-review impl-spec 2026-10-11).
- The `GetFundamentalsMulti` edgar loop (L1331-1345): `f, err := s.getEdgarSnapshot(ctx, sym)` (L1337), then `if err != nil { return nil, err }`. One un-producible symbol therefore fails the whole batch.
- `getEdgarSnapshot` (L1513):
  - Kill switch: `marketdata.edgar.enabled` → `CodeFailedPrecondition` (L1514-1517).
  - The not-producible branch is at L1529. With the vendor disabled it returns `CodeFailedPrecondition` "no edgar snapshot for %s and vendor fallback disabled" (L1537-1540). Otherwise it calls `s.resolveFundamentals` (L1541).
- `resolveFundamentals` (L1416): a vendor error falls to `connect.NewError(connect.CodeUnavailable, …)` at L1445. `ErrFMPDailyCapExceeded` maps to `CodeResourceExhausted` (L1439-1444).
- `maybeAlertQuota` (L1627) holds the inline 80% threshold: `if cap <= 0 || count < (cap*8)/10 { return }` (L1628).
- `fundamentalsEnabled()` (L1457) returns `CodeFailedPrecondition` for a globally disabled vendor. That path is unchanged.
- The handler forwards connect codes as-is (`GetFundamentals` `internal/handler/marketdata_handler.go:217-226` → `forwardConnectErr` L276). The gRPC adapter maps them through `toGRPCError` (L479).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `source.go`: add `var ErrNoFundamentals = errors.New("no fundamentals")`, with the comment "vendor has no fundamentals for the symbol — absence, not an outage (feature 215)".
2. **Vendor clients.**
   - `fmp_client.go:166`: wrap it, e.g. `fmt.Errorf("fmp: no fundamentals for %q: %w", symbol, source.ErrNoFundamentals)`.
   - `finnhub_client.go` `(*Client).GetFundamentals` (L50-59): call `c.fetchOne(ctx, symbol, time.Now().UTC())` directly and return its error unwrapped, so a Finnhub outage reaches `resolveFundamentals`' generic `CodeUnavailable` (UNKNOWN downstream), not NotFound. Delete the `len(out) == 0` branch. Finnhub has no absence signal, so it never returns `ErrNoFundamentals`. `GetFundamentalsMulti`'s skip-on-error loop is unchanged.
3. `marketdata_service.go`:
   - (a) Add an unexported sentinel `var errNoEdgarSnapshot = errors.New("no edgar snapshot and vendor fallback disabled")`.
     - In `getEdgarSnapshot`'s vendor-disabled branch (L1537-1540), return `connect.NewError(connect.CodeNotFound, fmt.Errorf("%s: %w", symbol, errNoEdgarSnapshot))` instead of `CodeFailedPrecondition`.
     - Keep the existing WARN at L1534.
   - (b) In `resolveFundamentals`, before the generic `CodeUnavailable` at L1445, add `if errors.Is(err, source.ErrNoFundamentals) { return nil, connect.NewError(connect.CodeNotFound, err) }`.
   - (c) In the edgar branch of `GetFundamentalsMulti` (L1337-1340), skip the symbol when `connect.CodeOf(err) == connect.CodeNotFound` (omit). Every other error still aborts:
     - the global kill switch → FailedPrecondition;
     - vendor `ResourceExhausted`/`Unavailable` stay as they are (design spec note; FR-7).
   - (d) Extract `func atQuotaAlertThreshold(count, cap int) bool { return cap > 0 && count >= (cap*8)/10 }` next to `maybeAlertQuota`, and rewrite `maybeAlertQuota`'s first line (L1628) as `if !atQuotaAlertThreshold(count, cap) { return }`. It becomes the single home of the 80% threshold (design Fix 4).
4. Behavioral ripple (no code change): the analysis blend-universe resolver (`live_loop.py:142-187`), the screener and `fundsignal_loop` call `GetFundamentalsMulti`. Under `snapshot_source=edgar` with vendors off, they now get a partial list (un-producible symbols omitted) instead of a FailedPrecondition for the whole chunk.
   - This is the FR-7 contract (C-16 EXTEND `@AC-7 @feature-211`).
   - `@AC-6 @feature-168` (a real resolution failure yields an empty universe) is unaffected: real failures still error.

**Verification**:
```bash
cd services/xstockstrat-marketdata && grep -n "ErrNoFundamentals" internal/source/source.go internal/fmp/fmp_client.go internal/service/marketdata_service.go && ! grep -n "ErrNoFundamentals\|no fundamentals for" internal/finnhub/finnhub_client.go && grep -n "errNoEdgarSnapshot\|func atQuotaAlertThreshold" internal/service/marketdata_service.go && GOWORK=off go build ./...
```

---

### Step 8 — test: Marketdata absence encoding

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify
- `services/xstockstrat-marketdata/internal/fmp/fmp_client_test.go` — modify
- `services/xstockstrat-marketdata/internal/finnhub/finnhub_client_test.go` — modify

**Reviewers**: `xstockstrat-marketdata` owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- Test helpers in `internal/service/marketdata_service_test.go`:
  - `fakeFundRepo` (L177), `fakeFundSource` (L217), `fakeCfg` (L247), `fakeNotify` (L272)
  - `newFundSvc(cfg, repo, src, notify, provider)` (L306), `fakeHistRepo` (L1497)
- Existing feature-211 edgar tests to extend:
  - `TestGetFundamentals_EdgarFallbackToVendor_AC7_feature211` (L2023)
  - `TestGetFundamentals_EdgarKillSwitch_feature211` (L2044)
- Quota alert tests: `TestGetFundamentals_QuotaWarningEmittedOnce` (L480) and `TestGetFundamentals_Finnhub_QuotaWarningRefiresPerWindow` (L625). These must stay green; they are the `atQuotaAlertThreshold` extraction guard.
- FMP client tests are in `internal/fmp/fmp_client_test.go` (e.g. `TestGetFundamentals_MissingFieldStaysNil` L105).
- Finnhub client tests are in `internal/finnhub/finnhub_client_test.go`: the `recordingRT` path-keyed stub (L15) and `newTestClient(rt)` (L46). `TestHTTPError_DoesNotLeakAPIKey` (L202) drives a 403 through `GetFundamentals` and must stay green after Step 7 (the error now comes from `getJSON`, which never includes the URL). `finnhub` is the default provider.

**TDD**: `red-green required`

**Covers**: `AC-7, AC-8`

**Instructions**:
- Add these table-driven tests:
  - (a) With edgar on, `fmp.enabled=false`, `finnhub.enabled=false`, `fakeHistRepo` holding a producible `BABA` period and **no** `SCHD` history:
    - `GetFundamentalsMulti(["SCHD","BABA"])` returns only BABA with `err == nil`.
    - `GetFundamentals("SCHD")` returns `connect.CodeOf(err) == connect.CodeNotFound`.
  - (b) A vendor `fakeFundSource` returning an error that wraps `source.ErrNoFundamentals` gives `GetFundamentals` → `CodeNotFound`, in vendor mode and through the edgar fallback.
  - (c) `marketdata.edgar.enabled=false` gives `CodeFailedPrecondition` from both RPCs.
  - (d) A vendor at its cap with no cache gives `CodeResourceExhausted` on the single RPC and **aborts** Multi under edgar fallback, not omit.
  - (e) `atQuotaAlertThreshold`: `(0,0)=false`, `(79,100)=false`, `(80,100)=true`, `(100,100)=true`.
- In `fmp_client_test.go`, add: an empty `/stable/quote` response gives `errors.Is(err, source.ErrNoFundamentals)` from `GetFundamentals`.
- In `finnhub_client_test.go`, add `TestGetFundamentals_OutageIsNotAbsence` (`@AC-7`, `@AC-8`): a `recordingRT` answering `/stock/metric` with HTTP 503 (and a variant with 429) makes `GetFundamentals` return an error with `!errors.Is(err, source.ErrNoFundamentals)`, and the error names `/stock/metric`. A 200 response with `{"metric":{}}`, `{}` quote and `{}` profile returns a row with nil fields and `err == nil` (Finnhub has no absence signal).
- In `marketdata_service_test.go`, extend (b): a `fakeFundSource` returning a plain (unwrapped) error gives `GetFundamentals` → `CodeUnavailable`, not `CodeNotFound`.
- Note: the `service` package is excluded from the CI coverage measure (template COVERPKGS), so these assertions are the behavioral gate there. `fmp` is measured.
- **C-13.** The SCHD/BABA literals have one consumer (this file), so they stay inline. Do not create `internal/testdata/`.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/service/... ./internal/fmp/... ./internal/finnhub/... -race -count=1 -run 'Edgar|NotFound|NoFundamentals|OutageIsNotAbsence|HTTPError|Quota|AtQuota' && COVERPKGS=$(GOWORK=off go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | awk '/^total:/{print; gsub("%","",$3); exit ($3+0<40)}' && GOWORK=off golangci-lint run --modules-download-mode=mod   # coverage ≥ 40% (CI Go threshold)
grep -rn "\"SCHD\"" --include="*_test.go" internal | cut -d: -f1 | sort -u   # C-13: ≤1 declaring file
```

---

### Step 9 — service: Cache-only `GetEtfFlags` + headroom-gated background fill

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/fmp/fmp_client.go` — modify
- `services/xstockstrat-marketdata/internal/service/etf_flags.go` — create
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify
- `services/xstockstrat-marketdata/internal/handler/marketdata_handler.go` — modify
- `services/xstockstrat-marketdata/cmd/server/main.go` — modify

**Reviewers**: `xstockstrat-marketdata` owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- FMP client:
  - `type fmpProfile struct { Beta *float64; Currency string; Sector string }` at `fmp_client.go:355-359`.
  - `fetchProfile` (L286-297) returns `nil, nil` on an empty profile array.
  - `FetchSector` (L363-369) is the single-purpose profile-reader precedent.
  - Every call routes through `getJSON` (L218), which reserves the shared day budget and **refunds** on any non-2xx or transport error (L232-249).
- The budget seam is `type fmpBudget interface { BudgetSnapshot() (used, dailyCap int) }` (`classification_service.go:35-38`), set by `SetClassification(store, src, budget)` (L52-56) as `s.fmpBudget`. `main.go:152` passes `fmpClient` for both the source and the budget.
- `sectorSource` (`classification_service.go:31-33`) must **not** be widened (design G: own interface).
- Background-poller precedent:
  - `go svc.StartClassificationRefreshPoller(ctx)` (`cmd/server/main.go:159`)
  - `go svc.StartWarmQuotePoller(ctx)` (L155)
- `enrichmentUnderCap()` (`marketdata_service.go:2085-2091`, main-dev) allows up to 100% of the cap, so it is rejected for the fill (design § Rejected).
- The 80% helper is `atQuotaAlertThreshold` from Step 7. It returns **false** when `cap <= 0`, so `!atQuotaAlertThreshold(…)` alone would let the filler fetch at cap 0.
- Cap-0 semantics (verified 2026-10-11): `(*Client).BudgetSnapshot` (`fmp_client.go:97-104`) documents "cap <= 0 = uncapped", but that holds only for a client with `limits == nil` (`currentLimits` L106-111 returns `0, 0`). Production always wires `Limits` (`cmd/server/main.go:242-245`, `marketdata.fmp.daily_request_cap`), and `reserve()` (L121-131) then refuses **every** call when `used >= dailyCap`. So an operator-set cap of 0 means **zero budget**, not unlimited.
- The config read is `s.fundCfg.GetBool("marketdata."+…+".enabled", false)` (precedent `fundamentalsEnabled` L1457-1462).
- Handler pattern:
  - store-only `GetCurrentSector` (`marketdata_handler.go:150-157`)
  - the gRPC adapter method shape at L343-349 (`toGRPCError`)
- `MarketDataService` struct (`marketdata_service.go:34`) holds `fmpBudget fmpBudget` (L90) and `class classificationState` (L92).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **FMP client.**
   - Add `IsEtf *bool \`json:"isEtf"\`` to `fmpProfile`.
   - Add `func (c *Client) FetchIsEtf(ctx context.Context, symbol string) (*bool, error)`. It calls `fetchProfile` and returns `(nil, nil)` for an empty profile, else `p.IsEtf`. The comment states it shares the limiter and day budget like `FetchSector`.
2. **`etf_flags.go` (new, package `service`).**
   - Add `type etfFlagSource interface { FetchIsEtf(ctx context.Context, symbol string) (*bool, error) }`.
   - Add fixed-invariant constants, each with a ≤2-line constraint comment (F-07 justification in design Fix 4):
     - `etfFlagTTL = 30 * 24 * time.Hour`
     - `etfFlagCacheMax = 10000` (size bound)
     - `etfFlagQueueCap = 256`
   - Add `type etfFlagState struct`. It holds:
     - `src etfFlagSource`
     - `mu sync.Mutex`
     - `entries map[string]etfFlagEntry`, where `etfFlagEntry{ isEtf *bool; fetchedAt time.Time }`
     - `pending map[string]struct{}` (enqueue dedup)
     - `queue chan string`
     - `now func() time.Time`
   - Add a `etf etfFlagState` field to `MarketDataService`, and `func (s *MarketDataService) SetEtfFlagSource(src etfFlagSource)`. It initializes the maps and `queue = make(chan string, etfFlagQueueCap)`.
   - **`GetEtfFlags`** — `func (s *MarketDataService) GetEtfFlags(ctx context.Context, req *marketdatav1.GetEtfFlagsRequest) (*marketdatav1.GetEtfFlagsResponse, error)`. It is cache-only and **never** calls the source. For each `normalizeSymbols(req.GetSymbols())` symbol (`classification_service.go:96`):
     - A fresh entry (`now - fetchedAt < etfFlagTTL`) emits `EtfFlag{Symbol, IsEtf: entry.isEtf}`, which is unset for a negative-cached empty profile.
     - A miss emits `EtfFlag{Symbol}` with `is_etf` unset, and does a **non-blocking** enqueue: skip if already in `pending`, drop on a full channel (`select { case q <- sym: default: }`).
   - **`StartEtfFlagFiller(ctx context.Context)`** reads the queue. Per symbol:
     - Skip (and clear `pending`) unless all four hold:
       - `s.fundCfg.GetBool("marketdata.fmp.enabled", false)`
       - `s.fmpBudget != nil`
       - `used, cap := s.fmpBudget.BudgetSnapshot()` gives `cap > 0`, gated **explicitly**. A cap of 0 is zero budget in production (see Evidence), and the label is best-effort, so an uncapped or unwired budget never earns a background fetch.
       - `!atQuotaAlertThreshold(used, cap)` (design Fix 4: never spends the last 20% the snapshot path needs)
     - Otherwise call `src.FetchIsEtf`.
       - On `err != nil`: do not cache (the budget slot was already refunded by `getJSON`); log at Debug.
       - On success: store the entry. A `nil` result is stored too, which negative-caches an empty profile.
     - If `len(entries) >= etfFlagCacheMax`, evict the oldest `fetchedAt` before inserting.
     - Clear `pending`.
     - Return on `ctx.Done()`.
3. **Handler.** Add `MarketDataHandler.GetEtfFlags` (connect wrapper mirroring `GetCurrentSector` L150-157) and `grpcMarketDataAdapter.GetEtfFlags` (mirroring L343-349).
4. **`main.go`.** After L152, add `svc.SetEtfFlagSource(fmpClient)`; after L159, add `go svc.StartEtfFlagFiller(ctx)`. This is the same `*fmp.Client`, so the budget stays shared (comment at `main.go:233`).
5. No header propagation applies: the only new outbound call is FMP (external), and the inbound RPC makes no service call.

**Verification**:
```bash
cd services/xstockstrat-marketdata && grep -n "IsEtf\|func (c \*Client) FetchIsEtf" internal/fmp/fmp_client.go && grep -n "func (s \*MarketDataService) GetEtfFlags\|StartEtfFlagFiller\|atQuotaAlertThreshold" internal/service/etf_flags.go && grep -n "SetEtfFlagSource\|StartEtfFlagFiller" cmd/server/main.go && grep -n "GetEtfFlags" internal/handler/marketdata_handler.go && GOWORK=off go build ./...
```

---

### Step 10 — test: `GetEtfFlags` + fill

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/etf_flags_test.go` — create
- `services/xstockstrat-marketdata/internal/fmp/fmp_gateway_test.go` — modify

**Reviewers**: `xstockstrat-marketdata` owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- `TestFetchSector_ParsesProfileSector` (`internal/fmp/fmp_gateway_test.go:138`) is the profile-decode test precedent. The budget/refund gateway tests are at L48-116.
- `type fakeBudget struct{ used, cap int }` is at `internal/service/marketdata_service_test.go:1664`. It is the same package, so it is reusable here.
- `fakeCfg` is at `marketdata_service_test.go:247`.

**TDD**: `red-green required`

**Covers**: `AC-14`

**Instructions**:
- In `fmp_gateway_test.go`, add a test: an `httptest` profile body with `"isEtf": true` / `false` decodes through `FetchIsEtf`, and `[]` returns `(nil, nil)`.
- In `etf_flags_test.go`, use a counting `fakeEtfSource`. It is a single consumer, so it stays inline. Add tests for:
  - (a) A miss returns `is_etf` unset, makes **0** source calls, and enqueues once. A second miss for the same symbol does not enqueue twice.
  - (b) A full queue drops the symbol without blocking.
  - (c) The filler skips at `fakeBudget{used: 80, cap: 100}` (`@AC-14` — no FMP call and SCHD is not fetched), at `fakeBudget{used: 0, cap: 0}` (explicit `cap > 0` gate), and when `marketdata.fmp.enabled=false`. It fetches at `used: 79`.
  - (d) A cached flag is served for <30 days with no re-fetch, and re-queued after the TTL (an injected `now`).
  - (e) An empty profile is negative-cached: unset, and not re-fetched within the TTL.
  - (f) A source error is not cached.
  - (g) Size-bound eviction.
  - (h) `go test -race` over a concurrent `GetEtfFlags` + filler run.
- The `service` package is excluded from the CI coverage measure, so these assertions are the gate. The `fmp` decode is measured.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/service/... ./internal/fmp/... -race -count=1 -run 'Etf|IsEtf' && COVERPKGS=$(GOWORK=off go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | awk '/^total:/{print; gsub("%","",$3); exit ($3+0<40)}' && GOWORK=off golangci-lint run --modules-download-mode=mod   # coverage ≥ 40% (CI Go threshold)
```

---

### Step 11 — service: Pure `fundamentals_guard` module + shared evaluator helper

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/services/fundamentals_guard.py` — create
- `services/xstockstrat-analysis/app/services/evaluator.py` — modify
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/app/engine/live_loop.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- The predicates to move:
  - `_definition_has_fundamental(definition)` (`servicer.py:5998-6001`)
  - `_definition_wants_fundamentals_formula(definition, formula_fund_map)` (`servicer.py:6004-6015`)
- Their users:
  - `servicer.py:1633-1634` and `servicer.py:1714`
  - The live-loop import is `from app.handlers.servicer import (… _definition_has_fundamental, _definition_wants_fundamentals_formula, …)` (`live_loop.py:38-46`), used at L621 and L642.
- `_fundamental_as_of_series(metric, eval_dates, fundamentals)` (`evaluator.py:77-98`) applies the strict `p.filed_date < d` as-of rule (L94).
- `_fundamentals_formula_series(...)` (`evaluator.py:519-593`) builds `data_keys` from `_FUNDAMENTAL_METRIC_DATA_KEY` (L535-541), `per_metric = {k: _fundamental_as_of_series(k, eval_dates, fundamentals) …}` (L542), and gates execution per epoch with `present = {...}; if present:` (L555-556).
- `_FUNDAMENTAL_METRIC_DATA_KEY` (`evaluator.py:146`) maps a metric enum int to a data key.
- `_assemble_component_series` (`evaluator.py:651`) routes components:
  - the 198 operand reads `fundamentals` (PIT) at L686-691;
  - the formula reads `formula_fundamentals_data if formula_fundamentals_data is not None else fundamentals` (L700-703).
- Recon "Patterns to REUSE" item 1 is a single shared predicate.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **`evaluator.py`.**
   - Add module-level `def fundamental_component_inputs(metric_enum_ints, eval_dates, fundamentals) -> tuple[list[str], dict[str, list]]`, built from L535-542. It returns `(data_keys, per_metric)`; when `data_keys` or `eval_dates` is empty, it returns `([], {})`.
   - Refactor `_fundamentals_formula_series` to call it, keeping the `if not data_keys or not eval_dates: return {"value": [None]*n}` early return and the epoch loop byte-identical.
   - Add `def component_would_execute(data_keys, per_metric) -> bool`. It returns True iff some index has a non-None value for some key. This is exactly the OR of the per-epoch `if present:` check (design A).
2. **`fundamentals_guard.py` (new, proto-light, no I/O).**
   - `class Availability(enum.Enum)` with values `NOT_REQUIRED, NOT_ASSESSED, AVAILABLE, UNAVAILABLE, UNKNOWN, DISABLED`.
   - Move `_definition_has_fundamental` and `_definition_wants_fundamentals_formula` here verbatim, keeping their names and docstrings.
   - `def requires_fundamentals(definition, formula_fund_map) -> bool`: the OR of the two predicates.
   - `def epoch_eval_dates(start, end, periods) -> list`: `[start] + sorted({p.filed_date + timedelta(days=1) for p in periods if start < p.filed_date + timedelta(days=1) <= end})`. A filing is visible from `filed_date + 1`, so this matches checking every calendar day (design H, "Window to dates").
   - `def assess(definition, formula_fund_map, eval_dates, *, symbol, pit, snap, failures, gate_enabled, bars_failed=False) -> Availability`:
     - Not `gate_enabled` → `NOT_REQUIRED`.
     - Required components are COMPONENT_KIND_FUNDAMENTAL components, CUSTOM_FORMULA components with a non-empty `formula_fund_map[formula_id]`, and CUSTOM_FORMULA components whose `("formula", formula_id)` is in `failures`. None → `NOT_REQUIRED`.
     - `bars_failed` or empty `eval_dates` → `NOT_ASSESSED` (design Fix 3).
     - Per component:
       - A formula failure → `UNKNOWN`.
       - The channel is `("pit", symbol)` for a 198 operand. For a formula it is `("snap", symbol)` when `snap is not None`, else `("pit", symbol)` — the same rule as `evaluator.py:700-703`.
       - A channel in `failures` → that value (`UNKNOWN` or `DISABLED`).
       - Otherwise:
         - 198 operand: AVAILABLE iff `any(v is not None for v in _fundamental_as_of_series(comp.fundamental_metric, eval_dates, data))`.
         - Formula: AVAILABLE iff `component_would_execute(*fundamental_component_inputs(formula_fund_map[fid], eval_dates, data))`.
         - Else UNAVAILABLE.
     - Combine with precedence UNAVAILABLE > UNKNOWN > DISABLED > AVAILABLE.
     - The docstring states the documented limit: the whole definition is judged, so OR-branch / exit-only fundamentals strategies are also guarded.
3. **`servicer.py`.** Delete the two predicate defs (L5998-6015) and import them, plus `Availability, assess, epoch_eval_dates, requires_fundamentals`, from `app.services.fundamentals_guard`.
4. **`live_loop.py`.** Import the two predicates (and `Availability`, `assess`) from `app.services.fundamentals_guard` instead of `app.handlers.servicer` (design J).

**Verification**:
```bash
cd services/xstockstrat-analysis && grep -n "^def _definition_has_fundamental\|^def _definition_wants_fundamentals_formula\|^def assess\|^def epoch_eval_dates\|^class Availability" app/services/fundamentals_guard.py && ! grep -n "^def _definition_has_fundamental" app/handlers/servicer.py && grep -n "def fundamental_component_inputs\|def component_would_execute" app/services/evaluator.py && uv run python -c "import app.engine.live_loop, app.handlers.servicer"
```

---

### Step 12 — test: Guard + evaluator parity

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_fundamentals_guard.py` — create

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- The seeded fscore formula declares `FUNDAMENTAL_INPUTS = PE, PB, DIVIDEND_YIELD, ROE, DEBT_TO_EQUITY, EPS` (`services/xstockstrat-indicators/app/formulas/fundamentals_value_quality.py`, verified in context.md round 2). This is the real shape required by fails.md 2026-08-13 (feature 129).
- The `FundamentalPeriod(filed_date, values)` dataclass is at `evaluator.py:47-59`.
- Formula-evaluator test precedent: `tests/test_fundamentals_formula_operand.py`.
- `tests/conftest.py` currently holds only `_setup_gen_path` (L12) and `ctx_with` (L33).

**TDD**: `red-green required`

**Covers**: `AC-1, AC-3, AC-10`

**Instructions**:
- **Predicates (`@AC-1`).**
  - A `fundamentals_macd_blend`-shaped definition (a CUSTOM_FORMULA `fscore` component plus MACD) with `fmap={"fscore": [PE, PB, DIVIDEND_YIELD, ROE, DEBT_TO_EQUITY, EPS enum ints]}` → `requires_fundamentals is True`.
  - A `squeeze_breakout_trend`-shaped definition (MACD/SMA/volatility-stop builtins only) → False.
  - A COMPONENT_KIND_FUNDAMENTAL-only definition → True.
- **States.**
  - SCHD shape (`pit=[]`) → UNAVAILABLE.
  - A row carrying only `beta`, against a formula declaring `{BETA, PE_RATIO}` → AVAILABLE (`@AC-10` partial row, C-16 PRESERVE `@AC-8 @feature-201` clauses).
  - A first filing on or after the last eval date (`filed_date == last`, and `filed_date > last`) → UNAVAILABLE (`@AC-10`).
  - Empty `eval_dates` or `bars_failed=True` → NOT_ASSESSED.
  - Gate off → NOT_REQUIRED.
  - The technical strategy on SCHD → NOT_REQUIRED (`@AC-3`).
  - A `("formula", "fscore")` failure on a technical-looking map → UNKNOWN.
  - The precedence matrix (UNAVAILABLE+UNKNOWN → UNAVAILABLE; UNKNOWN+DISABLED → UNKNOWN; DISABLED+AVAILABLE → DISABLED).
  - The snapshot-vs-PIT channel choice mirrors `evaluator.py:700-703`.
- **Parity (design adversary note A).** For several period sets on the **same** `eval_dates`, `component_would_execute(...)` equals whether `_fundamentals_formula_series` made ≥1 `ExecuteFormula` call. Use an AsyncMock indicators stub and count awaits.
- **`epoch_eval_dates`.** Its result gives the same `assess` answer as brute force over every calendar day in `[start, end]`, including `filed_date == end` and `filed_date == start - 1`.
- **C-13.** The SCHD/AAPL period literals get a second consumer in Step 16. Keep them inline here; Step 16 centralizes them.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest tests/test_fundamentals_guard.py tests/test_fundamentals_formula_operand.py -q && uv run pytest --cov=app --cov-fail-under=40 -q && uv run ruff check . && uv run ruff format --check .
```

---

### Step 13 — service: Bounded PIT pager + error-distinct loaders

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/app/engine/live_loop.py` — modify
- `services/xstockstrat-analysis/app/services/evaluator.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- PIT loaders that read only page 1 (fails.md 2026-10-10 entry):
  - `servicer._load_fundamentals(self, symbol, definition, propagation_meta, *, sem=None, cache=None, formula_fund_map=None)` (L1612-1667): one `GetHistoricalFundamentals` call (L1641-1652), any exception → `out = []` (L1653-1655).
  - `live_loop._load_fundamentals` (L611-632): any exception → `[]` (L629-631).
- Marketdata pages `pageSize := 50` (in `GetHistoricalFundamentals`, `marketdata_service.go:1748`, main-dev), ordered `ORDER BY period_end, fiscal_period` (`internal/repository/marketdata_repo.go:724`). `parseHistCursor` (L810) falls back to page 1 on a bad token.
- `GetHistoricalFundamentalsRequest.page = 6` (`marketdata.proto:290`) and `GetHistoricalFundamentalsResponse.pagination = 2` (L295).
- Pager precedent: `_fetch_bars_paged` (`servicer.py:1249-1303`), with `_BAR_PAGE_SIZE = 1000` (L259), `_MAX_BAR_PAGES = 32` (L263), a strict-monotonic `fresh` check (L1284-1290) and `raise _BarFetchError` (L1300). `_BarFetchError` is at L311.
- `_fundamental_periods_from_response(resp)` (`servicer.py:6018-6036`) maps `resp.periods`, dropping periods with no `filed_date`.
- Snapshot loaders call `GetFundamentalsMulti(symbols=[symbol])`:
  - `servicer._load_fundamentals_snapshot` (L1700-1745), exception → `[]` (L1740-1742)
  - `live_loop._load_fundamentals_snapshot` (L634-659)
- Quota behavior differs between the two marketdata RPCs (main-dev; locate by symbol). For an uncached symbol at the vendor quota:
  - `GetFundamentalsMulti` silently omits it: the `count >= cap` branch serves stale rows and skips the rest (L1376-1382).
  - Single-symbol `GetFundamentals` → `resolveFundamentals` returns `CodeResourceExhausted` (L1430-1434).
  - The default provider is `finnhub`, whose per-minute window is small, so a full opportunity compute can hit it.
- Formula-map builders swallow `grpc.RpcError` and treat the formula as `[]`:
  - `servicer._formula_fundamentals` (L1669-1698, the except at L1694-1695)
  - `StrategyEvaluator.declared_formula_fundamentals` (`evaluator.py:622-649`, the except at L645-646)
- Header propagation (C-03, Python per-method metadata): the servicer loaders already pass `metadata=propagation_meta` (L1645, L1724), and the paged calls keep it. Live-loop calls carry no per-request metadata today (`live_loop.py:626-628`), which is unchanged.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Constants** next to `_MAX_BAR_PAGES` (`servicer.py:263`): `_FUND_PAGE_SIZE = 200`, `_MAX_FUND_PAGES = 8` and `_FUND_PAGE_TIMEOUT_SECONDS = 10`, plus `class _FundamentalsPageError(Exception)` next to `_BarFetchError` (L311). These are fixed invariants (design F-07 row) and each gets a ≤2-line constraint comment.
2. **Mapping helper.** Refactor `_fundamental_periods_from_response(resp)` into `_fundamental_periods(periods)`, keeping a 1-line `_fundamental_periods_from_response` wrapper so existing callers stay unchanged.
3. **Pager.** Add the module-level `async def _fetch_historical_fundamentals_paged(stub, symbol, metadata) -> list[FundamentalPeriod]` next to it.
   - Loop at most `_MAX_FUND_PAGES` times. Each call is `stub.GetHistoricalFundamentals(GetHistoricalFundamentalsRequest(symbol=symbol, page=common_pb2.PageRequest(page_size=_FUND_PAGE_SIZE, page_token=token)), metadata=metadata, timeout=_FUND_PAGE_TIMEOUT_SECONDS)`.
   - Require strict `(period_end, fiscal_period)` monotonicity of each page's first period over the last one seen (round-4 /sdd-spec note). If it fails, raise `_FundamentalsPageError`.
   - An empty `pagination.next_page_token` is EOF.
   - Cap exhaustion raises `_FundamentalsPageError`.
   - Return `_fundamental_periods(all_periods)`.
4. **`servicer._load_fundamentals`.**
   - Add `failures=None` to the keyword arguments.
   - Replace the single call (L1641-1652) with `_fetch_historical_fundamentals_paged(self._marketdata, symbol, propagation_meta)`, wrapped in the existing `sem` block.
   - In `except`: when `failures is not None` and the error is **not** a `grpc.RpcError` whose `code()` is `NOT_FOUND`, set `failures[("pit", symbol)] = Availability.UNKNOWN`. Then `out = []` and keep the WARN, as today.
   - Cache as today. `failures` must have the same lifetime as `cache`, so a cache hit still reports the failure.
5. **`live_loop._load_fundamentals`.** Add `failures=None` and the same pager call, passing `metadata=()`, and record failures the same way. Import `_fetch_historical_fundamentals_paged` from `app.handlers.servicer` in the existing import block (L38-46).
6. **Snapshot loaders.** In both `_load_fundamentals_snapshot` methods, add `failures=None` and switch to the single-symbol RPC: `GetFundamentals(GetFundamentalsRequest(symbol=symbol))`, keeping `metadata` and `sem` as today; the row is `resp.fundamentals`. Map exceptions:
   - `NOT_FOUND` → `out = []`, no failure (absence).
   - `FAILED_PRECONDITION` → `failures[("snap", symbol)] = Availability.DISABLED`, `out = []`.
   - Any other error → `Availability.UNKNOWN`, `out = []`.
   - The one-element `FundamentalPeriod(filed_date=date.min, …)` lowering is unchanged.
   - **Named ripple (Multi → single switch).** `RESOURCE_EXHAUSTED` falls under "any other error", so an uncached symbol at the vendor quota now reads **UNKNOWN**. Before, Multi silently omitted it, which read as absent. Downstream, the opportunity row is stamped `"unavailable"` and retried by the 300s heal loop; live makes no state change; backtest's formula channel is PIT, so it is unaffected. This is the intended FR-8 reading ("outage ≠ absence"), not a regression. It is pinned by Step 14 and Step 22 and documented in Step 25.
7. **Formula maps.** Add `failures=None` to `servicer._formula_fundamentals` and `StrategyEvaluator.declared_formula_fundamentals`. On `grpc.RpcError`, also set `failures[("formula", fid)] = Availability.UNKNOWN`. The cached/returned value is unchanged (round-4 fix 1).
8. **Unguarded surfaces stay unguarded.** `EvaluateReadiness` (L3589), `GetWatchlistReadiness` (L3858), `GetIndicatorSeries` (L4105) and the readiness materializer (L5538) must not pass `failures`. Their outputs change only through pagination completeness (C-16 EXTEND `@AC-4 @feature-198`, `@AC-2 @feature-201`; insights 071 precedent).

**Verification**:
```bash
cd services/xstockstrat-analysis && grep -n "_FUND_PAGE_SIZE = 200\|_MAX_FUND_PAGES = 8\|_FUND_PAGE_TIMEOUT_SECONDS\|async def _fetch_historical_fundamentals_paged\|class _FundamentalsPageError" app/handlers/servicer.py && grep -n "_fetch_historical_fundamentals_paged\|GetFundamentalsRequest" app/engine/live_loop.py && ! grep -n "GetFundamentalsMultiRequest(symbols=\[symbol\])" app/handlers/servicer.py app/engine/live_loop.py
```

---

### Step 14 — test: Pager, loaders, readiness parity

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_fundamentals_pit_pager.py` — create
- `services/xstockstrat-analysis/tests/test_fundamentals_formula_servicer.py` — modify
- `services/xstockstrat-analysis/tests/test_live_loop.py` — modify
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Existing snapshot tests stub `GetFundamentalsMulti`. They must be re-pointed to `GetFundamentals` (Step 13.6):
  - `tests/test_fundamentals_formula_servicer.py`: `_multi_resp` at L95; L117, L138, L143, L166
  - `tests/test_analysis_servicer.py`: L1238, L1267, L5005
- `test_live_loop.py` stubs `GetFundamentalsMulti` at L873-907, L986 and L1293. Re-point only those exercising `_load_fundamentals_snapshot`; the blend-universe resolver keeps Multi.
- Readiness surfaces covered by existing tests: `tests/test_readiness_materializer.py`, `tests/test_watchlist_readiness.py`, `tests/test_indicator_series_source_symbol.py`.

**TDD**: `red-green required`

**Covers**: `AC-8, AC-9, AC-12`

**Instructions**:
- **Pager (`@AC-12`).**
  - A 3-page drain where `dividend_yield` is present only in the page-3 (newest) periods: all periods are returned, and `assess` for a dividend-reading formula gives AVAILABLE.
  - An empty token is EOF.
  - A repeated first `(period_end, fiscal_period)` raises `_FundamentalsPageError`.
  - A never-ending token raises after `_MAX_FUND_PAGES`.
  - Every request carries `page.page_size == 200` and `timeout=_FUND_PAGE_TIMEOUT_SECONDS`.
- **Loaders.**
  - `servicer._load_fundamentals` and `live_loop._load_fundamentals` with an `UNAVAILABLE` RpcError or a page error record `failures[("pit","AAPL")] == UNKNOWN` and return `[]` (`@AC-8` outage ≠ absence; `@AC-12` page cap = unknown).
  - A cache hit after a failure still leaves the failure recorded.
- **Snapshot loader mapping.**
  - `FAILED_PRECONDITION` → DISABLED (`@AC-9`).
  - `NOT_FOUND` → no failure and `[]`.
  - `UNAVAILABLE` → UNKNOWN.
  - `RESOURCE_EXHAUSTED` (vendor quota, uncached symbol) → UNKNOWN with `out == []`, in both `servicer._load_fundamentals_snapshot` and `live_loop._load_fundamentals_snapshot`. This is the Multi → single-symbol ripple from Step 13.6.
  - A snapshot failure never writes a `"pit"` key.
- **Formula map.** A `GetFormula` RpcError records `("formula", fid)`.
- **Readiness parity.** Feed `EvaluateReadiness`, `GetWatchlistReadiness`, the materializer and `GetIndicatorSeries` an SCHD empty history plus an empty snapshot (NotFound). Their outputs equal the pre-change shape: hold, with no new fields, markers or refusals.
- **C-13.** The single-consumer page-builder helpers stay inline in `test_fundamentals_pit_pager.py`.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest tests/test_fundamentals_pit_pager.py tests/test_fundamentals_formula_servicer.py tests/test_live_loop.py tests/test_analysis_servicer.py tests/test_readiness_materializer.py tests/test_watchlist_readiness.py -q && uv run pytest --cov=app --cov-fail-under=40 -q && uv run ruff check . && uv run ruff format --check .
```

---

### Step 15 — service: Backtest refusal (FR-2)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `RunBacktest` (`servicer.py:696`):
  - It initializes `symbol_cells: list[dict] = []` (L822) and builds `formula_fund_map` (L838-851). A prefixed run (`start_set`) fills it through `self._prefetch_formula_warmups(active_definition, formula_warmup_cache, propagation_meta, formula_deleted_cache, formula_fund_map)` (L840-847). An unprefixed run calls `self._formula_fundamentals(active_definition, propagation_meta)` (L849-851).
  - `_prefetch_formula_warmups(self, definition, cache, propagation_meta, deleted_cache=None, fund_map=None)` (L2258) calls `_declared_formula_warmup(fid, cache, propagation_meta, deleted_cache, fund_map)` (L2223) per formula. On `except grpc.RpcError:` (L2254-2255), that sets `cache[formula_id] = 0` and leaves the formula out of `fund_map`. Today a `GetFormula` outage therefore routes the formula as indicator-only, and it lands on FORMULA_ERROR.
  - The per-symbol loop is at L903-1013. Its per-symbol channel `except FormulaExecutionError as fe:` (L991-1005) appends `analysis_pb2.SymbolDiagnostics(symbol=…, bars=[], no_trade_reason=…FORMULA_ERROR…)`, does `formula_errors += 1` and `continue`.
  - Status gate: `if not all_trades and len(daily_equity) <= 1 and (coverage_gaps or formula_errors):` → INSUFFICIENT_DATA (L1114).
  - Run warnings: `result.warnings.extend(...)` (L1124-1131, the feature-217 precedent).
  - Cells are persisted only when OK (L1144-1153).
- `_backtest_symbol_evaluated(...)` (L1809):
  - It resolves `bars, trade_start_idx` (L1839-1841) and raises `_InsufficientData` when `len(bars) < 2` (L1842-1844).
  - It loads `fundamentals = await self._load_fundamentals(symbol, definition, propagation_meta, formula_fund_map=formula_fund_map)` (L1852-1854).
  - The backtest formula channel is PIT, with `fund_snap` unused (comment L1857-1859).
- `_bar_date(bar)` is at `evaluator.py:36-45`.
- The gate is read as `self._cfg.get_bool("analysis.backtest.fundamentals.enabled", False)` (`servicer.py:1637`).
- New outbound call: `GetEtfFlags` uses the inbound `propagation_meta` (x-user-id / x-access-scope / x-trace-id), the same per-method pattern as `servicer.py:1645` (`docs/patterns/header-propagation.md`, Python per-method).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add `class _FundamentalsUnavailable(Exception)` and `class _FundamentalsUnknown(Exception)`, carrying `symbol`, next to `_InsufficientData` (L236).
2. **`_backtest_symbol_evaluated`.**
   - Add keyword args `fund_cache=None, fund_failures=None` and pass them to `_load_fundamentals(..., cache=fund_cache, failures=fund_failures)`.
   - After that load, compute:
     `avail = assess(definition, formula_fund_map or {}, [_bar_date(b) for b in bars[trade_start_idx:]], symbol=symbol, pit=fundamentals, snap=None, failures=fund_failures or {}, gate_enabled=self._cfg.get_bool("analysis.backtest.fundamentals.enabled", False))`
     This uses the in-window bars only.
   - UNAVAILABLE → `raise _FundamentalsUnavailable(symbol)`.
   - UNKNOWN → `raise _FundamentalsUnknown(symbol)`.
   - There is no DISABLED state on backtest (design Fix 5).
3. **`RunBacktest`.**
   - Create run-level `fund_cache: dict = {}`, `fund_failures: dict = {}`, `fund_refusals = 0`, `fund_unknown: list[str] = []` and `refused_diags: dict[str, SymbolDiagnostics] = {}`, and pass the cache and failures to `_backtest_symbol_evaluated`. `fund_failures` must be created **before** the formula-map build (L838).
   - **Formula-map failures (approval fix 1, "and the guard generally").** A `GetFormula` outage while building `formula_fund_map` must read UNKNOWN on backtest too, not fall through to FORMULA_ERROR.
     - Add `failures=None` to `_declared_formula_warmup` and `_prefetch_formula_warmups`, which threads it through.
     - In `_declared_formula_warmup`'s `except grpc.RpcError:`, when `fund_map is not None and failures is not None`, set `failures[("formula", formula_id)] = Availability.UNKNOWN`. Keep `cache[formula_id] = 0`. Callers that pass no `fund_map` (warmup-only) are unchanged.
     - Pass `failures=fund_failures` on both branches at L840-851: `_prefetch_formula_warmups(…, formula_fund_map, failures=fund_failures)` and `_formula_fundamentals(active_definition, propagation_meta, failures=fund_failures)` (the kwarg from Step 13.7).
     - `assess` then sees `("formula", fid)` for every symbol of a fundamentals strategy, so each symbol raises `_FundamentalsUnknown`. The run gets the "fundamentals fetch failed — rerun" warnings and no reason 5, and no cell is written.
   - Add `except _FundamentalsUnavailable` before `except FormulaExecutionError`:
     - Log WARN: `"backtest refused symbol=%s strategy=%s: fundamentals unavailable — NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE"` (FR-6/`@AC-5`).
     - Append `SymbolDiagnostics(symbol=symbol, bars=[], no_trade_reason=analysis_pb2.NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE, bars_total=0, warmup_bars=0)`, recording it in `refused_diags`.
     - `fund_refusals += 1`, then `continue`. No cell is written.
   - Add `except _FundamentalsUnknown`: log WARN, append `symbol` to `fund_unknown`, `continue`. No reason, no diagnostics, no cell.
   - Extend the status gate (L1114) to `(coverage_gaps or formula_errors or fund_refusals or fund_unknown)`.
   - After the result is built, `if fund_unknown:` extend `result.warnings` with `f"fundamentals fetch failed for {sym} — rerun"` per symbol (`@AC-8`).
4. **ETF label.** Add `async def _fundamentals_gap_labels(self, symbols, propagation_meta) -> dict[str, int]`. It makes one `self._marketdata.GetEtfFlags(marketdata_pb2.GetEtfFlagsRequest(symbols=sorted(symbols)), metadata=propagation_meta)` call and maps:
   - `is_etf` unset → `FUNDAMENTALS_GAP_UNSPECIFIED`
   - true → `ETF`
   - false → `NOT_ETF`
   - Any exception → `{}` (best-effort, FR-11: never affects the decision).
   - In `RunBacktest`, when `refused_diags` is non-empty, call it once and set `diag.fundamentals_gap` before `result.diagnostics.extend(all_diagnostics)` (L1122).
5. Hand `fund_cache` / `fund_failures` to the recompute. Step 17 wires that kwarg; this step only creates them.

**Verification**:
```bash
cd services/xstockstrat-analysis && grep -n "class _FundamentalsUnavailable\|class _FundamentalsUnknown\|NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE\|_fundamentals_gap_labels\|fund_refusals" app/handlers/servicer.py && grep -n -A 3 "GetEtfFlags(" app/handlers/servicer.py | grep "metadata=propagation_meta"   # C-03: label call forwards the inbound trio
```

---

### Step 16 — test: Backtest refusal

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_backtest_fundamentals_guard.py` — create
- `services/xstockstrat-analysis/tests/conftest.py` — modify
- `services/xstockstrat-analysis/tests/test_fundamentals_guard.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Backtest servicer tests stub `_marketdata`/`_indicators` with AsyncMock. Precedent: `tests/test_fundamentals_formula_servicer.py` (the feature-201 PIT backtest, L223-262 per fails.md 2026-10-07) and `tests/test_analysis_servicer.py` `TestRunBacktest*` (e.g. ENTRY_NEVER_TRUE at L1471-1480).
- `tests/conftest.py` is the canonical Python fixture home (C-13); it currently holds `ctx_with` (L33).

**TDD**: `red-green required`

**Covers**: `AC-2, AC-3, AC-5, AC-8, AC-10, AC-12`

**Instructions**:
1. **C-13 centralization.** This file is the **second consumer** of the SCHD/AAPL period literals from Step 12. Move them into `tests/conftest.py` as plain module-level helpers:
   - `fund_period(filed_date, **values)`
   - `SCHD_PIT_PERIODS = []`
   - `AAPL_PIT_PERIODS` (dated quarterly filings carrying all six fscore metrics)
   Re-import them in `test_fundamentals_guard.py`.
2. **Tests** — gate on, `fmap={"fscore": six metrics}`:
   - (a) **`@AC-2`/`@AC-5`.** `RunBacktest(fundamentals_macd_blend, ["SCHD"])` with empty PIT and `GetEtfFlags` → `is_etf=True`:
     - SCHD diagnostics carry `no_trade_reason == NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE` and `fundamentals_gap == FUNDAMENTALS_GAP_ETF`, and are **not** `ENTRY_NEVER_TRUE`.
     - `status == INSUFFICIENT_DATA`.
     - `_persist_symbol_cells` is not called with SCHD.
     - `caplog` has a WARN containing `SCHD`, the strategy id and `fundamentals unavailable`.
   - (b) `["AAPL","SCHD"]`: AAPL is evaluated and traded with its cell written, SCHD is refused, and `status == OK`.
   - (c) **`@AC-3`.** `squeeze_breakout_trend` on SCHD is evaluated normally (reason ≠ 5, no `GetHistoricalFundamentals` call). `fundamentals_macd_blend` on AAPL has reason ≠ 5.
   - (d) **`@AC-8`.** `GetHistoricalFundamentals` raises UNAVAILABLE:
     - no reason 5;
     - `result.warnings` contains `fundamentals fetch failed for SCHD — rerun`;
     - no cell.
   - (e) **`@AC-10`.** SCHD's first filing is dated the window's last bar date → refused.
   - (f) `GetEtfFlags` raising → reason 5 is still set with `fundamentals_gap == UNSPECIFIED` (label is best-effort).
   - (g) Gate off → no refusal (today's hold path, `ENTRY_NEVER_TRUE`).
   - (h) **`@AC-12` page-cap variant of (d), at backtest level.** `GetHistoricalFundamentals` returns a `next_page_token` on every page, so the pager raises `_FundamentalsPageError` after `_MAX_FUND_PAGES`. Through `RunBacktest`:
     - no reason 5 (**never refused**);
     - `result.warnings` contains `fundamentals fetch failed for SCHD — rerun`;
     - the stub saw exactly `_MAX_FUND_PAGES` calls;
     - no cell.
   - (i) **Formula-map outage (approval fix 1, Step 15.3).** `_indicators.GetFormula` raises UNAVAILABLE for `fundamentals_macd_blend`'s formula. Test it on a prefixed run (`start` set → `_prefetch_formula_warmups`) and on an unprefixed run (`_formula_fundamentals`). On both, every symbol is reported via the `fundamentals fetch failed — rerun` warning, with no reason 5, no `NO_TRADE_REASON_FORMULA_ERROR` and no cell. With the gate **off**, the same outage keeps today's FORMULA_ERROR (`assess` → NOT_REQUIRED). With the gate on, an unreachable formula is treated as possibly-fundamentals (Step 11 `assess`), so it reads UNKNOWN, never refused.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest tests/test_backtest_fundamentals_guard.py tests/test_fundamentals_guard.py -q && uv run pytest --cov=app --cov-fail-under=40 -q && uv run ruff check . && uv run ruff format --check .
grep -n "SCHD_PIT_PERIODS\|AAPL_PIT_PERIODS\|def fund_period" tests/conftest.py && grep -rn "AAPL_PIT_PERIODS = " tests | wc -l   # C-13: exactly 1 declaration (conftest)
```

---

### Step 17 — service: Derivation-time evidence exclusion (H)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/app/repositories/backtest_run_symbols.py` — modify
- `services/xstockstrat-analysis/app/main.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `_fetch_and_aggregate(self, user_id, strategy_id, strategy_row)` (`servicer.py:2461-2474`) does `fingerprint = _definition_fingerprint(...)`, then `fetch_eligible`, then `_derive_score_from_cells`. `_derive_score_from_cells` (L2423-2459) is pure.
- `fetch_eligible` (`repositories/backtest_run_symbols.py:63-82`) runs `SELECT DISTINCT ON (symbol) * … ORDER BY symbol, (total_trades > 0) DESC, trading_days DESC, completed_at DESC` (L73-76).
  - The columns `range_start`/`range_end` are nullable and `completed_at` is `NOT NULL DEFAULT NOW()` (`migrations/007_backtest_run_symbols.up.sql:19-21`).
  - `RunBacktest` writes `range_end_dt = None` when the end is unset (`servicer.py:1140`).
- Recompute entry points:
  - `_recompute_headline(user_id, strategy_id)` (L2476-2492) takes the lock, then calls `_recompute_headline_locked(user_id, strategy_id, row)` (L2494-2511). A zero-evidence clear is at L2502-2509.
  - Triggers:
    - RunBacktest `if result.status == OK: try: await self._recompute_headline(...)` (L1183-1187)
    - ScoreStrategy calls `_fetch_and_aggregate` directly and aborts UNAVAILABLE "evidence store unavailable" (L2338-2345), or NOT_FOUND "no eligible evidence — run a backtest" (L2356-2358).
    - ManageStrategy UPDATE pops, then `_recompute_headline_locked` in `try/except → log.warning` (L2936-2943).
    - Boot: `recompute_unscored_pairs` (L2640-2654), capped at `_BOOT_RECOMPUTE_MAX_PAIRS = 50` (L294).
- `_row_to_strategy_definition(row)` (module-level, `servicer.py:6665`) is used at L2944.
- Owner-identity metadata precedent: `meta = [("x-user-id", owner)]` (`servicer.py:5474`). It is used for background work with no inbound request.
- Inbound-trio precedent: `_PROPAGATED_HEADERS = ("x-user-id", "x-access-scope", "x-trace-id")` (`servicer.py:303`), filtered from `context.invocation_metadata()` (L3145, L3254). `RunBacktest` builds the same trio as `propagation_meta` (L717-721).
- The background semaphore is `self._readiness_materializer_bars_sem` (L492-497). Interactive recomputes must not use it (round-4 fix 3; the backtest's own PIT load passes no sem, L1852).
- `main.py:134-138` awaits `servicer.recompute_unscored_pairs()` inline, **before** the live loop is created (L143-162).
- Ledger: fails.md:617 (feature 065) "zero-trade cells count". H overrides that only through the recorded operator decision (context.md 2026-10-10).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Repository.**
   - Hoist the ORDER BY tail into a module constant `_ELIGIBILITY_ORDER = "(total_trades > 0) DESC, trading_days DESC, completed_at DESC"`, used by `fetch_eligible` (output byte-identical).
   - Add `async def fetch_all_for_fingerprint(self, user_id, strategy_id, fingerprint) -> list[dict]`. It runs the same WHERE with no `DISTINCT ON`, ordered by `symbol, {_ELIGIBILITY_ORDER}`. This is the one shared ordering key (round-4 fix 2).
2. **Servicer.**
   - Add `class _GradeInputsUnknown(Exception)`.
   - Add `async def _exclude_refused_cells(self, user_id, definition, cells, *, fund_cache, formula_cache, failures, meta, sem) -> tuple[list[dict], list[str]]`. Per cell, in the given order:
     - **Window.** `start = range_start.date()` or `date.min`. `end = (range_end or completed_at).date()`.
     - **Data.** Load PIT through `self._load_fundamentals(sym, definition, meta, sem=gate_sem, cache=fund_cache, formula_fund_map=fmap, failures=failures)`, gathered once per distinct symbol. `fmap` comes from `self._formula_fundamentals(definition, meta, cache=formula_cache, failures=failures)`.
     - **Concurrency bound (round-4 fix 3, "bounded gather").** `gate_sem = sem if sem is not None else asyncio.Semaphore(_INTERACTIVE_DERIVATION_CONCURRENCY)`. That is a fresh local semaphore per call, never `_readiness_materializer_bars_sem`.
       - Add the module constant `_INTERACTIVE_DERIVATION_CONCURRENCY = 4` next to `_MAX_FUND_PAGES`.
       - It is a fixed invariant (F-07, same precedent as `_MAX_BAR_PAGES`), with the ≤2-line constraint comment: "caps concurrent paged GetHistoricalFundamentals per interactive recompute; marketdata's pooled DB budget is 2 (root CLAUDE.md pool table)."
       - The sem wraps the whole per-symbol pager (Step 13.4), and each symbol's pages are sequential. So a many-symbol strategy has at most 4 `GetHistoricalFundamentals` calls in flight, never one per symbol at once.
     - **Decision.** `assess(definition, fmap, epoch_eval_dates(start, end, pit), symbol=sym, pit=pit, snap=None, failures=failures, gate_enabled=…)`.
       - UNKNOWN → `raise _GradeInputsUnknown(sym)`.
       - UNAVAILABLE → drop the cell and log INFO `grade-derivation excluded symbol=%s strategy=%s window=%s..%s`.
     - **Dedup.** Then keep the **first surviving** cell per symbol. The rows are already in `_ELIGIBILITY_ORDER`, so this filters before dedup.
     - Return `(kept, sorted(excluded_symbols))`.
   - Change `_fetch_and_aggregate` to `(…, *, fund_cache=None, formula_cache=None, failures=None, meta=None, sem=None, excluded=None)`:
     - `definition = _row_to_strategy_definition(strategy_row)`.
     - If the gate is off, **or** the definition has neither a FUNDAMENTAL nor a CUSTOM_FORMULA component, keep today's `fetch_eligible` path, byte-identical and with zero RPCs (C-16 PRESERVE `@AC-3 @feature-149`).
     - Otherwise call `fetch_all_for_fingerprint`, then `_exclude_refused_cells`, and extend `excluded` when given. If nothing remains, return `None` (the zero-evidence clear).
     - Default `meta` to `[("x-user-id", user_id)]`. That is the boot path only, with no inbound request; it matches the L5474 precedent.
   - Thread the same kwargs through `_recompute_headline` and `_recompute_headline_locked`.
3. **Triggers.**
   - **C-03 decision: forward the inbound trio.** Interactive triggers pass `meta = [(k, v) for k, v in context.invocation_metadata() if k in _PROPAGATED_HEADERS]`, i.e. `x-user-id` **and `x-access-scope`** and `x-trace-id`. This supersedes the design's "owner + trace" note: dropping `x-access-scope` would make the downstream marketdata/indicators calls see a narrower scope than the caller holds (`docs/patterns/header-propagation.md`, Python per-method). Recorded at /sdd-review impl-spec 2026-10-11.
   - **RunBacktest (L1183):** trigger when `result.status == OK or fund_refusals > 0`. Pass `fund_cache=fund_cache, failures=fund_failures, meta=propagation_meta` (the trio built at L717-721) and no sem, so the gather uses the local `_INTERACTIVE_DERIVATION_CONCURRENCY` bound. The existing `try/except → log.warning` keeps the old grade on `_GradeInputsUnknown`; make the warning name `fundamentals availability unknown — grade unchanged`.
   - **ScoreStrategy:**
     - Pass `excluded=[]`, `meta=` the inbound trio, and no sem.
     - Catch `_GradeInputsUnknown` **before** the generic `except` and abort UNAVAILABLE `"fundamentals availability unknown — grade unchanged"`.
     - When `score is None and excluded`, keep the existing stale-grade clear, then abort NOT_FOUND `f"no eligible evidence — all evidence symbols excluded (fundamentals unavailable: {', '.join(excluded)})"`.
   - **ManageStrategy UPDATE:** pass `meta=` the inbound trio, no sem. The existing `try/except` keeps the old DB grade (Open Risk 1, accepted).
   - **Boot (`recompute_unscored_pairs`):** create one `fund_cache`, `formula_cache` and `failures` dict for the pass, and pass `sem=self._readiness_materializer_bars_sem`. The meta is owner-only, per pair.
4. **`main.py`.** Replace the awaited `servicer.recompute_unscored_pairs()` block (L134-138) with `asyncio.get_event_loop().create_task(...)` around a small async wrapper that keeps the info/warning logs. Live-loop creation (L143-162) is then no longer delayed (round-4 fix 3).
5. Nothing is ever deleted: the code adds no `DELETE` on `backtest_run_symbols`.
6. Gate-off re-inclusion is documented in Step 25 (Open Risk 3).

**Verification**:
```bash
cd services/xstockstrat-analysis && grep -n "_ELIGIBILITY_ORDER\|async def fetch_all_for_fingerprint" app/repositories/backtest_run_symbols.py && grep -n "class _GradeInputsUnknown\|async def _exclude_refused_cells\|fundamentals availability unknown — grade unchanged\|all evidence symbols excluded\|_INTERACTIVE_DERIVATION_CONCURRENCY = 4" app/handlers/servicer.py && grep -n "create_task" app/main.py && ! grep -rn "DELETE FROM analysis.backtest_run_symbols" app
```

---

### Step 18 — test: Derivation exclusion

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_grade_fundamentals_exclusion.py` — create
- `services/xstockstrat-analysis/tests/test_backtest_run_symbols_repo.py` — modify
- `services/xstockstrat-analysis/tests/test_owner_dimension.py` — modify (only if Step 17's `_fetch_and_aggregate` / boot-recompute signature changes break its `fetch_eligible` / `recompute_unscored_pairs` stubs, L404-427)
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify (only if the `_eligible_cell` / `fetch_eligible` stubs at L87-123 need the new kwargs)

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- The cell-shaped dict helper is `_eligible_cell(...)` at `tests/test_analysis_servicer.py:87-110`. Its stub is `svc._backtest_run_symbols_repo.fetch_eligible = AsyncMock(return_value=cells)` (L123).
- The repo SQL test precedent is `test_fetch_eligible_traded_first_distinct_on_sql` (`tests/test_backtest_run_symbols_repo.py:71-80`).
- Boot recompute tests: `tests/test_owner_dimension.py:404-427`.
- The conftest helpers come from Step 16.

**TDD**: `red-green required`

**Covers**: `AC-11, AC-12`

**Instructions**:
- **Repo.** `fetch_all_for_fingerprint` SQL has no `DISTINCT ON` and contains the shared `_ELIGIBILITY_ORDER`. `fetch_eligible` SQL still contains `DISTINCT ON (symbol)` and the same order.
- **`@AC-11`.** Cells: AAPL (traded) plus two SCHD zero-trade cells, one with `range_end=None` and `completed_at` set. With SCHD empty PIT and AAPL from `AAPL_PIT_PERIODS`:
  - The derived score counts only AAPL (`evidence_symbols == 1`).
  - The NULL `range_end` uses `completed_at`.
  - The repo spy shows no delete or `insert_many` call (cells never deleted).
- **All excluded.** All cells excluded → the grade is cleared (`_scores_repo.delete` awaited). ScoreStrategy returns NOT_FOUND naming SCHD.
- **`@AC-11` trigger.** A refused single-SCHD RunBacktest (INSUFFICIENT_DATA) still awaits the recompute.
- **UNKNOWN.**
  - `GetHistoricalFundamentals` UNAVAILABLE → `_GradeInputsUnknown`.
  - The RunBacktest, ManageStrategy UPDATE and boot paths keep the previous grade and log a warning.
  - ScoreStrategy aborts UNAVAILABLE with `fundamentals availability unknown — grade unchanged`.
- **Round-4 fix 1.** `GetFormula` UNAVAILABLE during the recompute → the old grade is kept and the SCHD cell is not counted.
- **Round-4 fix 2.** For a symbol with one refused window and one eligible window, the eligible cell is kept even when it ranks lower in `_ELIGIBILITY_ORDER`.
- **Pinning.**
  - The run-level `fund_cache` is reused by the recompute: zero extra `GetHistoricalFundamentals` calls for the run's symbols.
  - A run-level `fund_failures` entry for a symbol with an older eligible cell freezes the grade.
  - The boot pass across pairs sharing symbols makes ≤ (distinct symbols) PIT calls and acquires `_readiness_materializer_bars_sem`. Interactive triggers do not acquire it.
  - **Interactive bound.** A ScoreStrategy recompute over 10 distinct evidence symbols has a `GetHistoricalFundamentals` stub that records peak in-flight calls (an `asyncio.Event`-gated AsyncMock). The peak is `== _INTERACTIVE_DERIVATION_CONCURRENCY` (4), never 10.
  - **C-03.** The interactive recompute's `GetHistoricalFundamentals` and `GetFormula` calls carry the inbound `x-user-id`, `x-access-scope` and `x-trace-id`. The boot pass carries `x-user-id` = owner only.
  - Concurrent `asyncio.gather` RunBacktest + ScoreStrategy runs under the per-strategy lock.
  - A non-fundamentals strategy makes zero marketdata calls and gives a byte-identical score.
- **`@AC-12` (recompute clause).** A >50-period AAPL served across 2 pages is not excluded.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest tests/test_grade_fundamentals_exclusion.py tests/test_backtest_run_symbols_repo.py tests/test_owner_dimension.py tests/test_analysis_servicer.py -q && uv run pytest --cov=app --cov-fail-under=40 -q && uv run ruff check . && uv run ruff format --check .
```

---

### Step 19 — service: Live deny-entry + state-change WARN/alert (FR-4)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/live_loop.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `_eval_pair(self, definition, symbol, throttle, deny_entry=False)` (`live_loop.py:661`):
  - It returns `_EVAL_NO_BARS` on empty bars (L672-674).
  - It loads `fundamentals = await self._load_fundamentals(definition, symbol)` (L681), then `formula_fund_map = await evaluator.declared_formula_fundamentals(definition)` (L685) and `fund_snap` (L686).
  - It evaluates at L690-692; `key = (definition.user_id, definition.strategy_id, symbol)` is at L697.
  - It calls `_apply_transition(..., deny_entry=deny_entry)` (L730-739).
- `_apply_transition` short-circuits only the entry branch when `deny_entry` (L213-215). The exit branch is untouched (L219-222).
- `_emit_alert` (L780-801) is the `notify_pb2.EmitAlertRequest(severity=ALERT_SEVERITY_WARNING, category="strategy", …)` shape.
- `__init__` state dicts are keyed `(user, strat, sym)` (L284-297). The per-pair error isolation is the `except Exception` at L444-445 (the transition retry semantics the design names).
- The gate is read as `self._cfg.get_bool("analysis.backtest.fundamentals.enabled", False)` (L623).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In `__init__`, add `self._fund_unavailable: set[tuple[str, str, str]] = set()`. Its comment: in-memory; a restart re-alerts at most once per unavailable pair (design spec note).
2. In `_eval_pair`:
   - Create `failures: dict = {}` and pass it to `_load_fundamentals`, `declared_formula_fundamentals` and `_load_fundamentals_snapshot` (Step 13 kwargs).
   - Compute `key` before evaluation, then:
     `avail = assess(definition, formula_fund_map, [_bar_date(b) for b in bars], symbol=symbol, pit=fundamentals, snap=fund_snap, failures=failures, gate_enabled=self._cfg.get_bool("analysis.backtest.fundamentals.enabled", False))`
     with `_bar_date` imported from `app.services.evaluator`.
   - **UNAVAILABLE:**
     - Set `deny_entry = True`.
     - If `key not in self._fund_unavailable`:
       - Add the key **first**, so a failed send never re-alerts.
       - `log.warning("live_loop: (%s,%s) entry denied — NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE (fundamentals unavailable)", definition.strategy_id, symbol)`.
       - Await a new `_emit_fundamentals_unavailable_alert(definition, symbol)` inside `try/except Exception → log.warning`. Its shape mirrors `_emit_alert`: WARNING severity, category `"strategy"`, title `f"Strategy {strategy_id}: fundamentals unavailable for {symbol}"`, tag `strategy_id:…`.
   - **AVAILABLE or NOT_REQUIRED:** `self._fund_unavailable.discard(key)`, so a relapse re-alerts.
   - **UNKNOWN, DISABLED or NOT_ASSESSED:** no state change and no alert.
   - Pass the (possibly forced) `deny_entry` into the existing `_apply_transition` call. The exit path is untouched, so a held exit still fires.
3. `_replay_state` stays unchanged (it never passes `deny_entry`, L208-211 docstring).

**Verification**:
```bash
cd services/xstockstrat-analysis && grep -n "_fund_unavailable\|_emit_fundamentals_unavailable_alert\|NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE" app/engine/live_loop.py
```

---

### Step 20 — test: Live deny-entry

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_live_loop.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `tests/test_live_loop.py` builds `LiveEvaluationLoop` with AsyncMock stubs. Precedent: the fundamentals stubs at L873-907 and the `GetFundamentalsMulti.await_count == 0` assertions at L1073/1135/1149.
- `_apply_transition` deny-entry tests already exist (feature 132), so the deny semantic is pinned.

**TDD**: `red-green required`

**Covers**: `AC-5, AC-6, AC-9, AC-12`

**Instructions**:
- **`@AC-6`.** Over three `_eval_pair` cycles for `fundamentals_macd_blend` on SCHD (empty PIT, snapshot NotFound) with a decision whose entry is true on the last bar:
  - No entry transition.
  - `caplog` has exactly one WARN naming `SCHD`, the strategy id and `NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE` (`@AC-5`).
  - `notify.EmitAlert` was awaited exactly once.
- **Held exit.** Start with `_last_state[key]=True` and an exit decision → the exit fires (the exit alert is emitted).
- **Recover, then relapse.** AVAILABLE then UNAVAILABLE → a second alert.
- **Failed send.** `EmitAlert` raising does not re-alert on the next cycle.
- **`@AC-9`.** Snapshot FAILED_PRECONDITION (DISABLED) → no state change and no alert. UNKNOWN (PIT UNAVAILABLE) → no alert. Empty bars (NOT_ASSESSED) → no alert.
- **Normal entry.** AAPL with fundamentals → the entry alert fires.
- **`@AC-12` (live clause).** A 2-page PIT history is fully loaded by the live loader.
- **C-13.** Use `SCHD_PIT_PERIODS`/`AAPL_PIT_PERIODS` from `tests/conftest.py` (Step 16).

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest tests/test_live_loop.py -q && uv run pytest --cov=app --cov-fail-under=40 -q && uv run ruff check . && uv run ruff format --check .
grep -n "from tests.conftest import\|from .conftest import\|conftest" tests/test_live_loop.py | head -3
```

---

### Step 21 — service: Opportunity skip row + heal (FR-3)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- In `_compute_opportunities`:
  - The per-pass caches are `fundamentals_cache` (L5074), `formula_fund_cache` (L5077) and `fund_snap_cache` (L5078).
  - `fetch_failed: set[str]` is keyed by **symbol** (L5104). Any per-row fundamentals UNKNOWN must not use it (design objection 2).
  - `fetch_failed` is also written **concurrently** inside the gather. Another candidate's indicators `RpcError` on the same symbol does `fetch_failed.add(sym)` (L5238-5247), and the stamp `sym_unavailable = evaluated and sym in fetch_failed` (L5280) reads it later. So a skip row (`fund_skip`, which never calls indicators) can still see SCHD in `fetch_failed` added by a sibling candidate.
- `_row_for(c)` (L5182-5308):
  - `evaluated = bool(strat) and not (c["muted"] and not c["is_held"])` (L5190).
  - It loads `bars` (L5194), `fundamentals` (L5206-5212), `formula_fund_map` (L5214-5216) and `fund_snap` (L5217-5224).
  - `rule = "exit" if c["is_held"] else "entry"` (L5226).
  - Then `action = _resolve_action_tag(c, exit_fires)`; on None, it keeps a muted row as UNSPECIFIED, else drops it (L5266-5273).
  - The data-unavailable stamp is `_add_provenance(c, "unavailable")` (L5285-5287), with zeroed axes and NULL composite (L5294-5308).
- `_add_provenance` (L4903-4905) is per-candidate; candidates are keyed `(sym, strat)`.
- `_retry_unavailable_symbols` (L4566-4700):
  - `rule = "exit" if "position" in provenance else "entry"` (L4572).
  - `still_unavailable` handling is at L4624-4641; the healed row at L4643-4657.
  - Readiness staging (L4661-4700) applies only to healed entry watchlist rows.
- Step 3 added `replace_symbols` COALESCE on `"action"`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **`_compute_opportunities`.**
   - Add a per-pass `fund_failures: dict = {}` and pass it to all three loaders in `_row_for` (`failures=fund_failures`).
   - In `_row_for`, inside `definition is not None`, after the loads and **before** `evaluate_conditions_traced`:
     `avail = assess(definition, formula_fund_map, [_bar_date(b) for b in bars], symbol=sym, pit=fundamentals, snap=fund_snap, failures=fund_failures, gate_enabled=…, bars_failed=(sym in fetch_failed or not bars))`
   - **Skip (`rule == "entry"` and UNAVAILABLE).** Set a local `fund_skip = True` and do not evaluate; readiness stays `_empty_readiness(sym)`.
   - **Row-local unknown (UNKNOWN on either rule).** Set `fund_unknown = True` and do not evaluate.
   - **Everything else.** Held (`rule == "exit"`) UNAVAILABLE, DISABLED, AVAILABLE, NOT_REQUIRED and NOT_ASSESSED evaluate exactly as today. This preserves held REDUCE (C-16 PRESERVE), applies no DISABLED marker or retry (`@AC-9`), and leaves a bars outage on today's `fetch_failed` path (`@AC-13`, mutual exclusion).
   - **Action.** Resolve it as today (L5266-5273), including the speculative-sell drop. Then, if `fund_skip`, force `action = OPPORTUNITY_ACTION_TAG_UNSPECIFIED` and `_add_provenance(c, "fundamentals_unavailable")`.
   - **Unavailable.** `sym_unavailable = evaluated and not fund_skip and (sym in fetch_failed or fund_unknown)`. `not fund_skip` guarantees the `"unavailable"` / `"fundamentals_unavailable"` mutual exclusion even when a sibling candidate concurrently adds the symbol to `fetch_failed` (Evidence). It is row-local for `fund_unknown`.
   - **Axes and composite.** A skip row gets conviction 0, signal_axis 0 and composite None. Extend the `sym_unavailable` zeroing at L5294-5308 to `sym_unavailable or fund_skip`.
2. **ETF label.** After the gather, collect the symbols of rows whose provenance contains `"fundamentals_unavailable"`. Call `self._fundamentals_gap_labels(symbols, propagation_meta)` (Step 15) once, and set `row["readiness_json"]["fundamentals_gap"] = label` when the label is non-zero.
3. **`_retry_unavailable_symbols` (heal).**
   - Pass `failures=heal_failures` (per call) to the loaders.
   - After a successful bars fetch, run the same `assess`:
     - **`rule == "entry"` and UNAVAILABLE.** Append a heal row:
       - `"action": int(OPPORTUNITY_ACTION_TAG_UNSPECIFIED)`
       - provenance with `"unavailable"` removed and `"fundamentals_unavailable"` added
       - conviction 0, signal_axis 0, `composite_score: None`
       - `readiness_json` = `_empty_readiness(sym)` plus the label
       - `"_healed": True`, so it gets a fresh `valid_until`
       It is **not** staged into the readiness cache, then `continue`.
     - **UNKNOWN.** Treat as `still_unavailable`.
     - **Everything else.** Held UNAVAILABLE, DISABLED, AVAILABLE and NOT_REQUIRED heal as today, with no `"action"` key (COALESCE keeps the stored action).
   - Label the healed skip rows with one `_fundamentals_gap_labels` call before `replace_symbols`.
4. Skip rows carry no `"unavailable"` marker, so they never re-enter the 300s loop (C-16 PRESERVE `@AC-8 @feature-185`).

**Verification**:
```bash
cd services/xstockstrat-analysis && grep -n "fund_skip\|fund_unknown\|\"fundamentals_unavailable\"\|heal_failures" app/handlers/servicer.py
```

---

### Step 22 — test: Opportunity skip row + heal

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_opportunities_fundamentals_guard.py` — create
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify (only if Step 21's `_row_for` / `_retry_unavailable_symbols` changes break its feature-185 heal stubs, e.g. L5488, L5512, L5620)
- `services/xstockstrat-analysis/tests/test_opportunities_latency.py` — modify (only if its `_compute_opportunities` stubs, L90-94 and L181, need the new loader kwargs)

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Compute/heal test precedents:
  - `tests/test_opportunities_latency.py` and `tests/test_opportunity_compute_state.py` (they drive `_compute_opportunities`)
  - `tests/test_analysis_servicer.py` (feature-185 `_retry_unavailable_symbols` tests)
- The conftest period helpers come from Step 16.

**TDD**: `red-green required`

**Covers**: `AC-4, AC-5, AC-8, AC-9, AC-13`

**Instructions**:
- **`@AC-4`.** Universe = SCHD as an entry candidate (watchlist-bound to `fundamentals_macd_blend`) plus AAPL:
  - SCHD: `action == UNSPECIFIED`, `composite_score is None`, conviction 0, provenance contains `"fundamentals_unavailable"` but **not** `"unavailable"`, and `readiness_json["fundamentals_gap"] == ETF` when `GetEtfFlags` says `is_etf=True`.
  - With `is_etf` unset: the key is absent (rendered as plain "fundamentals unavailable").
  - AAPL is evaluated normally.
  - Round-trip through `_row_to_opportunity`: `fundamentals_unavailable`, with `data_unavailable False`.
- **Held SCHD.** A held SCHD candidate gets its exit-rule REDUCE row (`exit_fires`).
- **Speculative sell.** A speculative-sell SCHD candidate with no position is still dropped.
- **`@AC-8`.**
  - PIT and snapshot UNAVAILABLE for two fundamentals strategies and one technical strategy on SCHD: both fundamentals rows are `"unavailable"`, keep their resolved action, have conviction 0; the technical row is evaluated normally.
  - `fetch_failed` does not contain SCHD.
- **`@AC-9`.** Snapshot FAILED_PRECONDITION → rows evaluated, with no `"unavailable"` and no `"fundamentals_unavailable"`, and no retry kick.
- **`@AC-13` (outage).** BatchGetBars failure for SCHD → the row is `"unavailable"`, the action is preserved, and there is no skip marker.
- **Mutual exclusion vs a concurrent `fetch_failed` insert (Step 21 `not fund_skip`).** SCHD is an entry candidate for `fundamentals_macd_blend` (→ skip row) **and** for a technical strategy whose indicators call raises an `RpcError` (→ `fetch_failed.add("SCHD")` during the same gather).
  - The fundamentals row has `"fundamentals_unavailable"` and **not** `"unavailable"`, with `action == UNSPECIFIED` and composite None.
  - The technical row is `"unavailable"`.
- **Snapshot quota ripple (Step 13.6).** `GetFundamentals` raises `RESOURCE_EXHAUSTED` for an uncached SCHD under a snapshot-reading formula strategy:
  - the row is `"unavailable"` (UNKNOWN), not a skip row;
  - its action is preserved and conviction is 0;
  - `fetch_failed` does not contain SCHD;
  - `_retry_unavailable_symbols` re-runs it on the next heal.
- **`@AC-13` (heal).** Bars recover in `_retry_unavailable_symbols`:
  - `replace_symbols` receives `"action": 0`, provenance with `"fundamentals_unavailable"` and without `"unavailable"`, and composite None.
  - The readiness cache `upsert_many` is not called for it.
- **Heal with nothing new.** A heal of a non-fundamentals row carries no `"action"` key. A held UNAVAILABLE row heals as today.
- **`@AC-5`.** The skip reason is on the returned row (proto field), not only in logs.
- **C-13.** Use the conftest helpers.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest tests/test_opportunities_fundamentals_guard.py tests/test_opportunities_latency.py tests/test_analysis_servicer.py -q && uv run pytest --cov=app --cov-fail-under=40 -q && uv run ruff check . && uv run ruff format --check .
```

---

### Step 23 — service: UI surfaces (backtest reason, queue skip badge, Signal-detail)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/BacktestDiagnostics.tsx` — modify
- `services/xstockstrat-ui/src/lib/opportunityShared.tsx` — modify
- `services/xstockstrat-ui/src/app/insights/opportunities/page.tsx` — modify
- `services/xstockstrat-ui/src/components/mobile/sections.ts` — modify
- `services/xstockstrat-ui/src/components/mobile/SectionRenderer.tsx` — modify
- `services/xstockstrat-ui/src/hooks/useOpportunities.ts` — modify
- `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` — modify
- `services/xstockstrat-ui/src/components/insights/SignalReadiness.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness, analytics display accuracy, Connect-RPC call safety

**Codebase Evidence**:
- `BacktestDiagnostics.tsx`:
  - `const NO_TRADE_MESSAGE: Record<NoTradeReason, string>` (L40-49) is exhaustive. The new enum value fails `tsc` until it is mapped (insights 071).
  - It is read at L108 (`NO_TRADE_MESSAGE[sd.noTradeReason] ?? ''`) and rendered in an `<Alert data-testid="no-trade-reason">` (L118-121).
- `opportunityShared.tsx` holds exhaustive `Record<Enum, EnumRender>` maps (L27-60, e.g. `HALT_SOURCE` L56-60) and `EnumBadge` (L66).
- Desktop queue row (`src/app/insights/opportunities/page.tsx`):
  - `const muted = o.muted;` (L484)
  - the action badge `<EnumBadge render={OPPORTUNITY_ACTION[o.action]} />` (L489-495)
  - the data-unavailable cue `o.dataUnavailable ? (… data-testid="opportunity-unavailable-…")` (L523-534)
  - mobile mapping `dataUnavailable: o.dataUnavailable` (L189)
- Mobile: the `Section` type has `dataUnavailable?: boolean` (`src/components/mobile/sections.ts:21`). `SectionRenderer.tsx` renders the muted marker / badge at L169-178 and the unavailable cue at L229.
- `useOpportunities(minConviction = 0, sources = [], actionFilter = UNSPECIFIED, sort = CONVICTION)` (`src/hooks/useOpportunities.ts:23-44`). Its query key is at L30 and it calls `analysisClient.listOpportunities({ … })` at L32-37.
- Signal-detail (`src/app/trader/positions/[symbol]/page.tsx`):
  - `const { data: oppData } = useOpportunities(0);` then `.filter((o) => o.symbol === symbol)` (L176-180). This only sees the first page, ≤50 rows (`@AC-15` gap).
  - `OpportunitySection` (L934) renders `<EnumBadge render={OPPORTUNITY_ACTION[opportunity.action]} />` and uses `CardNotice` (L945).
- `SignalReadiness.tsx` calls `useOpportunities()` (L28) for `isHeld`.
- `CardNotice` is at `src/components/shared/CardNotice.tsx:5`.
- The BFF forwards `ListOpportunitiesRequest` as-is (`src/lib/insightsBff.ts:57-59`), so `symbol` passes through with no BFF change.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **`BacktestDiagnostics.tsx`.**
   - Add `[NoTradeReason.FUNDAMENTALS_UNAVAILABLE]: 'No trades — this strategy requires fundamentals and this symbol has none usable in the range, so it was refused rather than evaluated.'`
   - When `sd.fundamentalsGap === FundamentalsGap.ETF`, append ` (ETF)` to the rendered message.
   - Keep the `@AC-11 @feature-151` row rendering untouched.
2. **`opportunityShared.tsx`.** Add exhaustive `export const FUNDAMENTALS_GAP: Record<FundamentalsGap, EnumRender>`:
   - `UNSPECIFIED → { label: 'Fundamentals unavailable', role: 'secondary' }`
   - `ETF → { label: 'Fundamentals unavailable (ETF)', role: 'secondary' }`
   - `NOT_ETF → { label: 'Fundamentals unavailable', role: 'secondary' }`
   This matches `@AC-4`'s literal: "(ETF)" when known, else plain.
3. **Desktop queue row.** When `o.fundamentalsUnavailable`, render `<EnumBadge render={FUNDAMENTALS_GAP[o.fundamentalsGap]} testId={\`fundamentals-unavailable-${o.symbol}\`} />` in place of the action badge, and hide the act buttons, as the muted row does. Readiness shows `—` (no traced conditions).
4. **Mobile.**
   - Add `fundamentalsUnavailable?: boolean; fundamentalsGap?: FundamentalsGap` to `sections.ts`.
   - Map them at `page.tsx:189`.
   - In `SectionRenderer.tsx` (L169-178), render the same `EnumBadge` with `testId={\`mobile-fundamentals-unavailable-${s.symbol}\`}`.
5. **`useOpportunities`.** Add a 5th parameter `symbol = ''`, fold it into the `queryKey` and pass it in the request body (design Fix 6).
6. **Signal-detail.**
   - Change `page.tsx:176` to `useOpportunities(0, [], OpportunityActionTag.UNSPECIFIED, OpportunitySort.CONVICTION, symbol)`.
   - In `OpportunitySection`, when `opportunity.fundamentalsUnavailable`, render the `FUNDAMENTALS_GAP` badge, with `data-testid="detail-fundamentals-unavailable"`, in place of the action badge.
   - In `SignalReadiness`, call `useOpportunities(0, [], UNSPECIFIED, CONVICTION, symbol)`. When the `(symbol, strategyId)` row has `fundamentalsUnavailable`, render `<CardNotice data-testid="readiness-fundamentals-unavailable">This strategy requires fundamentals and {symbol} has none — entry is not evaluated.</CardNotice>` above the readiness body.
7. **C-17.** Use only `EnumBadge`/`CardNotice` and design tokens; no new primitive and no color literals.
8. **C-10 — intentionally unchanged consumers.**
   - `src/components/copilot/CopilotRail.tsx` (~L36-46) tallies `o.action`, so a skip row counts under UNSPECIFIED, the same as a muted row today.
   - `src/components/insights/WatchlistDetail.tsx` (~L90-92) marks the symbol "in queue" from its skip row, which is accurate: the row is served.
   - Both are benign, so neither is edited. The `symbol = ''` default keeps CopilotRail's documented shared page-1 cache key (its comment at L36-37) shared with the queue page.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm exec tsc --noEmit && pnpm run lint && grep -n "FUNDAMENTALS_UNAVAILABLE\]" src/components/insights/BacktestDiagnostics.tsx && grep -n "FUNDAMENTALS_GAP" src/lib/opportunityShared.tsx && grep -n "symbol = ''" src/hooks/useOpportunities.ts
```

---

### Step 24 — test: UI e2e + fixtures

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/fixtures/opportunities.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify
- `services/xstockstrat-ui/e2e/insights/backtest-coverage.spec.ts` — modify
- `services/xstockstrat-ui/e2e/insights/opportunities.spec.ts` — modify
- `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness, analytics display accuracy, Connect-RPC call safety

**Codebase Evidence**:
- `OPPORTUNITIES` (`e2e/fixtures/opportunities.ts:54`) includes the PLTR `dataUnavailable: true` row (L157). It is cataloged at `e2e/fixtures/INVENTORY.md:34`.
- The mock `listOpportunities(req)` (`e2e/mock-backend.ts:855-905`) filters `OPPORTUNITIES` by floor/source/action. It applies no symbol filter today, and its `MARKERS` list is at L860.
- The `runBacktest` sentinel precedent is `if (req.strategyId === 'strat-formula-error-001')` → `noTradeReason: 4` (`mock-backend.ts:1040-1059`), cataloged in the INVENTORY sentinel table at L58.
- `e2e/insights/opportunities.spec.ts` uses per-test `page.route('**/xstockstrat.analysis.v1.AnalysisService/ListOpportunities', …)` (L44).
- The `e2e/trader/position-detail.spec.ts` Signal-detail spec exists.
- The backtest banner spec is `e2e/insights/backtest-coverage.spec.ts:82-107`.

**TDD**: `red-green required`

**Covers**: `AC-2, AC-4, AC-15`

**Instructions**:
1. **Fixtures (C-12).** In `e2e/fixtures/opportunities.ts`, export `SCHD_FUNDAMENTALS_UNAVAILABLE_OPPORTUNITY`:
   - `{ symbol: 'SCHD', strategyId: 'fundamentals_macd_blend', action: 0, conviction: 0, fundamentalsUnavailable: true, fundamentalsGap: 1, provenance: ['watchlist','fundamentals_unavailable'], … }`, with no `compositeScore`.
   - It is **not** added to `OPPORTUNITIES`, so existing counts are unchanged.
   - Add an `INVENTORY.md` row for it.
   - Add the backtest sentinel `strat-fundamentals-etf-001` to the INVENTORY sentinel table.
2. **`mock-backend.ts`.**
   - `listOpportunities` honors `req.symbol`: when it is non-empty, filter rows to that symbol. When `req.symbol === 'SCHD'`, serve `[SCHD_FUNDAMENTALS_UNAVAILABLE_OPPORTUNITY]`.
   - Add `'fundamentals_unavailable'` to `MARKERS` (L860).
   - Add the `runBacktest` sentinel `strat-fundamentals-etf-001` → `status: 2` (INSUFFICIENT_DATA), `diagnostics: [{ symbol: 'SCHD', barsTotal: 0, warmupBars: 0, noTradeReason: 5, fundamentalsGap: 1, bars: [] }]`. It is a reserved sentinel, so it stays inline (C-12 exemption).
3. **Specs.**
   - **`@AC-2` UI.** In `backtest-coverage.spec.ts`, running `strat-fundamentals-etf-001` shows `[data-testid=no-trade-reason]` containing `requires fundamentals` and `(ETF)`.
   - **`@AC-4` UI.** In `opportunities.spec.ts`, a `page.route` override that includes the SCHD fixture shows `fundamentals-unavailable-SCHD` with text `Fundamentals unavailable (ETF)` and no act buttons. Add a mobile-viewport variant for `mobile-fundamentals-unavailable-SCHD`.
   - **`@AC-15`.** In `position-detail.spec.ts`, open `/trader/positions/SCHD?strategy=fundamentals_macd_blend` with SCHD watchlisted. Then:
     - `detail-fundamentals-unavailable` and `readiness-fundamentals-unavailable` are visible.
     - The intercepted ListOpportunities request body carries `symbol: 'SCHD'`. This proves the row is served only via the filter, independent of queue rank.
   - Regression: the existing `@AC-11 @feature-151` next-bar-fill render spec stays green.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm exec tsc --noEmit && pnpm run lint && cd ../.. && ./scripts/run-e2e.sh --grep "fundamentals|Opportunit|backtest coverage|position detail"
grep -n "from '../fixtures'\|from './fixtures'\|helpers/auth" services/xstockstrat-ui/e2e/insights/opportunities.spec.ts services/xstockstrat-ui/e2e/trader/position-detail.spec.ts services/xstockstrat-ui/e2e/mock-backend.ts | head && grep -n "SCHD_FUNDAMENTALS_UNAVAILABLE_OPPORTUNITY\|strat-fundamentals-etf-001" services/xstockstrat-ui/e2e/fixtures/INVENTORY.md
```

---

### Step 25 — docs: Strat-lab skill, MCP runbook, service docs, C-16 CHANGE texts

**Status**: `pending`
**Service**: `docs/` + `plugins/strat-lab/` + service `CLAUDE.md`s
**Files**:
- `plugins/strat-lab/skills/backtest/reference/output-handling.md` — modify
- `plugins/strat-lab/skills/backtest/reference/self-grill.md` — modify
- `plugins/strat-lab/skills/backtest/reference/verification.md` — modify
- `plugins/strat-lab/skills/backtest/SKILL.md` — modify
- `docs/runbooks/mcp-tools.md` — modify
- `services/xstockstrat-analysis/CLAUDE.md` — modify
- `services/xstockstrat-analysis/docs/context-constitution.md` — modify
- `services/xstockstrat-marketdata/CLAUDE.md` — modify
- `services/xstockstrat-ui/CLAUDE.md` — modify
- `services/xstockstrat-analysis/acceptance/fundamentals-formula-inputs.feature` — modify
- `services/xstockstrat-analysis/acceptance/opportunity-compute-robustness.feature` — modify
- `docs/roadmap/features/215-block-fundamentals-strategy-on-etf/recon.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Strat-lab rule: `docs/patterns/strat-lab-plugin.md:16-24`, which requires a same-PR skill update for `run_backtest`/`set_strategy_live` changes. Cited lines:
  - `output-handling.md:15-19` lists `no_trade_reason` values.
  - `self-grill.md:13` and `:34` cover 0-trade / `no_trade_reason` triage.
  - `verification.md:37`.
  - `SKILL.md:159-162` is the warnings paragraph.
  - Validator: `python3 plugins/strat-lab/scripts/validate.py` (`strat-lab-plugin.md:41-46`).
- `docs/runbooks/mcp-tools.md` sections: `run_backtest` (L282), `set_strategy_live` (L773), `list_opportunities` (L953).
- Analysis docs:
  - The Decide-surface section is at `services/xstockstrat-analysis/CLAUDE.md:167-171`.
  - The ANALYSIS-3 row is at `services/xstockstrat-analysis/docs/context-constitution.md:19`.
- Marketdata docs:
  - The `marketdata.edgar.enabled` row is at `services/xstockstrat-marketdata/CLAUDE.md:94`.
  - The "Snapshot serving source is switchable" paragraph is at L137-142.
- UI docs: `services/xstockstrat-ui/CLAUDE.md:82,138` still names Signal-detail `insights/market/[symbol]`. The live route is `src/app/trader/positions/[symbol]/page.tsx` (drift).
- C-16 CHANGE texts, both signed off 2026-10-09 (context.md):
  - The `@AC-8 @feature-201` note at `fundamentals-formula-inputs.feature:53` says "A whole-row-missing symbol still holds (None), never fabricates."
  - `@AC-2 @feature-185` is at `opportunity-compute-robustness.feature:24-28`.
- `recon.md:121` and `:166` use the "unavailable = no served row" wording that the design corrects (design § Spec notes).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. **Strat-lab skill** (same PR as Steps 5/15).
   - Add `NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE` (refused, not evaluated; no cell; check `fundamentals_gap`) and the "fundamentals fetch failed — rerun" warning to `output-handling.md` and `self-grill.md` item 6.
   - In `SKILL.md`, note that a fundamentals-gated strategy on an ETF is refused, never a 0-trade no-signal.
   - In `verification.md`, add a real-ETF check: SCHD gives reason 5.
2. **`mcp-tools.md`.** Mirror the Step-5 docstrings in the three sections, including the new `fundamentals_unavailable`/`fundamentals_gap` row fields and `SymbolDiagnostics.fundamentals_gap`.
3. **Analysis `CLAUDE.md`.** Add:
   - The Decide-surface skip row: entry-only, action UNSPECIFIED, `"fundamentals_unavailable"` marker, floor-exempt, structural marker, mutual exclusion with `"unavailable"`, heal-to-skip.
   - The `ListOpportunitiesRequest.symbol` filter.
   - The backtest refusal and live deny-entry with its state-change alert.
   - The evidence-exclusion paragraph (H). It states that gate-off re-includes refused cells (Open Risk 3) and gives the post-deploy `ScoreStrategy` cleanup.
   - The fixed constants `_FUND_PAGE_SIZE`, `_MAX_FUND_PAGES`, `_FUND_PAGE_TIMEOUT_SECONDS`, `_INTERACTIVE_DERIVATION_CONCURRENCY`.
   - The snapshot quota ripple, one line: the snapshot loaders use single-symbol `GetFundamentals`, so an uncached symbol at the vendor quota (`RESOURCE_EXHAUSTED`, common under the default `finnhub` per-minute cap) reads UNKNOWN. That stamps the opportunity row `"unavailable"` and retries it every 300s. It is never a skip row or a live state change.
4. **ANALYSIS-3 (EXTEND).** Eligible = fingerprint match **and** not guard-refused at derivation; exclusion is non-destructive. It overrides the feature-065 "zero-trade cells count" decision only via the operator decision in context.md 2026-10-10. Add the fingerprint blind spot: formula `fundamental_inputs` live outside `definition_json`.
5. **Marketdata `CLAUDE.md`.**
   - Snapshot paragraph: no producible EDGAR snapshot with the vendor disabled → NotFound (single) / omitted (Multi); an FMP no-data → NotFound; a Finnhub fetch failure stays Unavailable (Finnhub has no absence signal); global disables stay FailedPrecondition.
   - Describe `GetEtfFlags` (cache-only, 30-day fixed TTL, background fill only below 80% of `marketdata.fmp.daily_request_cap`, `atQuotaAlertThreshold`).
6. **UI `CLAUDE.md`.** Fix the Signal-detail route drift (`insights/market/[symbol]` → `trader/positions/[symbol]`), and note the skip-row badge and the `useOpportunities(..., symbol)` filter.
7. **C-16 CHANGE texts.**
   - Replace the feature-201 note's last sentence with: "A symbol with no usable fundamentals is refused/denied entry with `NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE` (feature 215, signed off 2026-10-09); a partial row still evaluates."
   - Rescope `@AC-2 @feature-185`'s Given to "a candidate symbol with fundamentals available (or a strategy not requiring them) whose bars are available…".
   - Promoting the feature's `@AC-*` scenarios into the durable suites remains the `/sdd-execute` integration-PR step (C-16).
8. **`recon.md:121,166`.** Apply the design's wording fix.
9. **Teardown.** Run `/context-forge:context-constitution refresh` scoped to the touched context files. If the plugin is unavailable, record the manual reconciliation in the PR body.
   - Any grounded-drift fix it reports **outside** this step's Files list is not staged silently (F-08). Examples: a `*-findings.md`, or `README.md` via `.agents/context-forge.json` `scrubberExtraTargets`.
   - Record each such file and edit in the **Deviation Log**, then stage it, or defer it to a follow-up noted there.

**Verification**:
```bash
python3 plugins/strat-lab/scripts/validate.py --self-test && python3 plugins/strat-lab/scripts/validate.py
grep -n "FUNDAMENTALS_UNAVAILABLE" plugins/strat-lab/skills/backtest/reference/output-handling.md docs/runbooks/mcp-tools.md services/xstockstrat-analysis/CLAUDE.md
grep -c "insights/market/\[symbol\]" services/xstockstrat-ui/CLAUDE.md   # expect 0
grep -n "feature 215" services/xstockstrat-analysis/acceptance/fundamentals-formula-inputs.feature services/xstockstrat-analysis/acceptance/opportunity-compute-robustness.feature
grep -n "RESOURCE_EXHAUSTED" services/xstockstrat-analysis/CLAUDE.md
(cd services/xstockstrat-agent && uv run pytest tests/test_tools_endpoint.py tests/test_list_correlation_parity.py -q)   # mcp-tools.md + strat-lab SKILL.md parity guards
```

---

### Step 26 — test: Staging measurement (pre-merge) + real-ETF proof (post-deploy)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `docs/roadmap/features/215-block-fundamentals-strategy-on-etf/context.md` — modify (record measurements and results)

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Design Open Risk 4 and Fix 2 require the count of staging symbols with >50 stored periods to be measured before merge (C-16 EXTEND of feature-198/201 results).
- fails.md 2026-08-13 (feature 129) requires proof on a real ETF run (SCHD), not only stubs.
- The staging MCP tools exist in this environment: `query_fundamentals`, `run_backtest`, `list_opportunities` and `get_backfill_status` on the `xstockstrat_staging` server.
- Open Risk 3 calls for a legacy-grade cleanup via ScoreStrategy, the manual refresh (`servicer.py:2307`).

**TDD**: `N/A (environment verification — the code-level red/green lives in Steps 16/18/22/24)`

**Covers**: `AC-2, AC-3, AC-4, AC-12`

**Instructions**:
1. **Pre-merge.** For each symbol on the staging watchlists plus the symbols of `fundamentals_macd_blend`'s evidence cells, call `query_fundamentals(symbol, historical)` and count the periods. Record in `context.md` the number with >50 periods and the symbols themselves. That is the blast radius of the pagination EXTEND.
2. **Post-deploy (dev/staging):**
   - (a) `run_backtest(fundamentals_macd_blend, ["SCHD"])` gives `no_trade_reason: NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE`, `fundamentals_gap` set, and `status: BACKTEST_STATUS_INSUFFICIENT_DATA`.
   - (b) `run_backtest(fundamentals_macd_blend, ["AAPL"])` trades, with no reason 5.
   - (c) `run_backtest(squeeze_breakout_trend, ["SCHD"])` evaluates normally.
   - (d) `list_opportunities` shows the SCHD row with `fundamentals_unavailable: true` and `action: OPPORTUNITY_ACTION_TAG_UNSPECIFIED` when SCHD is in the universe.
   - (e) A `ScoreStrategy` manual refresh of `fundamentals_macd_blend` clears any legacy SCHD contribution (the grade's `evidence_symbols` excludes SCHD).
   - Record each result verbatim in `context.md`.
3. Any mismatch blocks `launched` and is logged in the Deviation Log.

**Verification**:
Each bullet's observed MCP output is recorded in `context.md` under a `## Session … — staging verification` heading. The pre-merge count is recorded before the integration PR merges. **No coverage threshold applies** (environment verification; the code-level red/green lives in Steps 16/18/22/24).
```bash
F=docs/roadmap/features/215-block-fundamentals-strategy-on-etf/context.md
grep -n "^## Session .* — staging verification" "$F"                      # section exists
grep -nE ">50 periods: [0-9]+" "$F"                                      # pre-merge count recorded (pre-merge gate)
grep -nE "NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE|fundamentals_unavailable: true" "$F"   # post-deploy SCHD results recorded
```
Record the pre-merge count as a line `>50 periods: <N> (<symbols>)`, so the second grep matches.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### Deviation: Step 1 — proto: Additive analysis + marketdata contract
**Spec said**: `cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/block-fundamentals-strategy-on-etf"`
**Actual**: ran `buf breaking --against "../../.git#branch=feature/block-fundamentals-strategy-on-etf,subdir=packages/proto"` (same check).
**Reason**: `.git` is not resolvable from `packages/proto`; the input needs the repo-root path plus `subdir`. Command-path fix only, no behavior change.
**Disposition**: CI-equivalent fallback

### Deviation: Step 2 — proto-gen: Regenerate stubs
**Spec said**: `./scripts/buf-gen.sh && …` (one invocation that generates and compiles the TS package).
**Actual**: Generated in the pinned codegen container (`./scripts/localenv-setup.sh`), which ran buf lint, buf generate (Go + TS) and grpcio-tools (Python). Its final `tsc` step failed (`tsc: not found`) because the worktree had no workspace `node_modules`. Then ran `pnpm install --frozen-lockfile --filter @xstockstrat/proto` and `pnpm --filter @xstockstrat/proto run build` on the host (lockfile-pinned TypeScript) to produce `gen/ts/dist`. Exactly the 20 files listed in **Files** changed; every expected-unchanged file stayed unchanged.
**Reason**: a fresh git worktree has no installed workspace deps. Re-running the full container pipeline after the install was not permitted in this session.
**Disposition**: CI-equivalent fallback — CI `proto-freshness` re-checks byte parity.

### Deviation: Step 4 — test: Row contract + repository
**Spec said**: Files limited to the two test files; instructions did not mention the `_FakeOpportunitiesRepo.read` signature.
**Actual**: Added a `symbol=""` keyword to the in-file fake repo `read` in `tests/test_analysis_servicer.py`. It accepts the new kwarg but does not filter, matching the feature-190 "forwarding is asserted at the boundary" convention.
**Reason**: After Step 3 every `ListOpportunities` call passes `symbol=`, so without the kwarg the fake raised `TypeError`. The fix stays inside a file Step 4 lists.

### Deviation: Step 6 — test: Agent projections
**Spec said**: "The existing parity assertion goes green with Step 5's `_SYMBOL_KEYS`" (no fixture change named).
**Actual**: Also added `"fundamentals_gap": "FUNDAMENTALS_GAP_UNSPECIFIED"` to each per-symbol entry of the `_full_result` fixture in `tests/test_backtest_view.py`.
**Reason**: `test_summary_drops_per_bar_bars_but_keeps_the_diagnosis` asserts every `_SYMBOL_KEYS` key is in each summarized entry. Real `client.run_backtest` output always prints the no-presence enum (`always_print_fields_with_no_presence=True`), so the fixture now mirrors the real shape. The change is inside a file Step 6 lists.

### Deviation: Step 8 — test: Marketdata absence encoding
**Spec said**: "`fakeHistRepo` holding a producible `BABA` period and **no** `SCHD` history"; client-test symbols unspecified; C-13 check "`\"SCHD\"` … ≤1 declaring file".
**Actual**: `fakeHistRepo` returned one `latest` for every symbol, so it gained an optional `latestBy map[string]*HistoricalFundamentalsPeriod` (nil keeps the old behavior). The FMP/Finnhub client tests use `VOO` so `"SCHD"` stays in one test file.
**Reason**: per-symbol producibility is needed for the SCHD-omitted / BABA-served case; the symbol choice keeps the step's own C-13 check green. Both changes are inside files Step 8 lists.

### Deviation: Step 11 — service: Pure `fundamentals_guard` module + shared evaluator helper
**Spec said**: (3) servicer imports the two predicates "plus `Availability, assess, epoch_eval_dates, requires_fundamentals`"; (4) live_loop imports the predicates "(and `Availability`, `assess`)". Verification: `uv run python -c "import app.engine.live_loop, app.handlers.servicer"`.
**Actual**: Step 11 imports only the two predicates into `servicer.py` and `live_loop.py`; the guard names are imported by the steps that first use them (13/15/17/19/21). The import check ran with the `gen` namespace registered the same way `tests/conftest.py::_setup_gen_path` does (`sys.path.insert(0,'tests'); import conftest`).
**Reason**: unused imports fail `ruff check` (F401), which Step 12's Verification runs. A bare `python -c` in the service dir has no `gen` package; pytest and the container provide it.
**Disposition**: CI-equivalent fallback (import check); import timing only, no behavior change.

### Deviation: Step 13 — service: Bounded PIT pager + error-distinct loaders
**Spec said**: live_loop imports `_fetch_historical_fundamentals_paged` from `app.handlers.servicer`; each loader "record[s] failures the same way" and lowers the snapshot row as today.
**Actual**: The NOT_FOUND / FAILED_PRECONDITION / other → state mapping and the single-row lowering live once in servicer helpers (`_record_pit_failure`, `_record_snapshot_failure`, `_snapshot_periods`), which live_loop imports alongside the pager. live_loop's now-unused `date`, `_FUNDAMENTAL_METRICS`, `FundamentalPeriod`, `_fundamental_periods_from_response` imports were dropped (ruff F401). `declared_formula_fundamentals` imports `Availability` lazily (the guard imports the evaluator).
**Reason**: DRY guard rail (one mapping for both loaders keeps backtest/live parity); import cycle avoidance. All inside Step 13's Files.

### Deviation: Step 14 — test: Pager, loaders, readiness parity
**Spec said**: Files include `tests/test_live_loop.py` (re-point snapshot stubs); readiness parity feeds EvaluateReadiness, GetWatchlistReadiness, the materializer and GetIndicatorSeries SCHD empty history + NotFound snapshot and compares to the pre-change shape.
**Actual**: `tests/test_live_loop.py` is unchanged: its `GetFundamentalsMulti` stubs all drive the blend-universe resolver (which keeps Multi), and the live-loader cases live in the new `test_fundamentals_pit_pager.py`. Readiness parity is behavioral for EvaluateReadiness and GetIndicatorSeries (real loaders on SCHD ≡ loaders forced to `[]`, both RPCs asserted awaited) and structural for the watchlist compute path (`_kick_readiness_refresh`) and `_materialize_readiness_for_owner` (`inspect.getsource` pins that none of the four pass `failures=`).
**Reason**: no live snapshot-loader stub exists in `test_live_loop.py` to re-point. The watchlist/materializer harnesses live in test files outside Step 14's Files; their loader inputs are the same two loaders whose NOT_FOUND → `[]` mapping is pinned directly, so the structural pin plus the loader tests cover the rule without widening F-08 scope.
