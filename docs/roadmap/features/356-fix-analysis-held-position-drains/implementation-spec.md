# Implementation Spec: fix-analysis-held-position-drains

**Status**: `pending`
**Created**: 2026-11-17
**Feature**: `docs/roadmap/features/356-fix-analysis-held-position-drains/feature.md`
**Total Steps**: 9
**Feature Branch**: `feature/fix-analysis-held-position-drains`
**Tree**: `origin/feature/fix-analysis-held-position-drains@a4ff372c`. Every `path:line` below was re-read at this commit. Impl-spec review (2026-11-17): `git diff a4ff372c 2408de65 -- services packages scripts .github` is empty, so the citations still hold at the branch head; spot-checked `servicer.py:385-390,3933-3941,4955-4957,6054-6067,6404`, `live_loop.py:400-411,563-568`, `tests/test_live_loop_telemetry.py:121-127`.

---

## Execution Summary

Step 1 brings the feature's own acceptance and product-spec text in line with the approved design
(D-11, D-13): the `@AC-5` When step is narrowed and `@AC-10` is added. Steps 2-3 land the shared
fail-closed helper `_drain_positions_paged` / `_PositionsPageError` in `servicer.py`, route
`_drain_held_symbols` through it and guard `ScreenSymbols`, with red-first tests for the servicer half
(AC-1..AC-6, AC-8, AC-9). Steps 4-5 are one atomic unit: `live_loop._drain_held` routes through the
helper and the cycle skips a failed owner. That change turns the existing
`test_ac16_failed_held_drain_counted_without_owner` red, so the test flip lands in the same commit.
Steps 6-7 add the daily-refresh `recompute{full,failed}` counter (operator decision, design gate r3)
with the red-first `@AC-10` test. Steps 8-9 are the docs and registry updates the operator required in
the same PR: the service CLAUDE.md Observability caveat and the `produced-signals.tsv` row, which is
written because the series name was verified in Grafana Cloud (Mimir) at spec time (§ Mimir
verification below).

**Consumer surfaces.** The product spec names `/insights/opportunities`, `/insights/screener` and the
agent `list_opportunities` / `screen_symbols` tools, each with **no code change** (passthrough). The
behaviour change reaches them through the backend RPCs (`ListOpportunities` via the recompute path,
`ScreenSymbols`). No UI or agent step is required (C-14). This is a decision, not an omission.

**No** proto, migration, config key, env var, port, pool or other-service change. Features 351, 353 and
354 are not touched.

### Scenario Coverage (C-15)

| Scenario | Step(s) |
|---|---|
| `@AC-1` | Step 3 (servicer drain), Step 5 (live-loop drain + metric) |
| `@AC-2` | Step 3 (servicer drain), Step 5 (live-loop drain + metric) |
| `@AC-3` | Step 3 (servicer drain), Step 5 (live-loop drain + metric) |
| `@AC-4` | Step 3 (guard, not regression) |
| `@AC-5` | Step 3 |
| `@AC-6` | Step 3 |
| `@AC-7` | Step 5 |
| `@AC-8` | Step 3 (servicer half), Step 5 (live-loop half) |
| `@AC-9` | Step 3 (servicer half), Step 5 (live-loop half) |
| `@AC-10` (added by Step 1) | Step 7 |

PRESERVE guards (C-16), all kept green by the union run in Steps 3, 5 and 7:
`@AC-16 @feature-294` (`tests/test_live_loop_telemetry.py:121-127`, flipped to `pytest.raises` in
Step 5 per operator decision), `@AC-8 @feature-262` and `@AC-3 @feature-262`
(`tests/test_entry_backfill.py:335-357`, unchanged), `@AC-6 @feature-191`
(`tests/test_opportunities_latency.py:86,123`, stubs `_drain_held_symbols`, unaffected),
`@AC-51 @feature-294` (`tests/test_analysis_tick_telemetry.py:174-184`, stays kick-path-only at exactly
1), `@AC-41 @feature-294` (`tests/test_telemetry_allowlist.py:46-56`, `_drive` extended in Step 7),
and the empty-owner guard `tests/test_owner_header_guard.py:408-416`.

### Pre-RED fake sweep (D-9)

Done here so no existing test goes red for the wrong reason. Callers of the two held drains are only
`servicer.py:3935` (`ScreenSymbols`), `servicer.py:5367` (`_compute_opportunities`),
`live_loop.py:402` (cycle) and `entry_backfill.py:148` (grep `_drain_held_symbols(` /
`_drain_held(` over `app/`).

| Site | Reaches a held drain? | Expected outcome after the fix |
|---|---|---|
| `tests/test_owner_header_guard.py:314` | No. `test_readiness_materializer` calls `_materialize_readiness_for_owner` and wires only `ListWatchlists`. The same file's `test_screen_symbols` (`:299-309`) uses `_svc()`, which sets `svc._portfolio = None` (`:264`), so `_drain_held_symbols` returns `{}` before any RPC. | Unchanged. |
| `tests/test_unreadable_formula.py:743` | No. Wires `GetWatchlist` for `EvaluateReadiness`; the file's `_compute_opportunities` / `ListOpportunities` tests (`:560-684`) run on a servicer with no `_portfolio` set, and its live-loop tests (`:123`, `:711`) use `real_live_loop` (EOF pages). | Unchanged. |
| `tests/test_readiness_materializer.py:55` | No. Wires only `ListWatchlists` (`:66`). | Unchanged. |
| `tests/test_watchlist_readiness.py:35` | No. Wires only `GetWatchlist` (`:36`). | Unchanged. |
| `tests/test_analysis_servicer.py:4804` | Yes (`_compute_opportunities`). `ListPositions` is an `AsyncMock` returning one page with `next_page_token=""` (`:4812-4816`). | Success path, unchanged (FR-5). |
| `tests/test_analysis_servicer.py:6509` | Yes (`ScreenSymbols`). One page, `pos_resp.page.next_page_token = ""` (`:6505`). | Success path, unchanged; AAPL stays `held`. |
| `tests/conftest.py:103` (`real_live_loop`) | Yes (live loop, entry backfill). `ListPositions` returns `positions=[]`, `page=eof` with `next_page_token=""` (`:101,114`). | Success path, unchanged. |
| `tests/test_live_loop.py:880,1062,1339`, `tests/test_live_loop_telemetry.py:54` | Yes. Each sets `ListPositions` to an EOF page (`:885-891`, `:1064-1079`, `:1340-1342`, `:55-57`). | Unchanged, except `test_ac16_failed_held_drain_counted_without_owner` (flipped in Step 5). |
| `tests/test_live_loop.py:37` `_make_loop` | No portfolio: `LiveEvaluationLoop(portfolio_stub=None)` default (`live_loop.py:286,295`), so `_drain_held` returns `set()` before any RPC. | Unchanged. |
| `tests/test_entry_backfill.py:61,344` | Replace `_drain_held` with an `AsyncMock`. | Unchanged (`@AC-8 @feature-262`). |

No bare truthy shared-token fake reaches a held drain, so no existing fake needs an `AsyncMock` / EOF
repair.

### Mimir verification (D-15; operator decision, design gate r4)

Run 2026-11-17 through the Grafana Cloud MCP, datasource `grafanacloud-prom`
(`grafanacloud-davcs86-prom`, the default Prometheus/Mimir datasource; the only other Prometheus
datasource is `grafanacloud-usage`). Instant queries with `last_over_time(...[30d])`, i.e. a 30-day
range:

- (a) `count by (__name__) (last_over_time({__name__=~"analysis_opportunity_recompute.*"}[30d]))`
  → one series name: `analysis_opportunity_recompute_total` = 7.
- (b) `count by (kind, outcome, service_name, deployment_environment) (last_over_time(analysis_opportunity_recompute_total[30d]))`
  → one row: `deployment_environment="staging", kind="full", outcome="ok", service_name="analysis"` = 7.
- Raw `last_over_time(analysis_opportunity_recompute_total[30d])` shows the environment label is
  `deployment_environment` and the 7 series are staging instances (DigitalOcean, homelab and five
  instance-UUID series), all `job="analysis"`, `service_name="analysis"` (short name, OTEL-1).

Result: the exported name `analysis_opportunity_recompute_total` is **verified** in staging (dev).
Production returned no series in the 30d window, which is expected for a counter that exports only
after its first `add`. No `outcome="failed"` series exists yet in either environment. The verified
name matches the expected one, so Step 9 writes the row.

## Step Dependencies

- Step 2 requires Step 1: none in code; Step 1 is ordered first so the `@AC-10` scenario and the narrowed `@AC-5` exist before any test cites them.
- Step 3 [test] covers Step 2 [service].
- Steps 4+5 land together: Step 4 changes `_drain_held`'s failure result from "return the partial set" to "raise", which breaks the existing test call site `tests/test_live_loop_telemetry.py:121-127` (`assert held == set()`); Step 5 flips it (step-constraints §C, return-shape change with a test call site).
- Step 4 requires Step 2: it imports `_drain_positions_paged` / `_PositionsPageError` from `app/handlers/servicer.py`.
- Step 7 [test] covers Step 6 [service]; Step 7's `@AC-10` is red against the Step-5 tree only because Step 2 already makes u-1's drain raise and Step 6 is the missing counter.
- Step 8 requires Step 6: the caveat documents the behaviour Step 6 adds.
- Step 9 requires Step 6 and the Mimir verification above: the row registers a series whose name was verified, and Step 6 is the new `failed` producer the operator mandated the row for.
- Rebase risk: `308-fix-analysis-per-symbol-isolation` edits `_compute_opportunities` (`servicer.py:5350-5370`). This feature does not edit that function, but Steps 3 and 7 run it for real; if 308 lands first, rebase and re-run both steps' Verification.
- Rebase risk: `337-metrics-host-provider-label` (in-progress) also appends to `packages/otel/produced-signals.tsv` (337 `context.md:21`, append-at-end). Step 9's row is a text-only conflict; on rebase keep both rows and re-run `python3 scripts/check-otel-produced-signals.py`.
- CI: `.github/workflows/ci.yml:59` includes `services/xstockstrat-analysis/app/handlers/servicer.py` in the `xstockstrat-agent` path filter, so Steps 2 and 6 also trigger the agent test job. No agent change is expected; a red agent job is a regression to investigate, not noise.
- Red-before-green evidence (C-08/P-06): Steps 2/3 and 6/7 are committed service-first, so the commit history shows no red commit. The RED is evidenced only by the context.md record that Steps 3, 5 and 7 require (failing test ids + failure reason, captured against the pre-change tree before the service change is applied). A step is not complete without that record.

---

### Step 1 — docs: Align acceptance.feature and product-spec.md with the approved design

**Status**: `done`
**Service**: `docs/roadmap/features/356-fix-analysis-held-position-drains/`
**Files**:
- `docs/roadmap/features/356-fix-analysis-held-position-drains/acceptance.feature` — modify
- `docs/roadmap/features/356-fix-analysis-held-position-drains/product-spec.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `acceptance.feature:34-40` is `@AC-5` (tag `:34`); its When step (`:38`) reads `When the opportunity queue for "u-1" is recomputed`. `:42` is the `@AC-6` tag.
- `acceptance.feature` has `@AC-1..@AC-9` only (9 scenarios; last scenario `@AC-9`, tag at `:68`); no `@AC-10`.
- `product-spec.md:59-60` FR-4 bullet `_compute_opportunities` says "Repeated failures surface `compute_failed` (feature 185). The fix adds no new metric instrument." and has no daily-refresh bullet.
- design.md § Chosen Approach 4 and 6, D-11, D-13 (debate.md:32,34) and § Business Rules Touched EXTEND `@AC-5` / `@AC-10`.
- `servicer.py:4784-4795` (`compute_failed` set only on cold reads; O-6).

**TDD**: N/A (docs)

**Covers**: —

**Instructions**:
1. In `acceptance.feature`, change the `@AC-5` When step to `When the on-demand opportunity recompute for "u-1" runs`. Leave its Given and Then lines unchanged.
2. Append scenario `@AC-10 @FR-4 @regression` "A failed daily-refresh user is counted and keeps the previous queue":
   - Given users "u-1" and "u-2" each have a previously computed opportunity queue
   - And the portfolio ListPositions fake raises for "u-1" and returns an empty page for "u-2"
   - When the daily opportunity refresh pass runs
   - Then the previous queue for "u-1" is not replaced
   - And the queue for "u-2" is replaced
   - And "analysis.opportunity.recompute" with kind "full" and outcome "failed" increases by exactly 1
   - And no metric attribute contains "u-1"
   - And the refresh schedule advances
3. In `product-spec.md` FR-4:
   - Narrow the `_compute_opportunities` bullet: the on-demand (kick-path) recompute counts `recompute{outcome=failed}`; "Repeated failures surface `compute_failed`" applies to cold reads only (stored queues are served stale).
   - Add a bullet for the daily refresh (`_opportunity_refresh_tick`): a per-user failure logs a WARNING with traceback, records `analysis.opportunity.recompute{kind=full,outcome=failed}` once per failed user with no user attribute, keeps that user's previous queue, and the schedule still advances. No `ok` is recorded on this path. The loop tick is unchanged (ordinary tick on partial failure, none when every user fails).
   - In Fix Scope, keep "No new metric instrument" and add that the daily refresh reuses the existing `recompute{full,failed}` label set (no new label value).
   - In Acceptance Criteria or FR-6, name `@AC-10` among the `@regression` scenarios.

**Verification**:
```bash
grep -n "@AC-10 @FR-4 @regression" docs/roadmap/features/356-fix-analysis-held-position-drains/acceptance.feature
grep -n "on-demand opportunity recompute" docs/roadmap/features/356-fix-analysis-held-position-drains/acceptance.feature
grep -c "^  @AC-" docs/roadmap/features/356-fix-analysis-held-position-drains/acceptance.feature   # → 10
grep -n "_opportunity_refresh_tick\|daily refresh" docs/roadmap/features/356-fix-analysis-held-position-drains/product-spec.md
```

---

### Step 2 — service: Shared fail-closed positions drain; `_drain_held_symbols` and `ScreenSymbols` use it

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: xstockstrat-analysis service owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Exception precedent: `class _BarFetchError(Exception)` (`servicer.py:385`) and `class _FundamentalsPageError(Exception)` (`servicer.py:389`).
- Paged-helper precedent, module level: `async def _fetch_historical_fundamentals_paged(stub, symbol, metadata)` (`servicer.py:6674`), raising `_FundamentalsPageError` on a stalled cursor or the page cap; imported by `live_loop.py:41-42`.
- Constants: `_BAR_PAGE_SIZE = 1000` (`servicer.py:298`), `_MAX_DRAIN_PAGES = 50` (`servicer.py:347`).
- `_drain_held_symbols` (`servicer.py:6406-6439`; +2 since spec time from main-dev `756a24a7`'s delisted-binding filter in `_drain_watchlist_bindings`): `None`-portfolio early return `{}` (`:6415`); loop `for _ in range(_MAX_DRAIN_PAGES)` (`:6419`); `ListPositionsRequest(user_id=..., page=common_pb2.PageRequest(page_size=_BAR_PAGE_SIZE, page_token=page_token))` with `metadata=propagation_meta` (`:6421-6429`); `except grpc.RpcError` → `log.warning("ListOpportunities: ListPositions failed: %s", e)` → `return held` (`:6430-6432`); per-page sum `held[norm] = held.get(norm, 0.0) + abs(p.market_value)` (`:6433-6435`); token exit `:6436-6439`.
- `ScreenSymbols` cross-ref (`servicer.py:3933-3941`): `user_id = self._caller_user_id(context)`, `held = await self._drain_held_symbols(user_id, propagation_meta)`, then `if _normalize_symbol(r.symbol) in held: r.held = True`; no try/except.
- `_compute_opportunities` gathers `_drain_held_symbols` without `return_exceptions` (`servicer.py:5365-5370`); kick path `_run` catches `Exception`, logs with `exc_info=True` and records `record_opportunity_recompute("full", "failed")` (`servicer.py:4940-4958`). Not edited (design § 3, R-5).
- Header propagation: unchanged; the helper receives the caller's `metadata` and passes it through as `metadata=` (C-03, PLAT-4). No new outbound call.
- No Python `page_token` equality guard exists in `services/xstockstrat-analysis/app` today (recon.md:56).

**TDD**: red-green required

**Covers**: —

**Instructions**:
1. After `class _FundamentalsPageError` (`servicer.py:389-390`), add `class _PositionsPageError(Exception)` with a one-line docstring in the style of its neighbours ("Raised when positions pagination cannot complete safely (page error, repeated token, page cap)."). It must not subclass `ValueError` (D-2; `live_loop.py:409` treats `ValueError` as the ownerless skip).
2. Next to `_fetch_historical_fundamentals_paged` (module level, `servicer.py:6674`), add `async def _drain_positions_paged(stub, user_id, metadata) -> list` (D-1, D-2, D-6):
   - `rows: list = []`, `token = ""`; loop `for _ in range(_MAX_DRAIN_PAGES)`.
   - `try:` covers only the page body: `resp = await stub.ListPositions(portfolio_pb2.ListPositionsRequest(user_id=user_id, page=common_pb2.PageRequest(page_size=_BAR_PAGE_SIZE, page_token=token)), metadata=metadata)`, `page = list(resp.positions)`, `nxt = resp.page.next_page_token`. `except Exception as e: raise _PositionsPageError(f"{user_id}: ListPositions failed: {e}") from e`.
   - After that `try`: `rows.extend(page)`; `if not nxt: return rows`; `if nxt == token: raise _PositionsPageError(f"{user_id}: ListPositions repeated page token")`; `token = nxt`.
   - After the loop: `log.warning(...)` naming `user_id` and the cap `_MAX_DRAIN_PAGES` (e.g. `"ListPositions(%s) exceeded %d pages with a token pending"`), then `raise _PositionsPageError(...)` naming both.
   - No `max_pages` / `page_size` parameters (R-4). No partial return on any failure path. `next == sent` misses an A→B→A cycle; the cap is the backstop (accepted open risk). Portfolio clamps the page size to 100 (`services/xstockstrat-portfolio/internal/repository/portfolio_repo.go:137-138`), so the effective bound is 5,000 positions per owner (accepted; R-7 is the follow-up). Do not add comments restating this (CLAUDE.md rule 5).
3. Rewrite the body of `_drain_held_symbols` (after its docstring, `servicer.py:6415-6439`): keep `if self._portfolio is None: return {}`; then `rows = await _drain_positions_paged(self._portfolio, user_id, propagation_meta)`; build `held` by summing `abs(p.market_value)` per `_normalize_symbol(p.symbol)` over `rows`; return it. No try/except (the error reaches `_compute_opportunities` → `_run`, R-5). Keep the docstring; drop nothing else.
4. In `ScreenSymbols` (`servicer.py:3933-3941`) wrap only the drain: `try: held = await self._drain_held_symbols(user_id, propagation_meta)` / `except _PositionsPageError as e: log.warning("ScreenSymbols: held cross-reference skipped for user=%s: %s", user_id, e); held = {}`. Keep `user_id = self._caller_user_id(context)` outside the `try`. The response is still returned with no row marked `held`.
5. Do not touch `_compute_opportunities`, `_kick_opportunity_recompute`, `_opportunity_refresh_tick` (Step 6), the out-of-scope sibling drains (`servicer.py:6006`, `:6371`) or the constants.

**Verification**:
```bash
( cd services/xstockstrat-analysis && uv run ruff check . && uv run ruff format --check . )
( cd services/xstockstrat-analysis && uv run pytest tests/test_analysis_servicer.py tests/test_owner_header_guard.py tests/test_opportunities_latency.py tests/test_unreadable_formula.py -q )
( grep -n "class _PositionsPageError\|async def _drain_positions_paged\|except _PositionsPageError" services/xstockstrat-analysis/app/handlers/servicer.py )
# helper forwards the caller's propagation metadata (C-03)
( grep -n "metadata=metadata" services/xstockstrat-analysis/app/handlers/servicer.py )
```

---

### Step 3 — test: Servicer held drain, ScreenSymbols and on-demand recompute fail closed (red first)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_held_position_drains.py` — create
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify
- `services/xstockstrat-analysis/tests/test_analysis_tick_telemetry.py` — modify

**Reviewers**: xstockstrat-analysis service owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `make_servicer()` (`tests/test_analysis_servicer.py:44`) passes no `portfolio_channel`, so `svc._portfolio is None` (`servicer.py:556-560`); the tests assign a whole stub `svc._portfolio = SimpleNamespace(ListPositions=AsyncMock(side_effect=...))` (R-13). `_strategies_repo` is `None` without a `db_pool` (`servicer.py:564`).
- RpcError fake: `aio_rpc_error(code, details="")` returns a `grpc.aio.AioRpcError` (`tests/conftest.py:145-147`), a `grpc.RpcError` subclass (D-5 substance kept by D-12).
- Screener harness: `class TestScreenSymbolsHeld` / `test_held_marked_from_positions` (`tests/test_analysis_servicer.py:6490`, `:6492`; its empty-token `pos_resp.page.next_page_token = ""` at `:6511`), building the servicer, stubbing `_marketdata.GetBars`, `_indicators.ComputeIndicator`, `_ingest.ListSignalSources`, then `await svc.ScreenSymbols(analysis_pb2.ScreenSymbolsRequest(symbols=["AAPL", "MSFT"]), _ctx(_HEADERS))`.
- Recompute harness: `_refresh_svc(user_ids, compute=None)` (`tests/test_analysis_tick_telemetry.py:44-50`) sets `svc._compute_opportunities` as an instance attribute and `svc._replace_and_stamp_compute_state = AsyncMock()`; `_drain_background()` (`:53-55`); the AC-51 exc_info pattern (`:174-184`); `metric_sum`, `all_attribute_values` imported from `tests.test_live_loop_telemetry` (`:17`); `metric_reader = test_telemetry.metric_reader` (`:29`). The file has no `from tests.conftest` import yet; this step adds it (for `aio_rpc_error`), which Step 7's verification grep also relies on. The `_compute_opportunities` ListPositions `AsyncMock` precedent is `tests/test_analysis_servicer.py:4815`.
- Kick path `svc._kick_opportunity_recompute(user_id, meta)` → `_run` (`servicer.py:4933-4961`).
- Sibling drains to stub empty: `_drain_active_signals -> list` (`servicer.py:6365`), `_drain_watchlist_bindings -> list[tuple[str, str]]` (`:5995`), `_drain_source_weights -> dict[str, float]` (`:6391`).
- Recon: no existing test fake ignores `page_token` (recon.md:56, :99).
- C-13: the ListPositions fakes in `test_held_position_drains.py` are shared by Steps 3 and 5 **within one file** (one consumer module); the AC-5 / AC-6 fakes are one-offs in their own files and reuse the canonical `aio_rpc_error` from `tests/conftest.py`. No second inline copy of a domain literal across files, so no new conftest entry.

**Lands with**: —

**TDD**: red-green required

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-8, AC-9`

**Instructions**:
1. Create `tests/test_held_position_drains.py` with module-level `ListPositions` fake factories, each returning `(AsyncMock, calls)` or an `AsyncMock` whose `await_count` / `await_args_list` the tests read, with responses built from `SimpleNamespace(positions=[SimpleNamespace(symbol=..., market_value=...)], page=SimpleNamespace(next_page_token=...))`:
   - `_ignore_token()` — ignores `req.page.page_token`, always one AAPL position (market_value 100) and `next_page_token="t"` (AC-1; the fails.md:3311 fake).
   - `_distinct_tokens()` — one AAPL row per page and `next_page_token=f"p{n}"` for an incrementing `n`, never empty (AC-2).
   - `_page2_raises()` — page 1 (`page_token == ""`) returns AAPL with `next_page_token="p2"`; page 2 raises `aio_rpc_error(grpc.StatusCode.UNAVAILABLE, "portfolio down")` (AC-3).
   - `_honor_token(pages)` — follows `page_token` across the given pages (AAPL 100 / MSFT 200 / NVDA 300; last page `next_page_token=""`) (AC-8); a single page AAPL `market_value=-150`, empty token (AC-9).
   These are written once and reused by Step 5's live-loop tests in the same file.
2. Servicer tests (`svc = make_servicer(); svc._portfolio = SimpleNamespace(ListPositions=fake)`; call `await svc._drain_held_symbols("u-1", OWNER_HEADERS)` with `OWNER_HEADERS` from `tests/conftest.py:150`). For every failure case assert the raise first, then the type, so the RED on the current tree is behavioural (DID NOT RAISE / wrong count), not an attribute error:
   - AC-1: `with pytest.raises(Exception) as ei:`; `assert isinstance(ei.value, servicer_mod._PositionsPageError)`; `fake.await_count == 2`. (Today: 50 calls, returns `{"AAPL": 5000.0}`.)
   - AC-2: raises; `await_count == 50`; a WARNING record whose message contains `"u-1"` and `"50"` (`caplog.at_level(logging.WARNING)`). (Today: returns silently.)
   - AC-3: raises `_PositionsPageError` with `__cause__` an `AioRpcError`; no return value holding AAPL. (Today: returns `{"AAPL": 100.0}`.)
   - AC-4 (guard, FR-6): `ListPositions` raises `RuntimeError("boom")` on page 1; raises and `isinstance(ei.value, servicer_mod._PositionsPageError)`. Record "red N/A — guard (FR-6); the raw `RuntimeError` already propagates, the type pin is new" for AC-4 only.
   - AC-8: returns `{"AAPL": 100.0, "MSFT": 200.0, "NVDA": 300.0}`; `await_count == 3`.
   - AC-9: returns `{"AAPL": 150.0}`; `await_count == 1`.
   Import the module as `import app.handlers.servicer as servicer_mod` so the file imports cleanly against the pre-Step-2 tree.
3. AC-6, in `TestScreenSymbolsHeld` (`tests/test_analysis_servicer.py:6490`): add `test_failed_held_drain_marks_no_row_held(self, caplog)`, copying the stubs of `test_held_marked_from_positions` but with `svc._portfolio.ListPositions` = page 1 AAPL `next_page_token="p2"`, page 2 raises `aio_rpc_error(grpc.StatusCode.UNAVAILABLE)` (import from `tests.conftest`, already imported there at `:41`). Assert the RPC returns results, the AAPL row has `held is False`, and one WARNING record mentions the held cross-reference. (Today: AAPL `held is True`.)
4. AC-5, in `tests/test_analysis_tick_telemetry.py` after the AC-51 tests (`:174-199`): `test_ac5_failed_held_drain_fails_on_demand_recompute(metric_reader, caplog)`. Add `from tests.conftest import aio_rpc_error` to this file's imports (none exists today):
   - `svc = _refresh_svc(_OWNERS)` then `del svc._compute_opportunities` so the real `AnalysisServicer._compute_opportunities` and the real `_drain_held_symbols` run (R-9).
   - Stub only the siblings: `svc._drain_active_signals = AsyncMock(return_value=[])`, `svc._drain_watchlist_bindings = AsyncMock(return_value=[])`, `svc._drain_source_weights = AsyncMock(return_value={})`.
   - `svc._portfolio = SimpleNamespace(ListPositions=AsyncMock(side_effect=aio_rpc_error(grpc.StatusCode.UNAVAILABLE)))` (page 1 raises).
   - Run `svc._kick_opportunity_recompute("u-tick-1", ())` and `await _drain_background()` under `caplog.at_level(logging.INFO)`.
   - Assert `svc._replace_and_stamp_compute_state.await_count == 0` (previous queue kept), `recompute{kind=full,outcome=failed} == 1`, `recompute{outcome=ok} == 0`, the "opportunity recompute failed" record's `exc_info[0] is servicer_mod._PositionsPageError` (checked last), and no attribute value contains `"u-tick-1"`.
   (Today: the RpcError is swallowed, the drain returns `{}`, the replace is awaited and `ok == 1`.)
5. Write these tests and run them against the pre-Step-2 tree **before** applying Step 2's change. Record the RED in context.md (each failing test id and its failure reason, e.g. DID NOT RAISE / `await_count` 50 != 2 / AAPL `held is True` / `ok == 1`; AC-4 noted as guard). Then apply Step 2 and record GREEN. The commit history will not show the red state, so this context.md record is the only evidence (C-08).

**Verification**:
```bash
( cd services/xstockstrat-analysis && uv run ruff check . && uv run ruff format --check . )
( cd services/xstockstrat-analysis && uv run pytest tests/test_held_position_drains.py tests/test_analysis_servicer.py::TestScreenSymbolsHeld tests/test_analysis_tick_telemetry.py -q )
( cd services/xstockstrat-analysis && uv run pytest --cov=app --cov-fail-under=40 )
# aio_rpc_error from the canonical home (C-13)
( grep -n "conftest\|from tests.conftest" services/xstockstrat-analysis/tests/test_held_position_drains.py services/xstockstrat-analysis/tests/test_analysis_tick_telemetry.py )
```

---

### Step 4 — service: Live-loop held drain fails closed; the cycle skips a failed owner once

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/live_loop.py` — modify

**Reviewers**: xstockstrat-analysis service owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Import block from the servicer: `from app.handlers.servicer import (_fetch_historical_fundamentals_paged, _normalize_symbol, ...)` (`live_loop.py:41-50`).
- `_drain_held` (`live_loop.py:563-590`): `if self._portfolio is None: return set()` (`:566-567`); `meta = owner_metadata(owner)` (`:568`, raises `ValueError` on an empty owner); `except Exception as e: log.warning(...); telemetry.record_live_loop_drain_failure("held"); return out` (`:582-585`); token exit `:586-589`; silent cap `:590`.
- `_DRAIN_PAGES = 50`, `_DRAIN_PAGE_SIZE = 1000` (`live_loop.py:66-67`) stay: still used by the out-of-scope `_drain_watchlist` / `_drain_owner_signals` / fundamentals drains.
- Cycle (`live_loop.py:391-411`): `held_cache` / `watch_cache` (`:391-392`); `try:` `if owner not in held_cache: held_cache[owner] = await self._drain_held(owner); watch_cache[owner] = await self._drain_watchlist(owner)` (`:400-403`); only handler `except ValueError as e: log.warning("live_loop: strategy %s skipped — %s", definition.strategy_id, e); continue` (`:409-411`).
- Pattern to reuse: entry-backfill `failed_owners` short-circuit (`entry_backfill.py:142-144`, `:150-159`).
- Telemetry: `record_live_loop_drain_failure(source)` has no owner attribute (`app/telemetry.py:465-467`).
- Callers of `_drain_held`: `live_loop.py:402`, `entry_backfill.py:148` (grep over `app/`). The backfill's `except Exception` (`entry_backfill.py:150-159`) already isolates the owner; no change there (`@AC-8 @feature-262`).
- Callers of `_drain_held_symbols` (for completeness): `servicer.py:3935`, `:5367`. No other `_drain_held(`/`_drain_held_symbols(` caller exists.
- Test call sites broken by the new raise: `tests/test_live_loop_telemetry.py:123-129` (`held = await loop._drain_held("o-1")`; `assert held == set()`), repaired in Step 5. `tests/test_owner_header_guard.py:411-419` (empty-owner parametrize at `:411`) stays green (`ValueError` before any RPC).

**Lands with**: `Step 5`

**TDD**: red-green required

**Covers**: —

**Instructions**:
1. Add `_PositionsPageError` and `_drain_positions_paged` to the `from app.handlers.servicer import (...)` block (`live_loop.py:41-50`), keeping ruff's sort order.
2. Rewrite `_drain_held` (`live_loop.py:563-590`) (D-4):
   - Keep the `None`-portfolio `return set()` and `meta = owner_metadata(owner)` before any RPC.
   - `try: rows = await _drain_positions_paged(self._portfolio, owner, meta)` / `except _PositionsPageError: telemetry.record_live_loop_drain_failure("held"); raise` — no log line here (the caller logs; the helper logs the cap).
   - `return {_normalize_symbol(p.symbol) for p in rows}`.
   - Update the docstring's "Best-effort." to say a failed drain is counted and raised.
3. In the cycle (`live_loop.py:391-411`) (D-3, D-10):
   - Add `failed_owners: set[str] = set()` next to `held_cache` / `watch_cache`.
   - Before the `try:` (after `owner = definition.user_id`), `if owner in failed_owners: continue` — no log line.
   - Add `except _PositionsPageError as e:` **before** `except ValueError` that logs one WARNING naming `definition.strategy_id` and `owner` (e.g. `"live_loop: strategy %s owner %s skipped — held drain failed: %s"`), adds `owner` to `failed_owners`, and `continue`s.
   - Do not broaden to `except Exception` (R-2). Do not touch the `ValueError` branch.
4. The entry backfill is unchanged. A transient boot-time held-drain failure leaves that owner's entry-backfill state unseeded until restart (`entry_backfill.py:52-58,142-159,199-202`): accepted open risk, covered by the unchanged `@AC-8 @feature-262` test.

**Verification**:
```bash
( cd services/xstockstrat-analysis && uv run ruff check . && uv run ruff format --check . )
( cd services/xstockstrat-analysis && uv run pytest tests/test_live_loop.py tests/test_live_loop_telemetry.py tests/test_entry_backfill.py tests/test_owner_header_guard.py -q )
( grep -n "except _PositionsPageError\|failed_owners" services/xstockstrat-analysis/app/engine/live_loop.py )
# header propagation unchanged (C-03)
( grep -n "owner_metadata(owner)" services/xstockstrat-analysis/app/engine/live_loop.py )
```

---

### Step 5 — test: Live-loop held drain and cycle fail closed (red first); flip the AC-16 test

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_held_position_drains.py` — modify
- `services/xstockstrat-analysis/tests/test_live_loop_telemetry.py` — modify

**Reviewers**: xstockstrat-analysis service owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Live-loop harness: `_make_loop()` (`tests/test_live_loop.py:37-59`), `_live_row(strategy_id, user_id, symbols=None, ...)` (`:647-660`), the per-owner cycle pattern with `loop._eval_pair = fake_eval` recording `(defn.user_id, symbol)` and `await loop._run_cycle()` (`tests/test_live_loop.py:900-930`).
- `_wire_drains(loop, list_positions=...)` (`tests/test_live_loop_telemetry.py:55-62`) sets EOF `ListWatchlists` / `QuerySignals`; `metric_sum` (`:34`), `all_attribute_values` (`:43`), `metric_reader = test_telemetry.metric_reader` (`:28`). The file already imports `common_pb2` / `portfolio_pb2` and ends with a `test_ac8_delisted_binding` test (main-dev).
- `test_ac16_failed_held_drain_counted_without_owner` (`tests/test_live_loop_telemetry.py:123-129`): `RuntimeError("portfolio down")` side effect, `assert held == set()`, metric == 1, no `"o-1"` attribute.
- `resolve_universe`: a non-empty `signal_params.symbols` allowlist is the universe verbatim, else `watchlist ∪ held ∪ ...` (`live_loop.py:126-128,150-152`), so o-1 strategies with `symbols=["AAPL"]` are evaluated today even when the held drain fails (non-vacuous RED for AC-7), and an o-2 strategy with no allowlist evaluates exactly its held set.
- `ListPositions` request carries `user_id=owner` and `metadata=owner_metadata(owner)` (`live_loop.py:568-580`), so a fake can branch on `req.user_id`.

**Lands with**: `Step 4`

**TDD**: red-green required

**Covers**: `AC-1, AC-2, AC-3, AC-7, AC-8, AC-9`

**Instructions**:
1. In `tests/test_held_position_drains.py`, reuse the Step-3 fakes on `loop = _make_loop(); _wire_drains(loop, list_positions=fake)` and `await loop._drain_held("o-1")` (raise asserted before type, as in Step 3):
   - AC-1: raises, `isinstance(ei.value, servicer_mod._PositionsPageError)`, `await_count == 2`, `drain_failures{source=held} == 1`.
   - AC-2: raises, `await_count == 50`, a WARNING containing `"o-1"` and `"50"`, `drain_failures{held} == 1`.
   - AC-3: raises (no set holding AAPL returned), `drain_failures{held} == 1`.
   - AC-8: returns `{"AAPL", "MSFT", "NVDA"}`, `await_count == 3`. AC-9: returns `{"AAPL"}`, `await_count == 1`.
2. AC-7 cycle test: `loop._db.fetch = AsyncMock(return_value=[_live_row("s1", "o-1", symbols=["AAPL"]), _live_row("s2", "o-1", symbols=["AAPL"]), _live_row("s3", "o-2")])`; `ListPositions` side effect raises `aio_rpc_error(grpc.StatusCode.UNAVAILABLE)` when `req.user_id == "o-1"` and returns one MSFT page with an empty token for `"o-2"`; record `seen` via `loop._eval_pair`; `await loop._run_cycle()`. Assert: no `seen` entry has user `"o-1"`; `ListPositions` awaited exactly once with `user_id == "o-1"`; `drain_failures{held} == 1`; `{s for u, s in seen if u == "o-2"} == {"MSFT"}`; no attribute value contains `"o-1"`; exactly one WARNING naming `s1` and `o-1`. (Today: s1/s2 are evaluated on AAPL.)
3. Flip `test_ac16_failed_held_drain_counted_without_owner` (`tests/test_live_loop_telemetry.py:123-129`): replace `held = await loop._drain_held("o-1")` / `assert held == set()` with `with pytest.raises(_PositionsPageError): await loop._drain_held("o-1")` (import from `app.handlers.servicer`); keep the metric == 1 and no-`"o-1"` assertions unchanged (`@AC-16 @feature-294` PRESERVE, operator decision).
4. As one unit with Step 4: run items 1-2 against the Step-3 tree and record the RED (AC-1/2/3 DID NOT RAISE, AC-7 o-1 evaluated), then apply Step 4 and record GREEN.

**Verification**:
```bash
( cd services/xstockstrat-analysis && uv run ruff check . && uv run ruff format --check . )
( cd services/xstockstrat-analysis && uv run pytest tests/test_held_position_drains.py tests/test_live_loop_telemetry.py tests/test_live_loop.py tests/test_entry_backfill.py tests/test_owner_header_guard.py -q )
( cd services/xstockstrat-analysis && uv run pytest --cov=app --cov-fail-under=40 )
# reuses existing harness/fixture homes (C-13)
( grep -n "from tests.conftest\|from tests.test_live_loop" services/xstockstrat-analysis/tests/test_held_position_drains.py )
```

---

### Step 6 — service: Daily opportunity refresh counts a failed user on `recompute{full,failed}`

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: xstockstrat-analysis service owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `_opportunity_refresh_tick` per-user loop (`servicer.py:6056-6069`): `meta = owner_metadata(uid)` (`:6059`); `rows = await self._compute_opportunities(uid, meta)` / `await self._replace_and_stamp_compute_state(uid, rows, meta)` (`:6061-6062`); `except Exception as e:  # one bad user never kills the pass` (`:6063`) → `failed += 1` (`:6064`) → `log.warning("opportunity daily refresh failed for user=%s: %s", uid, e)` (`:6065`); `schedule.advance(...)` (`:6068`) and `_log_items_tick(...)` (`:6069`) after the loop.
- Instrument: `record_opportunity_recompute(kind, outcome)` with `kind: full | retry; outcome: ok | failed` (`app/telemetry.py:484-486`); existing call `telemetry.record_opportunity_recompute("full", "failed")` (`servicer.py:4957`, today the only such site) and the `exc_info=True` precedent (`servicer.py:4955`).
- `_log_items_tick` (`servicer.py:377-382`) emits no failed count; untouched (R-8).

**TDD**: red-green required

**Covers**: —

**Instructions**:
1. In the per-user `except Exception as e:` of `_opportunity_refresh_tick` (`servicer.py:6063-6065`): add `exc_info=True` to the existing `log.warning(...)`, and add `telemetry.record_opportunity_recompute("full", "failed")` after `failed += 1` (D-11).
2. Nothing else: no new instrument or label value (R-10), no daily `ok` (R-12), no count inside `_compute_opportunities` (R-11), `_log_items_tick` and `schedule.advance` unchanged. If every user fails (a portfolio outage at the refresh hour), the counter rises by N, no `loop tick ok` is written and all queues stay stale ~24h: accepted open risk. The counter also counts non-drain per-user failures (`owner_metadata` `ValueError`, lock or replace errors): accepted scope, documented in Step 8.

**Verification**:
```bash
( cd services/xstockstrat-analysis && uv run ruff check . && uv run ruff format --check . )
( cd services/xstockstrat-analysis && uv run pytest tests/test_analysis_tick_telemetry.py tests/test_telemetry_allowlist.py -q )
# → two sites (kick path, daily refresh)
( grep -n 'record_opportunity_recompute("full", "failed")' services/xstockstrat-analysis/app/handlers/servicer.py )
```

---

### Step 7 — test: Daily-refresh failed user is counted and keeps its queue (red first); allowlist drive

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_tick_telemetry.py` — modify
- `services/xstockstrat-analysis/tests/test_telemetry_allowlist.py` — modify

**Reviewers**: xstockstrat-analysis service owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `_refresh_svc` (`tests/test_analysis_tick_telemetry.py:44-50`); `_schedule()` from `tests.test_strategy_templates` (`tests/test_strategy_templates.py:612-615`, an `AsyncMock` with `next_sleep_seconds` → 0.0); `test_opportunity_refresh_tick_record_ok_idle_and_none` (`:61-79`, no metric assertions, unaffected by Step 6).
- `owner_metadata(uid)` sets `x-user-id` (`servicer.py:6059`), so the fake branches on `dict(metadata)["x-user-id"]` (D-13, R-13: a shared `side_effect` cannot fail u-1 while u-2 succeeds).
- Allowlist `_drive()` (`tests/test_telemetry_allowlist.py:46-55`) already calls `record_opportunity_recompute("full", "ok")` (`:52`); AC-41 checks label keys only (`:70-76`).

**TDD**: red-green required

**Covers**: `AC-10`

**Instructions**:
1. In `tests/test_analysis_tick_telemetry.py` add `test_ac10_daily_refresh_failed_user_counted_and_queue_kept(metric_reader, caplog)`:
   - `svc = _refresh_svc(("u-1", "u-2"))`; `del svc._compute_opportunities`; stub the three sibling drains empty as in Step 3.
   - `ListPositions` fake: `aio_rpc_error(grpc.StatusCode.UNAVAILABLE)` when `dict(metadata)["x-user-id"] == "u-1"`, else `SimpleNamespace(positions=[], page=SimpleNamespace(next_page_token=""))`; assign `svc._portfolio = SimpleNamespace(ListPositions=AsyncMock(side_effect=fake))`.
   - `schedule = _schedule()`; `await svc._opportunity_refresh_tick(schedule)` under `caplog.at_level(logging.INFO)`.
   - Assert: `_replace_and_stamp_compute_state` awaited for `"u-2"` and never for `"u-1"` (inspect `await_args_list` first positional arg); `recompute{kind=full,outcome=failed} == 1`; `recompute{outcome=ok} == 0`; no attribute value contains `"u-1"`; `schedule.advance` awaited once; the "opportunity daily refresh failed" record for u-1 has `exc_info[0] is servicer_mod._PositionsPageError`.
   - RED on the Step-5 tree: `failed == 0` and `exc_info` is unset.
2. In `tests/test_telemetry_allowlist.py` `_drive()` add `telemetry.record_opportunity_recompute("full", "failed")` after the `("full", "ok")` call (`:52`) (D-14). It exercises existing keys only, so it is a guard (no RED expected; say so in context.md).
3. Leave `test_ac51_failed_full_recompute_counted_with_traceback` (`:174-184`) unchanged: kick-path-only at exactly 1 (`@AC-51 @feature-294` EXTEND, text unedited, D-16).
4. Write item 1 and run it against the Step-5 tree **before** applying Step 6. Record the RED in context.md (test id, `failed == 0`, `exc_info` unset), then apply Step 6 and record GREEN (C-08; the commit history will not show the red state).

**Verification**:
```bash
( cd services/xstockstrat-analysis && uv run ruff check . && uv run ruff format --check . )
( cd services/xstockstrat-analysis && uv run pytest tests/test_analysis_tick_telemetry.py tests/test_telemetry_allowlist.py -q )
( cd services/xstockstrat-analysis && uv run pytest --cov=app --cov-fail-under=40 )
# aio_rpc_error from the canonical home (C-13); the import is added by Step 3
( grep -n "from tests.conftest" services/xstockstrat-analysis/tests/test_analysis_tick_telemetry.py )
```

---

### Step 8 — docs: Analysis CLAUDE.md Observability caveat for `recompute{full,failed}`

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `## Observability (feature 294-signal-map-instrumentation)` (`services/xstockstrat-analysis/CLAUDE.md:324`); the `loop tick ok` bullet (`:326`); the Instruments bullet ending `analysis.opportunity.recompute{kind full|retry, outcome ok|failed}`, `template.instantiate{service, outcome}`.` (`:327`).

**TDD**: N/A (docs)

**Covers**: —

**Instructions**:
1. Append one clause to the Instruments bullet (`:327`): `recompute{kind=full,outcome=failed}` counts both kick-path recompute failures and daily-refresh per-user failures (any exception the per-user catch handles, not only held-drain failures); `ok` is kick-path only, so no failed/(ok+failed) ratio over `kind=full` is meaningful.
2. Leave the `loop tick ok` bullet at `:326` word for word (D-16).

**Verification**:
```bash
sed -n 324,330p services/xstockstrat-analysis/CLAUDE.md
git diff --stat -- services/xstockstrat-analysis/CLAUDE.md   # one line changed
git diff -U0 -- services/xstockstrat-analysis/CLAUDE.md | grep -c "loop tick ok"   # → 0 (line :326 untouched)
```

---

### Step 9 — docs: Register `analysis_opportunity_recompute_total` in produced-signals.tsv

**Status**: `pending`
**Service**: `packages/otel`
**Files**:
- `packages/otel/produced-signals.tsv` — modify

**Reviewers**: none

**Codebase Evidence**:
- Registry header `kind	identifier	producer-path	producer-literal`; `metric` rows `:2-10` (histogram `_count`/`_bucket`/`_sum`) and `metric	target_info	...` (last row).
- Producer literal: `"analysis.opportunity.recompute"` at `services/xstockstrat-analysis/app/telemetry.py:443`.
- Guard: `scripts/check-otel-produced-signals.py` `load_registry` / `produces` (`:180-195`) requires the literal to occur in the producer path; CI runs `python3 scripts/check-otel-produced-signals.py` (`.github/workflows/ci.yml:1161`).
- Series name verified in Mimir at spec time: `analysis_opportunity_recompute_total` (§ Mimir verification).

**TDD**: N/A (registry row; no runtime behaviour)

**Covers**: —

**Instructions**:
1. Append one tab-separated row in the existing `metric` layout: `metric	analysis_opportunity_recompute_total	services/xstockstrat-analysis/app/telemetry.py	analysis.opportunity.recompute`.
2. Add no comment to the tsv. The row exists by operator mandate (design gate r4), has no alert or dashboard consumer today, and is the first counter (`_total`) row; it does not set a convention. That is recorded in design.md, this spec and the PR description, not in the file.

**Verification**:
```bash
python3 scripts/check-otel-produced-signals.py
awk -F'\t' '$1=="metric" && $2=="analysis_opportunity_recompute_total" && $3=="services/xstockstrat-analysis/app/telemetry.py" && $4=="analysis.opportunity.recompute"' packages/otel/produced-signals.tsv   # → exactly one row
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### Deviation: Step 2 — Verification blocks re-spec'd to run as one shell (steps 2-7)
**Spec said**: each **Verification** fence ran `cd services/xstockstrat-analysis && …` lines in sequence, with a trailing `#` comment on the last line.
**Actual**: operator-directed re-spec (sequential-mode.md §5.3, commit `545825bf9`, before the step commit): each command line of Steps 2-7 is wrapped in its own `( … )` subshell, and each last-line comment moved onto its own line above. No command, path, flag or expected result changed.
**Reason**: run as one shell, the second `cd` resolved against the first one's directory and the trailing comment swallowed the wrapper's closing parenthesis, so the blocks could not run verbatim.
**Disposition**: operator decision (Option B, widened) on the Step 2 blocker.

### Deviation: Step 2 — RED captured with an uncommitted scratch probe
**Spec said**: `**TDD**: red-green required`; `**Covers**: —`; the paired tests are Step 3's (Step 3 item 5: run them against the pre-Step-2 tree).
**Actual**: Step 2 runs in its own agent and may stage only `servicer.py` (F-08), so Step 3's test file was not written here. RED/GREEN was captured with an uncommitted probe `.sdd-logs/red/test_step2_red.py` (5 cases: ignored token, cap, page-2 RpcError, metadata/sum characterization, ScreenSymbols degrade). RED: 4 failed, 1 passed (`DID NOT RAISE` ×3, AAPL `held` `True is False`); GREEN: 5 passed. Recorded in context.md.
**Reason**: red-before-green is mandatory, and the only committed tests for this behaviour belong to Step 3's **Files**.
**Disposition**: Step 3 must still record its own RED for its named test ids. The Step-2 commit is already on the branch, so that RED runs against the pre-Step-2 `servicer.py` (`git show 545825bf9:services/xstockstrat-analysis/app/handlers/servicer.py`).

### Deviation: Step 3 — RED run against a temporarily restored pre-Step-2 `servicer.py`
**Spec said**: item 5, write the tests and run them against the pre-Step-2 tree **before** applying Step 2.
**Actual**: Step 2 was already committed (`89d21e081`). For the RED run (`.sdd-logs/v-1.log`) the working-tree `servicer.py` was overwritten with `git show 545825bf9:services/xstockstrat-analysis/app/handlers/servicer.py`, the Step 3 Verification block was run verbatim, and the file was then restored with `git checkout --` (empty diff before GREEN and commit). The spec's AC-4 note expected "red N/A — guard"; on the pre-Step-2 tree AC-4 fails only at the new type pin (`AttributeError: ... no attribute '_PositionsPageError'`), the raw `RuntimeError` already propagates. AC-8 and AC-9 pass on the pre-Step-2 tree (success-path characterization; the spec claims no red for them).
**Reason**: the step-2 deviation's disposition requires Step 3 to record its own RED for its named test ids against the pre-Step-2 `servicer.py`.
**Disposition**: carried out as the Step 2 deviation directed; no commit holds the swapped file.
