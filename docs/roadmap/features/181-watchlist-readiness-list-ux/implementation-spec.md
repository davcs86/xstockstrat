# Implementation Spec: watchlist-readiness-list-ux

**Status**: `complete`
**Created**: 2026-09-06
**Feature**: `docs/roadmap/features/181-watchlist-readiness-list-ux/feature.md`
**Total Steps**: 12
**Feature Branch**: `feature/watchlist-readiness-list-ux`

---

## Execution Summary

Implements the `design.md` Chosen Approach: one **additive, cache-first** analysis RPC
(`AnalysisService.GetWatchlistReadiness`) decorates a keyset-paginated page of a watchlist's bound
`(symbol, strategy_id)` pairs with a readiness state, and the UI renders rows immediately and
self-heals `PENDING`/`UNKNOWN` rows by polling that same RPC. No portfolio→analysis edge is added
(FR-4): analysis reads the watchlist over the **existing** analysis→portfolio stub.

Order: **proto first** (Step 1) → **codegen** (Step 2) → the shared-compute **sentinel** change and
its test (Steps 3–4, the R-E infinite-`PENDING` fix that also touches shipped 177/180 — an
operator-approved scope deviation recorded in `context.md`) → the **new handler** and its test
(Steps 5–6) → the **UI** hook/component/BFF/mock (Steps 7–10) → the **UI e2e** (Step 11) → **docs**
(Step 12). Steps 3–4 precede Step 5 because the handler's classifier depends on the `-1` sentinel
being written by `compute_readiness_row`.

**Consumer surface (C-14):** the product spec names only **UI `/insights` (`/insights/watchlists`)** —
an existing page (no new nav route, so no `PLATFORM_SUBNAV`/C-10(a) step). The Agent surface is
explicitly out of scope (no agent hand-projection of `SymbolReadiness`/readiness messages —
re-verified, recon.md:35 / design.md ledger note fails.md:1151). Steps 7–11 land the change on
`/insights/watchlists`.

### Scenario Coverage (C-15)

| Scenario | Covered by step(s) |
|---|---|
| `@AC-1` immediate render + per-row loading | Step 11 (UI e2e) |
| `@AC-2` one readiness failure degrades one row, not the list | Step 11 (UI e2e) |
| `@AC-3` inline decoration for the visible page, no client fan-out, warm FAST serve | Step 11 (UI e2e) + Step 6 (backend FAST serve) |
| `@AC-4` long watchlist paginates, only the visible page evaluated | Step 11 (UI e2e) + Step 6 (backend keyset paging) |
| `@AC-5` no analysis→portfolio cycle | Step 6 (backend structural assertion) |
| `@AC-6` C-17 primitives + a11y baseline | Step 11 (UI e2e) |

The R-E four-way classifier + `-1` sentinel and the re-verified feature-177 @AC-1/@AC-2 (design R-A)
are RED-tested in Steps 4 and 6; Step 6 also adds the durable C-16 scenario to the analysis readiness
suite. This feature's own `acceptance.feature` scenarios are promoted into the durable per-service
suites at launch (C-16, `/sdd-execute` integration PR).

## Step Dependencies

- Step 2 (proto-gen) requires Step 1 (proto): stubs regenerate from the edited `.proto`.
- Step 4 (test) covers Step 3 (service) — the shared-compute sentinel; red-before-green.
- Step 5 (service, handler) requires Step 2 (generated `GetWatchlistReadiness` stubs) **and** Step 3
  (the `-1` sentinel the classifier maps to `UNKNOWN`).
- Step 6 (test) covers Step 5 (service).
- Steps 7–9 (UI hook/component/BFF) require Step 2 (the browser typed client gains
  `getWatchlistReadiness` from the regenerated `AnalysisService`).
- Step 10 (e2e mock) must precede Step 11 (UI e2e) — a new BFF gRPC call with no mock reddens CI e2e
  though local passes (fails.md:1281/1317, :96/PR position-and-order-detail-pages).
- Step 11 (UI e2e) requires Steps 7–10.

---

### Step 1 — proto: add `GetWatchlistReadiness` RPC, `WatchlistReadinessRow`, `ReadinessState`

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/analysis/v1/analysis.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking change, `buf lint`/`buf breaking`; `xstockstrat-analysis` — readiness contract shape

**Codebase Evidence**:
- `AnalysisService` service block: `analysis.proto:12-53`; last RPC is `rpc GetAttribution(GetAttributionRequest) returns (GetAttributionResponse);` at `analysis.proto:52`. New RPC appends after it (before the closing `}` at `:53`).
- `SymbolReadiness { string symbol=1; double conviction=2; int32 passing_conditions=3; int32 total_conditions=4; repeated ConditionEval conditions=5; }` at `analysis.proto:595-601` — **reused** as the verdict payload (no new readiness-shape message).
- Pagination + header-owner precedent: `ListOpportunitiesRequest { xstockstrat.common.v1.PageRequest page=1; double min_conviction=2; }` / `ListOpportunitiesResponse { repeated Opportunity opportunities=1; xstockstrat.common.v1.PageResponse page=2; }` at `analysis.proto:617-626`, with the comment "user_id is intentionally absent — taken from the propagated x-user-id header" (`:614-616`).
- `common.v1.PageRequest { int32 page_size=1; string page_token=2; }` / `PageResponse { string next_page_token=1; ... }` at `common/v1/common.proto:10-16`; already imported at `analysis.proto:10`.
- Enum-value-prefix convention (buf STANDARD lint, `buf.yaml:6-11` uses `STANDARD` with no `ENUM_VALUE_PREFIX` exception): existing enums prefix every value with the enum name — `ConditionState { CONDITION_STATE_UNSPECIFIED=0; CONDITION_STATE_PASS=1; ... }` (`analysis.proto:535-539`), `ReadinessRule { READINESS_RULE_UNSPECIFIED=0; ... }` (`analysis.proto:629-633`). **The design.md shorthand `RESOLVED=1` must be written prefixed as `READINESS_STATE_RESOLVED=1` or `buf lint` fails C-09** — grounded correction of design.md's shorthand.

**TDD**: `N/A (proto)`

**Covers**: `—`

**Instructions**:
1. Append the RPC inside the `AnalysisService` block, immediately after `GetAttribution` (`analysis.proto:52`), with a one-line doc comment:
   ```proto
   // Cache-first readiness decoration for a page of a watchlist's bound (symbol, strategy_id)
   // pairs (feature 181). Owner from x-user-id; RESOLVED rows carry inline SymbolReadiness,
   // PENDING/UNKNOWN rows resolve on a subsequent poll (the server kicks a background refresh).
   rpc GetWatchlistReadiness(GetWatchlistReadinessRequest) returns (GetWatchlistReadinessResponse);
   ```
2. Append the new messages + enum after `EvaluateReadinessResponse` (`analysis.proto:644-649`), mirroring the `ListOpportunities*` header-owner convention:
   ```proto
   // Per-row readiness lifecycle state (feature 181). Closed set → enum (C-04).
   enum ReadinessState {
     READINESS_STATE_UNSPECIFIED = 0;
     READINESS_STATE_RESOLVED = 1;  // `readiness` populated; served from the FAST cache path
     READINESS_STATE_PENDING = 2;   // not-yet-fresh; a background refresh was kicked; poll again
     READINESS_STATE_UNKNOWN = 3;   // data-unavailable (bar_epoch < 0 sentinel); best-effort retry
   }

   // One decorated watchlist row. `strategy_id` is the join key onto the ['watchlists'] read's
   // binding; it is NOT a display payload and carries no provenance/source (the client renders
   // those from the binding). `readiness` is populated iff state == READINESS_STATE_RESOLVED.
   message WatchlistReadinessRow {
     string symbol = 1;
     string strategy_id = 2;
     ReadinessState state = 3;
     SymbolReadiness readiness = 4;
     google.protobuf.Timestamp computed_at = 5;
   }

   // user_id is intentionally absent — taken from the propagated x-user-id header server-side
   // (match the ListOpportunitiesRequest convention), never from the wire. The server derives the
   // (symbol, strategy_id) pairs from the OWNER'S OWN watchlist (anti-IDOR, fails.md:1153).
   message GetWatchlistReadinessRequest {
     string watchlist_id = 1;
     xstockstrat.common.v1.PageRequest page = 2;
   }
   message GetWatchlistReadinessResponse {
     repeated WatchlistReadinessRow rows = 1;
     xstockstrat.common.v1.PageResponse page = 2;
   }
   ```
3. Do NOT use a `oneof` for `readiness` — a plain optional-by-presence field dodges the flattened-oneof e2e trap (fails.md:1281/1317; design.md § Row).

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against ".git#branch=main-dev,subdir=packages/proto"
```
Both pass (additive RPC + additive messages/enum → non-breaking).

---

### Step 2 — proto-gen: regenerate stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/**` — modify (generated)
- `packages/proto/gen/python/**` — modify (generated)
- `packages/proto/gen/ts/**` — modify (generated)

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking change, `buf lint`/`buf breaking`; `xstockstrat-analysis` — readiness contract shape (inherited from Step 1)

**Codebase Evidence**:
- Codegen entry point: `./scripts/buf-gen.sh` (root `CLAUDE.md` § Generating Proto Stubs — "generates TypeScript, Python, and Go stubs and compiles the TS package"). The `proto-freshness` CI job enforces an empty `gen/` diff after re-run.
- The analysis Python stubs are consumed as `analysis_pb2` in `services/xstockstrat-analysis/app/handlers/servicer.py` (e.g. `analysis_pb2.READINESS_RULE_EXIT`, `servicer.py:2761`); the TS `AnalysisService` is imported in the browser client at `services/xstockstrat-ui/src/lib/browserClients/analysisClient.ts:3` (`@xstockstrat/proto/analysis/v1/analysis_pb`).

**TDD**: `N/A (proto-gen)`

**Covers**: `—`

**Instructions**:
1. From repo root run `./scripts/buf-gen.sh` (uses the Docker codegen container; the host fallback is `docs/runbooks/codegen-toolchain-host-setup.md`).
2. Stage the regenerated `packages/proto/gen/{go,python,ts}` output (including compiled TS in `gen/ts/dist/`). Do not hand-edit generated files.

**Verification**:
```bash
./scripts/buf-gen.sh && git diff --exit-code packages/proto/gen/   # must be EMPTY after a second run
```
Confirms the checked-in stubs match the `.proto` (the `proto-freshness` gate).

---

### Step 3 — service: stamp `bar_epoch = -1` on a primary-bars-fetch failure (R-E sentinel)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/services/readiness.py` — modify

**Reviewers**: `xstockstrat-analysis` — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `compute_readiness_row(...)` at `readiness.py:38-93` — the SLOW compute **shared** by the interactive `EvaluateReadiness` handler (`servicer.py:2811`) and the feature-180 materializer (`servicer.py:3905-3912`).
- The failure path today: `except Exception as e: ... bars = []; fetch_ok = False` at `readiness.py:65-68`; then `bar_epoch = max(bars[-1].time.seconds if bars else 0, benchmark_epoch)` at `readiness.py:82` — a persistent primary-bars failure with a benchmark present writes `bar_epoch = benchmark_epoch >= 0`, which never reaches `latest_bar_epoch` → `is_readiness_row_fresh` False forever → infinite `PENDING` (design R-E, context.md Round 4).
- `is_readiness_row_fresh(row, *, now, fingerprint, latest_bar_epoch)` at `readiness.py:16-28`: `fingerprint match AND now < valid_until AND row["bar_epoch"] >= latest_bar_epoch` (`:27`).
- Schema safety: `readiness_cache.bar_epoch BIGINT NOT NULL` with **no** non-negative constraint (`migrations/022_readiness_cache.up.sql:14`) → `-1` is a legal value; **no migration needed** (F-06 holds).
- A successful-but-empty fetch is a **distinct** path (`fetch_ok and not bars`, `readiness.py:69-76`) and must stay `bar_epoch >= 0` (probe window 10d ⊂ fetch window 400d ⇒ empty fetch → `lbe=0` → RESOLVED best-effort; design.md Round-5 (d)). Only the **exception** path gets `-1`.

**TDD**: `red-green required`

**Covers**: `—`

**Instructions**:
1. In `compute_readiness_row`, on the **exception** path only (`readiness.py:65-68`), record the failure so the `bar_epoch` computation at `:82` yields `-1` instead of `max(0, benchmark_epoch)`. Concretely: when `fetch_ok is False`, set the returned `bar_epoch = -1` (a data-unavailable sentinel), overriding the `max(...)` fold. Leave the successful-empty path (`fetch_ok and not bars`) untouched — it keeps `bar_epoch = max(0, benchmark_epoch)`.
2. Add a 1–2 line constraint comment stating the invariant: `bar_epoch = -1` means "primary bars fetch raised" and is the sole `UNKNOWN` discriminant read by the feature-181 classifier; it must never be produced by a successful (even empty) fetch.
3. Do not change the readiness JSON, the fingerprint, `valid_until`, or the successful-path `bar_epoch` — the interactive FAST gate builds its response from `readiness_json`, not `bar_epoch` (design.md Round-5 (b)), so `EvaluateReadiness`'s happy path is unchanged.

**Verification**: covered by Step 4 (paired). Run its command.

---

### Step 4 — test: R-E sentinel write + feature-177 @AC-1/@AC-2 unchanged

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_readiness.py` — modify

**Reviewers**: `xstockstrat-analysis` — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `tests/test_readiness.py` already unit-tests `is_readiness_row_fresh` (`:35-59`), the SLOW-row shape via `compute_readiness_row` (`test_slow_compute_row_shape_is_byte_identical`, `:80-112`, asserts `row["bar_epoch"] > 0`), and the interactive bar_epoch FAST gate (`test_new_daily_bar_busts_fast_gate_but_same_day_serves_fast`, `:119-148`, tagged AC-7/AC-1/AC-5).
- Existing tests import from the compute module directly (`from ...readiness import is_readiness_row_fresh`, `:16`).

**TDD**: `red-green required`

**Covers**: `—` (R-A/R-E regression tests; not an `@AC-*` — the durable C-16 scenario is added in Step 6)

**Instructions**:
1. Add a test asserting the **exception** path stamps `bar_epoch == -1`: drive `compute_readiness_row` with a `fetch_bars` that raises, a **benchmark present** (non-zero `benchmark_epoch`), and assert the returned row's `bar_epoch == -1` (RED before Step 3 — today it is `benchmark_epoch > 0`).
2. Add a test asserting the **successful-empty** path is unchanged: `fetch_bars` returns `[]` (no raise), `benchmark_epoch = E > 0` → `bar_epoch == E` (guards against over-broad `-1`).
3. Re-verify feature-177 **@AC-1** (happy-path FAST skip for a *successful* symbol): a fresh, fingerprint-matching, unexpired, `bar_epoch >= latest_bar_epoch` row stays fresh (extend/assert on `test_is_readiness_row_fresh_all_conditions_met`, `:35-40`) — the shared-compute edit must not change the success FAST skip.
4. Re-verify feature-177 **@AC-2** (a new daily bar busts): `test_is_readiness_row_fresh_stale_on_new_daily_bar` (`:55-59`) still holds. Do not weaken it.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check . && pytest --cov=app --cov-fail-under=40
```
All pass; the two new tests are RED against the pre-Step-3 tree.

---

### Step 5 — service: `GetWatchlistReadiness` handler + cache-first classifier + guard-set kick

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Add the handler beside `EvaluateReadiness` (`servicer.py:2727-2860+`) — that handler is the template for: header extraction `propagation_meta` (`:2737-2741`), `caller_user_id = self._caller_user_id(context)` (`:2746`, def `:492`), owner-scoped `self._strategies_repo.get_by_owner_and_id(caller_user_id, strategy_id)` (`:2748`, def `strategies.py:66`), `_row_to_strategy_definition(row)` (`:2758`, def `:4743`), `_definition_fingerprint(row["definition_json"])` (`:2776`, def `:4706`), the `GetDataCoverage` probe loop (`:2835-2850`, `_READINESS_COVERAGE_PROBE_DAYS=10` at `:258`), `self._readiness_cache_repo.read_many(user, strategy_id, rule, symbols)` (`:2777-2783`, def `readiness_cache.py:25`), `is_readiness_row_fresh` (`:2798`), `_symbol_readiness_from_json(json, symbol)` (`:2805`, def `:4231`), and `compute_readiness_row` (`:2811`).
- Watchlist read over the **existing** analysis→portfolio stub: `self._portfolio` (`servicer.py:389-390`, `PortfolioServiceStub`), already used for `ListWatchlists` (`:3751`) and `ListPositions` (`:4082`). Add a `self._portfolio.GetWatchlist(portfolio_pb2.GetWatchlistRequest(watchlist_id=...), metadata=propagation_meta)` call — RPC `portfolio.proto:22`, `GetWatchlistRequest{watchlist_id=1}`/`GetWatchlistResponse{watchlist=1}` (`portfolio.proto:264-269`); read `resp.watchlist.bindings` (`Watchlist.bindings=8`, `portfolio.proto:239`), each `WatchlistBinding{symbol=1, strategy_id=2, source=3}` (`portfolio.proto:220-226`). **No new edge, no portfolio change (FR-4/AC-5).**
- Guard-set dedupe template: `_kick_opportunity_recompute` (`servicer.py:3291-3308`) — set-add on entry, un-awaited `asyncio.get_event_loop().create_task`, `except Exception → log.warning`, `finally: discard`.
- Bars semaphore for the kick: `self._readiness_materializer_bars_sem` (`servicer.py:443`), **not** the interactive `self._bars_fetch_sem` (`:404`) — feature-176 priority-inversion guard (design R-F).
- Kick `valid_until` = `readiness_valid_until(now, valid_window_hours=...)` (`readiness.py:31`), the materializer's 24h backstop (`servicer.py:3923` reads `analysis.readiness_materializer.valid_window_hours`), **not** the 30s interactive `stale_after` (`servicer.py:2825`).
- `upsert_many` is idempotent `ON CONFLICT ... DO UPDATE` (`readiness_cache.py:44-61`).
- Keyset precedent (single-column) `ListPositions`: `WHERE ($N='' OR symbol > $N) ORDER BY symbol ASC LIMIT` (`services/xstockstrat-portfolio/internal/repository/portfolio_repo.go:155-166`). `ListOpportunities` is **offset** (`servicer.py:3148-3155`) — the counter-example; do NOT copy its slice.

**TDD**: `red-green required`

**Covers**: `—`

**Instructions**:
1. **New module constant** beside `_READINESS_LOOKBACK_DAYS` / `_READINESS_COVERAGE_PROBE_DAYS` (`servicer.py:254-258`): `_READINESS_UNKNOWN_RETRY_SECONDS = 300` — the `UNKNOWN` recovery re-kick cooldown (stateless, not a config key; design.md step 5, context.md Round 4 constants).
2. **New guard-set** in `AnalysisServicer.__init__` (beside where `self._opportunity_recomputing` is initialized at `servicer.py:463`, just below the sem defs `:404`/`:443`): `self._readiness_kicking: set[tuple[str, str, str]] = set()` keyed `(owner, strategy_id, symbol)`.
3. **Handler body** `async def GetWatchlistReadiness(self, request, context):`
   a. Extract `propagation_meta` and `caller_user_id` (mirror `:2737-2746`); if `self._portfolio is None` or `self._strategies_repo is None`, `context.abort(UNAVAILABLE, ...)`.
   b. `GetWatchlist(request.watchlist_id)` over `self._portfolio`; ownership is enforced by portfolio server-side from the forwarded `x-user-id` (do not send a body user_id). Collect **bound** pairs only (`b.strategy_id != ""`).
   c. **Total order + keyset slice**: sort the bound pairs by `(symbol ASC, strategy_id ASC)`; decode `request.page.page_token` (opaque base64 of the last-seen `(symbol, strategy_id)`; empty = first page); keep pairs with `(symbol, strategy_id) > cursor`; take `min(page_size, remaining)` (default page_size when `page.page_size <= 0` — use the same default posture as other reads; 25 is the UI default). Set `next_page_token` (base64 of the page's last pair) when more remain, else `""`.
   d. **Per distinct strategy on the page**: load the owner-scoped definition via `get_by_owner_and_id` and compute its `fingerprint` (`_definition_fingerprint`); read the cache via `read_many(caller_user_id, strategy_id, "entry", page_symbols_for_strategy)` (rule is always `"entry"` for watchlist readiness — matches `EvaluateReadiness`'s watchlist default, `servicer.py:2761` + analysis `CLAUDE.md`). **Cache read only — never SLOW compute in the RPC body.**
   e. **Probe** `latest_bar_epoch` per distinct page symbol via the same `GetDataCoverage` MIN/MAX loop as `:2835-2850` (`_READINESS_COVERAGE_PROBE_DAYS`), best-effort (miss → 0).
   f. **Classify each page pair** (order matters — sentinel first):
      ```
      row = cached.get(symbol); lbe = latest_bar_epoch.get(symbol, 0)
      if row and row["bar_epoch"] < 0:                         -> READINESS_STATE_UNKNOWN
      elif row and is_readiness_row_fresh(row, now=now, fingerprint=fp, latest_bar_epoch=lbe):
                                                               -> READINESS_STATE_RESOLVED  # inline SymbolReadiness via _symbol_readiness_from_json
      else:                                                    -> READINESS_STATE_PENDING
      ```
      `computed_at` on each row = the cached row's `computed_at` when present, else `now`.
   g. **Best-effort background refresh** for not-fresh pairs, grouped by strategy, via `compute_readiness_row` (materializer sem `self._readiness_materializer_bars_sem`) + `upsert_many`, stamping `valid_until = readiness_valid_until(now, valid_window_hours=<materializer window>)`. Dedupe through `self._readiness_kicking` (add the `(owner, strategy_id, symbol)` triples on entry, `finally: discard`, swallow exceptions), fired via un-awaited `create_task` (mirror `_kick_opportunity_recompute`). **PENDING** pairs are kicked every call; **UNKNOWN** pairs are kicked only when `now - row["computed_at"] > timedelta(seconds=_READINESS_UNKNOWN_RETRY_SECONDS)`. The refresh never touches the response (FR-5).
   h. Build `GetWatchlistReadinessResponse(rows=[...], page=PageResponse(next_page_token=...))` and return. A per-pair classification/kick failure degrades that one pair (leave it `PENDING`/`UNKNOWN`), never fails the RPC (FR-5).
4. **Header propagation (C-03):** the new `GetWatchlist` and `GetDataCoverage` calls forward `x-user-id`/`x-access-scope`/`x-trace-id` via `metadata=propagation_meta` — the analysis per-method convention (`docs/patterns/header-propagation.md`; identical to `EvaluateReadiness`'s outbound calls, `servicer.py:2839-2846`). Reuse the same `propagation_meta` list built in (a).
5. Register the method on the gRPC server if the servicer uses an explicit `add_*Servicer_to_server` method list rather than reflection — confirm against how `EvaluateReadiness` is exposed (the generated `add_AnalysisServiceServicer_to_server` binds by method name, so no manual registration is normally needed; verify no explicit allow-list exists).

**Verification**: covered by Step 6 (paired). Run its command.

---

### Step 6 — test: classifier states, keyset paging, cooldown, no-cycle, durable C-16 scenario

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_readiness.py` — modify (or a new `tests/test_watchlist_readiness.py`)
- `services/xstockstrat-analysis/acceptance/readiness-caching-poll-discipline.feature` — modify (durable C-16 scenario, design R-A)

**Reviewers**: `xstockstrat-analysis` — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Test module + fixtures precedent: `tests/test_readiness.py` (`is_readiness_row_fresh` unit tests `:35-59`; `compute_readiness_row` shape `:80-112`; interactive FAST-gate handler test `:119-148`). Sibling handler-level tests exist (`test_readiness_cache.py`, `test_readiness_materializer.py`).
- Durable C-16 suite: `services/xstockstrat-analysis/acceptance/readiness-caching-poll-discipline.feature` exists (the feature-177 readiness suite; also present in `services/xstockstrat-ui/acceptance/`).
- No-cycle structural fact: `xstockstrat-portfolio` declares **no** `AnalysisService` client/stub (recon.md:40 — `authz.go:20` `analysis-fundsignal` is an inbound allow-list entry only, not an outbound client).
- C-13 (non-frontend test data): the readiness `row` dict + a fake watchlist binding list are the domain literals; they have a **single consumer** (this test module) → inline is compliant. Reuse the existing `_row(...)` helper style (`test_readiness.py:27-33`).

**TDD**: `red-green required`

**Covers**: `AC-3, AC-4, AC-5`

**Instructions**:
1. **Four-way classifier** (design R-E), driving the handler (or an extracted classifier helper) with staged cache rows + probe values:
   - fresh, fingerprint-match, `bar_epoch >= lbe` → `READINESS_STATE_RESOLVED` with inline `SymbolReadiness` (asserts **AC-3** FAST serve: no `compute_readiness_row`/bars fetch on the resolved pair).
   - `bar_epoch == -1` sentinel → `READINESS_STATE_UNKNOWN` **regardless of `lbe`** (sentinel checked first).
   - not-fresh non-sentinel (stale/missing/bar-busted) → `READINESS_STATE_PENDING` + a kick fired.
   - probe miss (`lbe = 0`) on a non-sentinel fresh row → `RESOLVED` best-effort.
   - **Load-bearing assertion:** a bar-busted (`lbe > row.bar_epoch`) non-sentinel row is `PENDING`, never a stale `RESOLVED` (keeps feature-177 @AC-2; design R-A).
2. **UNKNOWN cooldown:** a sentinel row with `now - computed_at <= 300s` is **not** re-kicked; `> 300s` **is** re-kicked (assert against `self._readiness_kicking` / a spy on the kick).
3. **Keyset paging (AC-4):** with N bound pairs and page_size < N, assert only the first page's pairs are returned, `next_page_token` is set, resuming with it returns the next page with no skip/dup, and readiness is classified for **only** the visible page's pairs (not all N — assert the cache read / probe / kick set is bounded to the page). Cover the composite `(symbol, strategy_id)` order when one symbol binds two strategies.
4. **No-cycle (AC-5):** assert the handler reaches the watchlist via `self._portfolio.GetWatchlist` (the existing analysis→portfolio edge) and issues **no** call back through analysis; plus a structural guard that portfolio declares no analysis stub:
   ```bash
   ! grep -rniE "analysis(_pb2)?_grpc|AnalysisServiceStub|AnalysisServiceClient" services/xstockstrat-portfolio/
   ```
5. **Durable C-16 scenario (R-A):** append a scenario to `acceptance/readiness-caching-poll-discipline.feature` (tag it `@feature-181` alongside the existing `@feature-177`/`@feature-180` tags) asserting: *a bar-busted readiness row is never served as a stale RESOLVED — it re-decorates as PENDING and re-warms* (the four-way classifier guarantee); and flag the feature-180 FAST/`bar_epoch` guarantee for promotion in the same edit (recon.md R3 / design R-A). This is the durable behavioral guard; the pytest cases above are its executable form.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check . && pytest --cov=app --cov-fail-under=40
! grep -rniE "analysis(_pb2)?_grpc|AnalysisServiceStub|AnalysisServiceClient" services/xstockstrat-portfolio/
```
All pass; classifier/paging/cooldown tests RED against the pre-Step-5 tree.

---

### Step 7 — service: `useWatchlistReadiness` hook (own query key, page-token stack, poll-alive)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/hooks/useWatchlistReadiness.ts` — create

**Reviewers**: `xstockstrat-ui` — analytics display accuracy, Connect-RPC call safety

**Codebase Evidence**:
- **Never** the `['watchlists']` key: `useWatchlists.ts:7` `const WATCHLISTS_KEY = ['watchlists']`, with the feature-167 single/bulk cache-patch guarantee (`setQueryData` + explicit "NO invalidateQueries" at `useWatchlists.ts:140-155,180-192`) that @AC-6 protects. The new hook uses a **disjoint** key `['watchlistReadiness', watchlistId, pageToken]` (design.md § Client behavior; recon R1).
- Typed browser client: `analysisClient` (`src/lib/browserClients/analysisClient.ts:6`) — after Step 2 it exposes `analysisClient.getWatchlistReadiness(...)`. Result type pattern: `type X = Awaited<ReturnType<typeof analysisClient.getWatchlistReadiness>>` (mirror `WatchlistReadiness.tsx:23`, `useWatchlists.ts:5`).
- Poll cadence: feature-177's `staleTime: 30_000` on the exact block being replaced (`WatchlistReadiness.tsx:196-200`). Use a 30s interval constant (design "poll interval 30_000ms (UI const, matches 177)", context.md Round 4).
- Page-token stack precedent: `usePortfolio.ts:33` (`pageToken?`/`pageSize?` in filters, `page: { pageSize, pageToken }` at `:46-56`) + `trader/positions/page.tsx:47-48` (`const [pageToken,setPageToken]=useState('')`, `const [pageStack,setPageStack]=useState<string[]>([])`) + `:50-54` `resetPaging()`.

**TDD**: `red-green required` (logic hook; covered by Step 11 e2e — see Step 11; a vitest unit test of the poll-alive predicate may be added if the predicate is extracted to `src/lib/`)

**Covers**: `—`

**Instructions**:
1. Create `useWatchlistReadiness(watchlistId: string, pageToken: string)` returning the decorated rows for the page, keyed `['watchlistReadiness', watchlistId, pageToken]`, calling `analysisClient.getWatchlistReadiness({ watchlistId, page: { pageSize: 25, pageToken } })`. `25` is the page-size UI constant (context.md Round 4).
2. Expose a helper to build a `(symbol, strategyId) -> { state, readiness, computedAt }` map for the component to join onto the rendered binding rows.
3. **Poll-alive:** accept a `hasPendingOrUnknown: boolean` computed by the caller from the **rendered** rows (binding⋈readiness), and set `refetchInterval: hasPendingOrUnknown ? 30_000 : false`. The predicate must be computed from the rendered rows, not the response alone, so a symbol just added via `useAddWatchlistSymbols` (which invalidates `['watchlists']` and renders a new binding row with no readiness entry) keeps the poll alive instead of hanging on `Skeleton` (design.md § Client behavior, Round-3 Obj 6).
4. Do **not** add any `invalidateQueries(['watchlists'])` or `invalidateQueries(['watchlistReadiness'])` to the existing mutations — the disjoint key + poll is the refresh mechanism (design R-C; @AC-6 preservation).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
```
Lint passes; behavioral coverage via Step 11.

---

### Step 8 — service: rewrite `WatchlistReadiness.tsx` — per-row state, C-17 primitives, pagination

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/WatchlistReadiness.tsx` — modify
- `services/xstockstrat-ui/src/components/insights/WatchlistDetail.tsx` — modify (pass pagination state / wire the hook)

**Reviewers**: `xstockstrat-ui` — analytics display accuracy, Connect-RPC call safety

**Codebase Evidence**:
- The N+1 fan-out to remove: `WatchlistReadiness.tsx:193-203` `useQueries({ queries: groups.map(([strategyId, symbols]) => ({ queryKey:['readiness',strategyId,...], queryFn:()=>analysisClient.evaluateReadiness({strategyId,symbols}), staleTime:30_000 }))})`; rows only render once resolved. Import to drop: `useQueries` (`:3`), and the direct `analysisClient.evaluateReadiness` use (`:196`).
- Verdict cell keying: today keyed by `symbol` alone (`WatchlistReadiness.tsx:270` region); re-key by `(symbol, strategyId)` — strictly more correct when a symbol binds multiple strategies (design.md § Row).
- Preserved affordances that come from the retained `['watchlists']` read (design R-D, all verified):
  - provenance badge ← `binding.source` → `<SignalSourceBadge source={binding.source} />` (`WatchlistReadiness.tsx:276`, type `Binding.source?` at `:25`).
  - in-queue marker ← `useOpportunities()` (`WatchlistDetail.tsx:72`, consumed in `WatchlistReadiness.tsx:265,293` region).
  - system-managed delete ← `watchlist.systemManaged` (`WatchlistDetail.tsx:221`).
  - firing/watching cues + blocking + firing-row jump ← the verdict via `readinessState`/`isFiring`/`blockingCondition` (`WatchlistReadiness.tsx:42-75,266-296`; `readinessState` from `src/lib/readinessRollup.ts:20`, states `'firing'|'watching'|'quiet'|'nodata'` at `:13`).
  - jump href ← `binding.strategyId` (`WatchlistReadiness.tsx:301`).
- C-17 primitives (all exist): `Skeleton` (`src/components/ui/skeleton.tsx`), `QueryStateMessages` (`src/components/shared/QueryStateMessages.tsx`), `EmptyState` (`src/components/shared/EmptyState.tsx`) — C-17 / `docs/patterns/ui-ux-governance.md`.

**TDD**: `red-green required` (covered by Step 11 e2e)

**Covers**: `—`

**Instructions**:
1. Remove the `useQueries` per-strategy fan-out (`:193-203`) and the `useQueries` import (`:3`). Do **not** reintroduce a client `evaluateReadiness` call — pending rows resolve through the one page-bounded RPC (design Operator Decision 2).
2. Consume `useWatchlistReadiness(watchlistId, pageToken)` (Step 7). Render the binding rows **immediately** from the existing `['watchlists']`-sourced `bindings` prop (FR-1), joined to the readiness map by the composite `(symbol, strategyId)` cell key.
3. Per-row state → C-17 primitive (FR-7, @AC-6):
   - `READINESS_STATE_PENDING` → `Skeleton` in the verdict cell, with `aria-busy="true"` (or wrap in `role="status"`) so the loading state is announced to AT.
   - `READINESS_STATE_RESOLVED` → the existing verdict rendering via `readinessState`/`isFiring`/`blockingCondition` (unchanged cue set — @feature-155 icon+text, extended to cover the new states; @feature-155 @AC-4 icon+text rule).
   - `READINESS_STATE_UNKNOWN` → an icon+text error state via `QueryStateMessages` (not an ad-hoc spinner), non-blocking (the rest of the list renders).
   - The list is **never blank-while-pending** (FR-1) — rows show symbol/strategy/affordances even when every verdict is `PENDING`.
4. **Pagination control** (FR-3, @AC-6): render prev/next controls driven by a `pageToken`/`pageStack` state lifted from `usePortfolio.ts`/`trader/positions/page.tsx:47-54`; the control is a native `<button>` (keyboard-operable) with an accessible label (e.g. `aria-label="Next page of watchlist rows"`). Compute `hasPendingOrUnknown` from the rendered rows and pass it to the hook (Step 7 poll-alive).
5. Preserve every affordance in Codebase Evidence — they are rendered from the retained `['watchlists']` read/`useOpportunities`, not from the readiness Row (which carries no `source`/queue/managed fields). Do not force a `['watchlists']` refetch.
6. **C-17 tokens/DRY:** use design-role tokens and existing `ui/*` primitives — no hardcoded colors, no near-duplicate primitive (C-17; `docs/patterns/ui-ux-governance.md`).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
```
Lint passes; behavioral/a11y coverage via Step 11.

---

### Step 9 — service: BFF `getWatchlistReadiness` forward in `insightsBff`

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/insightsBff.ts` — modify

**Reviewers**: `xstockstrat-ui` — analytics display accuracy, Connect-RPC call safety

**Codebase Evidence**:
- `insightsBff.ts:30` `router.service(AnalysisService, { ... })`; readiness sibling `evaluateReadiness: forward((req, opts) => analysisClient.evaluateReadiness(req, opts))` at `:55`. `forward` = `requireSession → backendHeaders(x-user-id/scope/trace) → call` (`bffShared.ts:60-69`).
- Dispatch: `src/app/insights/api/[...connect]/route.ts:1` imports `dispatchConnect` from `insightsBff`; `createDispatch` builds the handler map from `router.handlers` (`bffShared.ts:107-113`) — a new RPC on `AnalysisService` auto-registers by request path, no route change needed.
- **Error passthrough (fails.md:552):** `createDispatch` normalizes a downstream `ConnectError`'s content-type to `application/json` for `status >= 400` (`bffShared.ts:130-136`) — a `forward` handler inherits this; do NOT add a `dispatch*` path that collapses errors to HTTP 400.
- **Single BFF site (fails.md:1138):** only `insightsBff` serves watchlists — `traderBff.ts`/`configUiBff.ts` list none (`grep -n "getWatchlistReadiness\|listWatchlists" src/lib/traderBff.ts src/lib/configUiBff.ts` → no watchlist RPCs in trader/config). No second call site to update.

**TDD**: `N/A (thin BFF forward; exercised by Step 11 e2e through the real dispatch)`

**Covers**: `—`

**Instructions**:
1. In the `router.service(AnalysisService, {...})` block, beside `evaluateReadiness` (`:55`), add:
   ```ts
   // Cache-first watchlist readiness decoration (feature 181). Owner from x-user-id; body carries no user_id.
   getWatchlistReadiness: forward((req, opts) => analysisClient.getWatchlistReadiness(req, opts)),
   ```
2. Add no route or handler-map wiring — `createDispatch` picks it up from `router.handlers`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
grep -n "getWatchlistReadiness" src/lib/insightsBff.ts
grep -Ln "getWatchlistReadiness" src/lib/traderBff.ts src/lib/configUiBff.ts   # confirm NOT added there (single site)
```
Lint passes; the forward is present in insightsBff only.

---

### Step 10 — service: e2e mock for `GetWatchlistReadiness` in both mock homes

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify
- `services/xstockstrat-ui/e2e/helpers/watchlistMock.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify (catalog the new mock)

**Reviewers**: `xstockstrat-ui` — analytics display accuracy, Connect-RPC call safety

**Codebase Evidence**:
- In-process mock home: `e2e/mock-backend.ts` has `async listWatchlists()` at `:351` and `async evaluateReadiness(req)` at `:821` (the AnalysisService mock object) — add `getWatchlistReadiness` beside `evaluateReadiness`.
- Per-test route home: `e2e/helpers/watchlistMock.ts:75` `page.route('**/xstockstrat.portfolio.v1.PortfolioService/ListWatchlists', ...)`; `mockWatchlists(page, seed)` at `:33`, types `MockBinding{symbol,strategyId,source?}` (`:17`), `MockWatchlist` (`:18`) — add an analysis `GetWatchlistReadiness` route here (path `**/xstockstrat.analysis.v1.AnalysisService/GetWatchlistReadiness`).
- Reusable fixtures: `symbolReadiness` single-arg factory + `READINESS_BUCKET_OVERRIDE` (`e2e/fixtures/opportunities.ts`, catalog `INVENTORY.md:30`, `:55`); `mockWatchlists`/`MockWatchlist`/`MockBinding` (`INVENTORY.md:31`). Auth helpers `addAuthCookie`/`addAdminCookie` (`e2e/helpers/auth.ts`).
- **Flattened proto3-JSON camelCase shape (fails.md:1281/1317, :102 broker-state):** the mock response must be `{ rows: [{ symbol, strategyId, state, readiness?: {...}, computedAt }], page: { nextPageToken } }` (camelCase; `state` a plain enum-string/number; `readiness` a nested object present only for RESOLVED — **not** a `create()`-wrapped or oneof shape).

**TDD**: `N/A (test fixture/mock; validated by Step 11 running against it)`

**Covers**: `—`

**Instructions**:
1. Add `getWatchlistReadiness` to the AnalysisService mock in `e2e/mock-backend.ts` (beside `evaluateReadiness`, `:821`): derive rows from the same seeded bindings the `listWatchlists` mock returns, honor `page.pageSize`/`page.pageToken` (keyset over sorted `(symbol,strategyId)`), reuse `symbolReadiness`/`READINESS_BUCKET_OVERRIDE` for RESOLVED payloads, and support forcing a `PENDING`/`UNKNOWN` state per symbol (a bucket-override entry) so Step 11 can drive AC-1/AC-2. Reset any module-level mock state per request/`beforeEach` (fails.md exactly-once-order-intent Step 17 — module-level `Map` leaks across cases).
2. Add the matching `page.route(...)` in `e2e/helpers/watchlistMock.ts` for tests that use the per-test route path, returning the same flattened shape and honoring the seed passed to `mockWatchlists`.
3. Add an `INVENTORY.md` row cataloguing the new `GetWatchlistReadiness` mock (module + which specs consume it), mirroring the Symbol-readiness / Watchlists rows (`INVENTORY.md:30-31`).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
grep -n "getWatchlistReadiness\|GetWatchlistReadiness" e2e/mock-backend.ts e2e/helpers/watchlistMock.ts
```
Both homes carry the mock; consumed in Step 11.

---

### Step 11 — test: Playwright e2e for the watchlist readiness list (AC-1..AC-6)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/watchlists.spec.ts` — modify (or a new `watchlist-readiness-list.spec.ts` under `e2e/insights/`)

**Reviewers**: `xstockstrat-ui` — analytics display accuracy, Connect-RPC call safety

**Codebase Evidence**:
- Existing watchlist e2e: `e2e/insights/watchlists.spec.ts` (readiness rollup, in-queue mark — INVENTORY.md:30-31,55). Auth via `e2e/helpers/auth.ts` (`addAuthCookie`); watchlist seeding via `mockWatchlists` (`e2e/helpers/watchlistMock.ts:33`).
- No coverage threshold for `xstockstrat-ui` (spec-template coverage table: `xstockstrat-trader/insights/config-ui` → n/a, use `pnpm test:e2e`); this feature's segment is `/insights`.
- C-12 fixtures: reuse `symbolReadiness`/`READINESS_BUCKET_OVERRIDE` (`e2e/fixtures/opportunities.ts`), `mockWatchlists`/`MockBinding` (`e2e/helpers/watchlistMock.ts`), auth from `e2e/helpers/auth.ts` — no inline domain literals.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-6`

**Instructions**:
1. **@AC-1:** seed a watchlist with 5 bound rows whose readiness is forced `PENDING`; open `/insights/watchlists`, select it; assert all 5 rows render immediately with symbol+strategy, each verdict cell shows the C-17 `Skeleton` loading indicator, and the list is not blank while pending.
2. **@AC-2:** force readiness for `AMD` to `UNKNOWN` (error) while the others resolve; assert the `AMD` row shows the icon+text unknown/error state, every other row shows its resolved verdict, and the list container itself rendered (never blanked/errored as a whole).
3. **@AC-3:** seed the visible page's pairs as warm/RESOLVED; assert the response decorates each visible row's verdict inline, and assert **no** client-side per-strategy `EvaluateReadiness` fan-out is issued (e.g. fail the test if the mock's `evaluateReadiness` handler is hit for the visible rows — the N+1 is killed, not relocated).
4. **@AC-4:** seed 120 bound rows, page size 25; assert only the first 25 render, readiness is requested/decorated for at most those 25 (assert the `getWatchlistReadiness` request/response is page-bounded), and the pagination control advances to the next 25 on demand.
5. **@AC-6:** assert the loading state is the shared C-17 skeleton/query-state primitive (not an ad-hoc spinner) and is announced to AT (`aria-busy` or `role="status"`), and the pagination control is keyboard-operable (Tab/Enter) with an accessible name (`aria-label`/accessible label present).
6. Import all mock/domain data from the fixtures + helpers above (C-12) — no inline domain literals; scenario one-off overrides (forced PENDING/UNKNOWN buckets) are the exempt scenario-specific spreads.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm test:e2e -- e2e/insights/watchlists.spec.ts
```
(or the new `watchlist-readiness-list.spec.ts`). All scenarios pass; each is RED against the pre-Steps-7/8 tree.

---

### Step 12 — docs: analysis `CLAUDE.md` — new RPC, semaphore coupling, materializer prerequisite

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- The Decide-surface RPCs section documents `EvaluateReadiness` FAST/SLOW behavior (analysis `CLAUDE.md` § "Decide-surface RPCs (feature 083...)"), and the `analysis.readiness_materializer.*` config keys (§ "Config Keys Consumed") including `max_concurrent_bars_fetches` (feature 180's own sem) and `valid_window_hours`.
- R-F coupling fact: Step 5 reuses `self._readiness_materializer_bars_sem` (`servicer.py:443`, backed by `analysis.readiness_materializer.max_concurrent_bars_fetches`) for on-read watchlist kicks (design R-F).
- R-B fact: FR-6 (warm FAST first render) is contingent on `analysis.readiness_materializer.enabled` (default OFF, `CLAUDE.md` § Config Keys) — do NOT flip the default (design R-B).

**TDD**: `N/A (docs)`

**Covers**: `—`

**Instructions**:
1. Add a short subsection documenting `GetWatchlistReadiness` (feature 181): cache-first (cache read + `GetDataCoverage` probe only, never SLOW compute in the RPC), keyset-paginated over the owner's watchlist bindings via the existing analysis→portfolio `GetWatchlist` edge (no new edge/cycle), the four-way classifier (`RESOLVED`/`PENDING`/`UNKNOWN` + the `bar_epoch = -1` data-unavailable sentinel now written by `compute_readiness_row`), and the guard-set-deduped background kick.
2. Document **R-F**: `analysis.readiness_materializer.max_concurrent_bars_fetches` now **also** throttles interactive watchlist-read kicks (the on-read kick shares the materializer bars-sem, not the interactive one) — a one-line operator note in the relevant config-key row / the new subsection.
3. Document **R-B** the operator prerequisite: a warm FAST *first* render (FR-6) requires enabling `analysis.readiness_materializer.enabled` (default OFF) with a `valid_window` covering the read cadence; with it off, a cold page renders `PENDING` and self-warms over one poll via the kick's 24h stamp. State that this feature does **not** change the shipped default.
4. Note the shared-compute scope deviation: `compute_readiness_row`'s `-1` failure sentinel is a (more-correct) behavior change to shipped features 177/180, operator-approved (context.md Round 4).

**Verification**:
```bash
grep -n "GetWatchlistReadiness\|readiness_materializer.max_concurrent_bars_fetches\|-1" services/xstockstrat-analysis/CLAUDE.md
```
The new RPC, the R-F coupling note, and the sentinel note are present.

---

## Deviation Log

### D-1 — Development branch (session-wide)
- **Step(s)**: all. **Disposition**: harness-mandated branch override.
- The skill derives `<dev-branch>` = `feature/watchlist-readiness-list-ux` from feature.md, but this
  session's harness rules mandate developing on `claude/watchlist-stock-list-perf-o3qoqb` (where all
  SDD artifacts live and PR #1103 → main-dev is open). All step commits land on
  `claude/watchlist-stock-list-perf-o3qoqb`; the existing PR #1103 is the integration PR. Operator
  confirmed at the sequential mode-entry gate.

### D-2 — Proto codegen via Docker + host tsc (Steps 1–2)
- **Step(s)**: 1, 2. **Disposition**: CI-equivalent fallback (sequential-mode verification fallback).
- `buf` is absent on the host, so Step 1's `buf lint`/`buf breaking` and Step 2's `buf generate`
  ran inside the version-pinned `Dockerfile.codegen` container via `./scripts/localenv-setup.sh`
  (started `dockerd` first). Both `buf lint` and `buf breaking --against main-dev` PASSED in-container
  (additive RPC + messages/enum → non-breaking). The container's final TS→JS `tsc` compile failed
  (`gen/ts/node_modules` absent in the image); completed on the host via the workspace
  `pnpm install --frozen-lockfile` `prepare` hook (`tsc`). Generated diff is scoped entirely to
  `packages/proto/gen/**/analysis/v1/**` (Go, Python, TS source + `dist`), mirroring CI's stale-stub
  check.
