# Implementation Spec: fundamentals-blend-universe

**Status**: `done`
**Created**: 2026-08-31
**Feature**: `docs/roadmap/features/168-fundamentals-blend-universe/feature.md`
**Total Steps**: 6
**Feature Branch**: `feature/fundamentals-blend-universe`

---

## Execution Summary

Three logical pieces, in dependency order. **Step 1** seeds the two `analysis.engine.*` config keys via
config-service migration `024_analysis_engine_blend_keys` (no non-config migration; no proto change).
**Steps 2–3** add the once-per-cycle fundamentals-universe resolver to `live_loop.py`
(`QuerySignals(source=slug)` ∩ `GetFundamentalsMulti` "has-row", fail-closed to empty) plus its RED-first
unit test. **Steps 4–5** add the single config-gated universe-override branch inside `_run_cycle`
(strictly on `strategy_id == blend_id`, every other strategy byte-for-byte unchanged) plus its RED-first
cycle-level test. **Step 6** registers both keys in the two docs surfaces (config-governance log +
analysis CLAUDE.md). The design's Chosen Approach is followed verbatim; its Rejected Alternatives
(global-strategy promotion, parallel loop, per-strategy fan-out, unconditional resolution, broad-universe
fallback, hardcoded slug, honoring the blend allowlist) are off the table.

**Consumer Surface (C-14):** the product spec marks Consumer Surface **None — internal to the analysis
live-evaluation loop**; output reaches users through the already-shipped feature-048 alerts and feature-131
opportunity attribution, and the operator control is the `analysis.engine.fundamentals_blend_enabled`
kill-switch via `set_config`/config-ui. No UI or Agent step is therefore required — this is a decision, not
an omission.

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` blend runs on the fundamentals-universe intersection (AAPL/MSFT, not ZZZZ) | Step 3 (resolver ∩ has-fundamentals), Step 5 (end-to-end cycle) |
| `@AC-2` blend excluded from symbols outside the universe (not GME/AMC) | Step 5 |
| `@AC-3` blend additive; `sma_cross`'s own universe unchanged (no-regression) | Step 5 |
| `@AC-4` no-op when the configured blend strategy is not live | Step 5 |
| `@AC-5` config retargets the rule to `fund_blend_v2` | Step 5 |
| `@AC-6` resolution failure → empty universe, other strategies still evaluate | Step 3 (fail-closed empty), Step 5 (cycle: zero blend symbols, others normal) |

## Step Dependencies

- Step 3 (resolver test) requires Step 2 (resolver method): the RED run in Step 3 references
  `loop._resolve_fundamentals_universe`, which does not exist pre-Step-2 (AttributeError = RED), then
  passes after Step 2. Per the TDD gate the test is authored/run RED before Step 2's implementation.
- Step 4 (override branch) requires Step 2: the branch calls `_resolve_fundamentals_universe` once per
  cycle when `blend_active`.
- Step 5 (cycle test) requires Step 4: it drives `_run_cycle` end-to-end; RED before Step 4's impl.
- Step 1 (config seed) is independent of the code steps at build time (analysis falls through to the
  in-code `get_str`/`get_bool` defaults until the row exists), but ships in the same PR so the keys are
  registered where operators set them; Step 6 documents them.
- No `## merge-order.md` blocker beyond the pre-assigned config-migration number: `024` per
  `docs/roadmap/features/merge-order.md` (021→`022`, 031→`023`, **168→`024`**, 166→`025`).

---

### Step 1 — config: seed `analysis.engine.fundamentals_blend_*` keys (migration `024_analysis_engine_blend_keys`)

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/024_analysis_engine_blend_keys.up.sql` — create
- `services/xstockstrat-config/migrations/024_analysis_engine_blend_keys.down.sql` — create

**Reviewers**: DBA — migration NNN numbering (no gaps/conflicts), up+down pair present, run-order compliance; xstockstrat-config — config key naming (`<service>.<category>.<key>`), environment (`production`/`staging`) / global-per-user scoping, WatchConfig stream stability

**Codebase Evidence**:
- Last config migration confirmed via `ls services/xstockstrat-config/migrations/ | sort` → tip is
  `021_notify_push_min_severity` — `024` is the pre-assigned next number for feature 168
  (`docs/roadmap/features/merge-order.md:188-193`; `021`→`022` ledger-export, `031`→`023` ui-performance,
  **`168`→`024`**, `166`→`025`). `022`/`023` are not yet on this tree — golang-migrate applies in numeric
  order; `024` merges after them.
- **Authoritative `key`-column convention (post-147 schema):** the WatchConfig snapshot `values` map is
  keyed by the **raw `row.key`** with **no namespace prefix added** —
  `services/xstockstrat-config/src/grpc/configServiceImpl.ts:176` (`values[row.key] = buildConfigValue(row)`,
  and `:152`). The analysis reader looks up the **full dotted** key
  (`self._snapshot.values.get("analysis.engine.…")`, `services/xstockstrat-analysis/app/config/watcher.py:90`),
  so the seeded `key` column **must equal the full dotted string**
  `analysis.engine.fundamentals_blend_strategy_id` / `…_enabled` with `namespace='analysis'`. This mirrors
  the explicit convention documented in `services/xstockstrat-config/migrations/021_notify_push_min_severity.up.sql:5-8`
  ("the `key` column carries the FULL dotted key … no namespace prefix added"). Do **not** copy the older
  split form in `008_analysis_fundsignal_keys.up.sql:13` (`key='fundsignal.enabled'`) — that predates the
  feature-147 schema and its default==seeded values mask the mismatch.
- **Post-147 scope columns:** rows are `(namespace, key, value_type, value_data, description,
  default_value, consuming_service, environment, user_id)` with global scope `user_id NULL`, seeded per
  environment `staging` + `production`, uniqueness
  `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING`
  (`021_notify_push_min_severity.up.sql:18-27`). The `trading_mode` axis was removed by feature 147 — do
  not reintroduce the `'all'` form used by `008`.
- **Reader/value_type round-trip:** `buildConfigValue` sets the oneof from `value_type`
  (`configServiceImpl.ts:565-576`): `case 'bool': { bool_val: row.value_data === 'true' }`, `case 'string':
  { string_val: … }`. So `value_type='bool'`, `value_data='true'` sets `bool_val` (HasField true) — read
  by `watcher.get_bool` (`watcher.py:116-122`, `HasField("bool_val")`, so an explicit operator `false` is
  honored, only an absent key falls to the default `True`); `value_type='string'` sets `string_val` — read
  by `watcher.get_str` (`watcher.py:87-93`, empty `string_val` → default).

**TDD**: `N/A (config seed migration — non-code-bearing; verified offline per the migration rule)`

**Covers**: —

**Instructions**:
1. Create `024_analysis_engine_blend_keys.up.sql`. Header comment: service `xstockstrat-config`; seeds the
   two `analysis.engine.*` blend keys (feature 168) for `staging` + `production`; note the full-dotted-key
   convention (matches `021`) and numeric-order rationale (after `022`/`023`, before `025`). `INSERT INTO
   config.config_values (namespace, key, value_type, value_data, description, default_value,
   consuming_service, environment, user_id) VALUES …` four rows:
   - `('analysis', 'analysis.engine.fundamentals_blend_strategy_id', 'string', 'fundamentals_macd_blend',
     '<desc: strategy id the fundamentals-universe force-run rule governs; empty reverts to the code
     default>', 'fundamentals_macd_blend', 'xstockstrat-analysis', 'staging', NULL)` and the identical row
     with `environment='production'`.
   - `('analysis', 'analysis.engine.fundamentals_blend_enabled', 'bool', 'true', '<desc: kill-switch for
     the fundamentals-universe force-run; independent of whether the strategy is live>', 'true',
     'xstockstrat-analysis', 'staging', NULL)` and the identical row with `environment='production'`.
   - End with `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;`.
2. Create `024_analysis_engine_blend_keys.down.sql` that reverses exactly: `DELETE FROM
   config.config_values WHERE namespace='analysis' AND key IN
   ('analysis.engine.fundamentals_blend_strategy_id','analysis.engine.fundamentals_blend_enabled');`
   (explicit `key IN (...)`, never a `LIKE 'engine.%'`, so only what `.up` seeded is removed).

**Verification** (offline, no DB — per the migration-step rule):
```bash
ls services/xstockstrat-config/migrations/024_analysis_engine_blend_keys.up.sql \
   services/xstockstrat-config/migrations/024_analysis_engine_blend_keys.down.sql
# read both: confirm every INSERT row in .up (4 rows: 2 keys × {staging,production}) has an inverse
# DELETE in .down (key IN (both keys)); confirm key column is the FULL dotted string, namespace='analysis',
# user_id NULL, environments staging+production, and ON CONFLICT (…, COALESCE(user_id,'')).
grep -n "analysis.engine.fundamentals_blend" services/xstockstrat-config/migrations/024_analysis_engine_blend_keys.up.sql   # 4 hits
```

---

### Step 2 — service: once-per-cycle fundamentals-universe resolver in `live_loop.py`

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/live_loop.py` — modify

**Reviewers**: xstockstrat-analysis — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `_drain_signals` `services/xstockstrat-analysis/app/engine/live_loop.py:358-385` is the reuse shape for
  a paginated `QuerySignals` + best-effort fail: it builds `now = Timestamp(); now.GetCurrentTime()`,
  `window = common_pb2.TimeRange(start=now, end=now)` (`:363-365`), loops `_DRAIN_PAGES` (`:368`) issuing
  `self._ingest.QuerySignals(ingest_pb2.QuerySignalsRequest(active_window=window, page=common_pb2.PageRequest(page_size=_DRAIN_PAGE_SIZE, page_token=page_token)))`
  (`:370-377`), and `except Exception → return out` (`:378-380`). It **does not pass `source`**, so it can
  not be reused as-is — the resolver needs its own source-filtered call.
- `QuerySignalsRequest` has `string source = 1` (`packages/proto/ingest/v1/ingest.proto:128-129`) — the
  `== fundamentals` filter; `active_window = 4` — the "active only" filter.
- "has fundamentals" shape: `fundsignal_loop._paced_fetch:359-385` calls
  `self._marketdata.GetFundamentalsMulti(marketdata_pb2.GetFundamentalsMultiRequest(symbols=chunk))` in
  `chunk_size=50` budget-bounded chunks and keeps `f.symbol.upper()` for each `f in resp.fundamentals`
  (`app/engine/fundsignal_loop.py:373-378`).
- Source slug key (F-07 — never hardcode): `analysis.fundsignal.source_slug` (default `fundamentals`),
  read by the producer via `get_str` (`fundsignal_loop.py:389` reads the sibling `scoring_formula_id` the
  same way). The analysis `ConfigWatcher(namespace="analysis")` reads this `analysis.*` key directly — no
  second cross-namespace subscription (contrast feature 154's boot-frozen `marketdata` subscription,
  `docs/patterns/config-governance.md:126-141`).
- Imports already present at module top: `ingest_pb2` (`live_loop.py:29`), `marketdata_pb2` (`:30`),
  `common_pb2` (`:28`), `Timestamp` (`:35`), `_normalize_symbol` (`:38`). Pagination constants
  `_DRAIN_PAGES` / `_DRAIN_PAGE_SIZE` (`:46-47`).
- **New outbound-gRPC / header-propagation note:** the resolver's `QuerySignals(source=slug)` and
  `GetFundamentalsMulti` are **platform-wide reads** (the fundamentals universe is global, not
  owner-scoped), so — exactly like the existing `_drain_signals` (`:370`, no metadata) and
  `_paced_fetch`'s `GetFundamentalsMulti` (`fundsignal_loop.py:373`, source-loop metadata) — they carry no
  per-request `x-user-id`. The live loop is a background timer, not an inbound RPC handler, so there is no
  request context to propagate (mirrors `_drain_signals`). This matches the analysis header-propagation
  posture in `docs/patterns/header-propagation.md`; no new owner-scoped edge is introduced.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add a module constant near `:46-47`, e.g. `_FUNDAMENTALS_CHUNK = 50` (mirrors
   `fundsignal_loop._paced_fetch`'s `chunk_size=50`).
2. Add `async def _resolve_fundamentals_universe(self) -> set:` to `LiveEvaluationLoop`. Wrap the whole
   body in one `try/except Exception → log.warning(...); return set()` (FR-6/AC-6 fail-closed — mirrors
   `_drain_signals:378-380`; **never** a broad watchlist/held fallback):
   - `slug = self._cfg.get_str("analysis.fundsignal.source_slug", "fundamentals")` (F-07).
   - Signals set `S`: `now = Timestamp(); now.GetCurrentTime(); window = common_pb2.TimeRange(start=now,
     end=now)`; paginate up to `_DRAIN_PAGES` issuing
     `self._ingest.QuerySignals(ingest_pb2.QuerySignalsRequest(source=slug, active_window=window,
     page=common_pb2.PageRequest(page_size=_DRAIN_PAGE_SIZE, page_token=page_token)))`; collect
     `_normalize_symbol(s.symbol) for s in resp.signals`; break when `resp.page.next_page_token` is empty.
     If `self._ingest is None`, `return set()`.
   - Fundamentals set `F`: for each `_FUNDAMENTALS_CHUNK`-sized chunk of `sorted(S)`, call
     `self._marketdata.GetFundamentalsMulti(marketdata_pb2.GetFundamentalsMultiRequest(symbols=chunk))` and
     add `f.symbol.upper()` for `f in resp.fundamentals` to `F`. If `self._marketdata is None`, `return
     set()`.
   - Return `S & F` (both already normalized upper). (Any `QuerySignals`/`GetFundamentalsMulti` raise is
     caught by the outer `try` → `set()`.)
3. Do **not** call it yet from `_run_cycle` — Step 4 wires the call site. Keep this step's diff to the new
   method + constant so the Step 3 unit test can drive it in isolation.

**Verification**: see the paired Step 3 (`red-green required`; coverage + lint run there).

---

### Step 3 — test: resolver intersection + fail-closed (RED-before-green)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_live_loop.py` — modify

**Reviewers**: xstockstrat-analysis — service owner of the service being tested

**Codebase Evidence**:
- Test harness: `_make_loop()` (`tests/test_live_loop.py:36-56`) builds a `LiveEvaluationLoop` with
  `AsyncMock` stubs (`ingest`, `marketdata`, …). The owner-scoped `_wire` helper (`:766-786`) already sets
  `loop._ingest.QuerySignals = AsyncMock(return_value=SimpleNamespace(signals=[SimpleNamespace(symbol=…)],
  page=SimpleNamespace(next_page_token="")))` — reuse this response shape and add a `GetFundamentalsMulti`
  mock returning `SimpleNamespace(fundamentals=[SimpleNamespace(symbol=…)])`.
- Config is a `MagicMock` whose `get_str` must be stubbed to return the slug (the default `_make_loop` cfg
  only stubs `get_int`/`get_int_present`, `:38-40`) — set `loop._cfg.get_str = MagicMock(side_effect=lambda
  key, default="": default)` so `analysis.fundsignal.source_slug` → `fundamentals`.
- Inline symbol literals (AAPL/MSFT/ZZZZ) are **single-consumer** in this test module (C-13): one consumer
  → inline is compliant, no `conftest.py` fixture home is created.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-6`

**Instructions**:
1. New test class `TestLiveLoopFundamentalsUniverse`. Author these to **fail against the pre-Step-2 tree**
   (`AttributeError: 'LiveEvaluationLoop' object has no attribute '_resolve_fundamentals_universe'`):
   - `test_intersection_keeps_only_signal_and_fundamentals` (**AC-1**): wire
     `QuerySignals` → signals for `AAPL, MSFT, ZZZZ` (source `fundamentals`); `GetFundamentalsMulti` →
     fundamentals rows for `AAPL, MSFT` only (not `ZZZZ`). Assert `await
     loop._resolve_fundamentals_universe() == {"AAPL", "MSFT"}` (ZZZZ dropped — signal but no fundamentals
     row), and assert the `QuerySignalsRequest` passed carried `source == "fundamentals"` (inspect
     `loop._ingest.QuerySignals.await_args`).
   - `test_querysignals_error_fails_closed_to_empty` (**AC-6**): `loop._ingest.QuerySignals =
     AsyncMock(side_effect=RuntimeError("ingest down"))`; assert `await loop._resolve_fundamentals_universe()
     == set()` (never a broad fallback).
   - `test_getfundamentals_error_fails_closed_to_empty` (**AC-6**): valid signals but
     `loop._marketdata.GetFundamentalsMulti = AsyncMock(side_effect=RuntimeError("md down"))`; assert the
     result is `set()`.
2. Run the paired coverage + lint verification below.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check . \
  && pytest tests/test_live_loop.py -k FundamentalsUniverse -q \
  && pytest --cov=app --cov-fail-under=40
```
RED before Step 2 (AttributeError / side_effect not yet reachable); GREEN after. C-13: confirm no second
inline copy of a domain literal introduced — `grep -n "from .conftest\|conftest" tests/test_live_loop.py`
(expect none; single-consumer inline is compliant).

---

### Step 4 — service: config-gated universe-override branch in `_run_cycle`

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/live_loop.py` — modify

**Reviewers**: xstockstrat-analysis — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `_run_cycle` `live_loop.py:263-356`. Existing cycle-start config reads at `:273-274`
  (`get_int("analysis.engine.max_strategies_per_cycle")`, `…alert_throttle_seconds`) — add the two blend
  reads alongside. `live_enabled` rows selected `:275-278`; `signal_symbols = await self._drain_signals()`
  `:280`; per-owner `held_cache`/`watch_cache` memoized `:283-295`; `resolve_universe(...)` per row
  `:296-298`; records `(created_at, strategy_id, symbol, definition, symbol in resolved.deny_entry)` built
  `:300-309`; global sort + rotation + per-pair `_eval_pair` `:312-345` (unchanged — the blend row flows
  through the same records list/scheduler).
- `watcher.get_str` `:87-93` (empty→default) and `watcher.get_bool` `:116-122` (`HasField("bool_val")` →
  explicit `false` honored) — the two new reads.
- `resolve_universe` `:83-105` and its feature-132 precedence: `denied = {_normalize_symbol(s) for s in
  definition.denied_symbols}` (`:97`), `deny_entry = held & denied` (`:103`), `universe = (union − denied)
  | deny_entry` (`:104`). The override reproduces this precedence with `fundamentals_universe` in place of
  `union` — strict FR-2 (held is **not** unioned in; only `held ∩ denied` re-enters, preserving the
  entry-only-deny exit trace for denied-held symbols, per the resolved Open Risk in `design.md:82-86` /
  `context.md:100`).
- `_normalize_symbol` imported `:38`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. At the top of `_run_cycle` (near `:273-274`), read:
   - `blend_id = self._cfg.get_str("analysis.engine.fundamentals_blend_strategy_id",
     "fundamentals_macd_blend")`.
   - `blend_enabled = self._cfg.get_bool("analysis.engine.fundamentals_blend_enabled", True)`.
2. After the `rows` fetch (`:275-278`), compute the gate:
   `blend_active = blend_enabled and any(dict(row).get("strategy_id") == blend_id for row in rows)`
   (use the same row-dict access the loop already uses; a `_row_to_strategy_definition` is built per row at
   `:291`, so either the raw row's `strategy_id` column or `definition.strategy_id` works — pick the raw
   column here to avoid building definitions twice).
3. Resolve the fundamentals universe **once**, only when `blend_active`, **before** the `for row in rows`
   loop (after `signal_symbols` at `:280`):
   `fundamentals_universe = await self._resolve_fundamentals_universe() if blend_active else set()`
   (FR-5/AC-4: when not `blend_active`, **no** `QuerySignals`/`GetFundamentalsMulti` call is issued and the
   loop is byte-identical to today; F-06 pacing).
4. Inside the `for row in rows` loop, after `definition = _row_to_strategy_definition(d)` (`:291`) and the
   owner watchlist/held memoization (`:293-295`), branch:
   - **If `blend_active and definition.strategy_id == blend_id`:** build the blend universe from
     `fundamentals_universe` instead of calling `resolve_universe`:
     `denied = {_normalize_symbol(s) for s in definition.denied_symbols}`;
     `deny_entry = held_cache[owner] & denied`;
     `blend_universe = (fundamentals_universe - denied) | deny_entry`;
     then append the same `(created_at, strategy_id, symbol, definition, symbol in deny_entry)` records for
     `symbol in sorted(blend_universe)` (reuse the existing append block `:300-309`). The blend strategy's
     `signal_params.symbols` allowlist is **ignored** (FR-2 replaces the universe — never re-narrowed).
   - **Else (every other strategy, and the blend id when `blend_active` is false):** unchanged —
     `resolved = resolve_universe(definition, watch_cache[owner], held_cache[owner], signal_symbols)` and
     the existing record append (`:296-309`). This preserves AC-3: no other strategy's universe changes,
     and the blend row is **added**, never substituted for another.
5. Leave the sort/rotation/cursor/`_eval_pair` tail (`:310-356`) untouched — the blend records compose with
   the fair-share scheduler exactly like any other pair (no parallel loop, no second cursor).

**Verification**: see the paired Step 5 (`red-green required`; coverage + lint run there).

---

### Step 5 — test: `_run_cycle` override end-to-end (RED-before-green)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_live_loop.py` — modify

**Reviewers**: xstockstrat-analysis — service owner of the service being tested

**Codebase Evidence**:
- `_live_row(strategy_id, user_id, symbols=None, denied=None, signal_eligible=False, created_at=None)`
  helper (`tests/test_live_loop.py:629-648`) builds a live `analysis.strategies` row; `loop._db.fetch =
  AsyncMock(return_value=[...])` feeds `_run_cycle` (`:700-701`, `:791-797`).
- `TestLiveLoopOwnerScoped._wire` (`:766-786`) wires `ListPositions`/`ListWatchlists`/`QuerySignals`;
  `fake_eval` capturing `(defn.user_id, symbol)` and assigned to `loop._eval_pair` is the established way to
  observe which `(strategy, symbol)` pairs a cycle evaluates without running the real evaluator
  (`:799-811`). Reuse both patterns; additionally stub `loop._cfg.get_str` (blend id + slug),
  `loop._cfg.get_bool` (kill-switch), and `loop._marketdata.GetFundamentalsMulti`.
- The default `_make_loop` cfg stubs only `get_int`/`get_int_present` (`:38-40`); the cycle reads
  `max_strategies_per_cycle`/`alert_throttle_seconds` via `get_int` (default passthrough is fine).
- Note the two `QuerySignals` call sites now differ by `source`: `_drain_signals` (no source, platform
  active signals) and `_resolve_fundamentals_universe` (`source=slug`). Use an `AsyncMock` `side_effect`
  keyed on `req.source` so the fundamentals query and the plain drain return different signal sets.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5, AC-6`

**Instructions**: new test class `TestLiveLoopBlendUniverse`. Stub `loop._cfg.get_bool = MagicMock(side_effect=lambda key, default=False: default)` and
`loop._cfg.get_str = MagicMock(side_effect=lambda key, default="": {"analysis.engine.fundamentals_blend_strategy_id": "fundamentals_macd_blend", "analysis.fundsignal.source_slug": "fundamentals"}.get(key, default))`
unless a scenario overrides it. Drive `await loop._run_cycle()` with a `fake_eval` capturing
`(defn.strategy_id, symbol)`; author all to fail on the pre-Step-4 tree (the blend strategy is evaluated on
its normal watchlist/held universe, not the fundamentals universe):
- `test_blend_runs_on_intersection` (**AC-1**): live `fundamentals_macd_blend`; `QuerySignals(source=…)`
  → `AAPL, MSFT, ZZZZ`; `GetFundamentalsMulti` → `AAPL, MSFT` only. Assert the blend pairs seen are exactly
  `{("fundamentals_macd_blend","AAPL"), ("fundamentals_macd_blend","MSFT")}` and **no** blend pair for
  `ZZZZ`.
- `test_blend_excluded_outside_universe` (**AC-2**): user `u-1` watchlist `GME` + held `AMC`, neither with
  a fundamentals signal; live `fundamentals_macd_blend`. Assert the blend is evaluated on **no** symbol in
  `{GME, AMC}` and only on fundamentals-universe symbols (assert the blend-pair symbol set ⊆ the
  fundamentals universe).
- `test_blend_additive_other_strategy_unchanged` (**AC-3**): user `u-1` live `sma_cross` over watchlist
  `{AAPL, GME}`; `AAPL` in the fundamentals universe, `GME` not; blend enabled. Assert `sma_cross` is
  evaluated for **both** `AAPL` and `GME` (its own universe unchanged) and `fundamentals_macd_blend`
  additionally only for `AAPL`. (No-regression guard for AC-3.)
- `test_noop_when_blend_strategy_not_live` (**AC-4**): rows contain no `fundamentals_macd_blend` (e.g. only
  `sma_cross`). Assert `_run_cycle` completes without error, evaluates `sma_cross` normally, and
  `loop._marketdata.GetFundamentalsMulti.await_count == 0` (resolver skipped — F-06).
- `test_config_retargets_to_other_id` (**AC-5**): stub `get_str` so
  `analysis.engine.fundamentals_blend_strategy_id == "fund_blend_v2"`; rows include live `fund_blend_v2`
  **and** a live `fundamentals_macd_blend`. `AAPL` in the fundamentals universe. Assert `fund_blend_v2` is
  evaluated for `AAPL` as the fundamentals-universe strategy, while `fundamentals_macd_blend` is treated as
  an ordinary strategy over its own (non-fundamentals) universe (assert its pairs match its watchlist/held,
  not the fundamentals universe).
- `test_resolution_failure_yields_empty_not_broad` (**AC-6**): live `fundamentals_macd_blend` for `u-1`
  with watchlist `{AAPL, TSLA}`; `QuerySignals(source=…)` raises this cycle (side_effect on the
  source-filtered call). Assert the blend is evaluated on **zero** symbols (not `AAPL`/`TSLA`) and the
  user's other live strategies still evaluate normally. Also assert the kill-switch path: with
  `get_bool(...)` stubbed to return `False` for `analysis.engine.fundamentals_blend_enabled`, the blend
  gets its ordinary universe and `GetFundamentalsMulti` is never called.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check . \
  && pytest tests/test_live_loop.py -k "BlendUniverse or FundamentalsUniverse" -q \
  && pytest --cov=app --cov-fail-under=40
```
RED before Step 4; GREEN after. C-13: single-consumer inline symbol literals — confirm no second inline
copy / no speculative `conftest.py` home introduced.

---

### Step 6 — docs: register both keys (config-governance log + analysis CLAUDE.md)

**Status**: `done`
**Service**: `docs/` + `services/xstockstrat-analysis`
**Files**:
- `docs/patterns/config-governance.md` — modify (Per-Feature Registered Keys log)
- `services/xstockstrat-analysis/CLAUDE.md` — modify (`## Config Keys Consumed` table)

**Reviewers**: none

**Codebase Evidence**:
- Per-Feature Registered Keys log is **newest-first, append-only** — insert the new entry above
  `### feature 161 …` at `docs/patterns/config-governance.md:105`; header/format precedent
  `:105-124` (feature 161) and the key-table precedent `:149-152` (feature 150).
- Analysis `## Config Keys Consumed` table (namespace `analysis`) lists the existing
  `analysis.engine.eval_interval_seconds` / `max_strategies_per_cycle` / `alert_throttle_seconds` rows —
  add the two new `analysis.engine.*` rows adjacent to them (`services/xstockstrat-analysis/CLAUDE.md`
  § Config Keys Consumed).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. `config-governance.md`: add a `### feature 168 — fundamentals-blend-universe (xstockstrat-analysis /
   xstockstrat-config)` entry above feature 161. State: registers `analysis.engine.fundamentals_blend_strategy_id`
   (string, default `fundamentals_macd_blend`) and `analysis.engine.fundamentals_blend_enabled` (bool,
   default `true`, `get_bool` HasField-based so an explicit `false` kill-switch is honored); seed migration
   `024_analysis_engine_blend_keys` (staging+production, full-dotted-key form per migration 021); read via
   the existing `analysis`-namespace WatchConfig stream (no cross-namespace subscription).
2. `services/xstockstrat-analysis/CLAUDE.md`: add two rows to the Config Keys Consumed table —
   `analysis.engine.fundamentals_blend_strategy_id` | string | `fundamentals_macd_blend` | strategy id the
   fundamentals-universe force-run rule governs (feature 168); and
   `analysis.engine.fundamentals_blend_enabled` | bool | `true` | kill-switch for the force-run rule; read
   via `get_bool` (HasField-based — an explicit `false` is honored).
3. Teardown note (root CLAUDE.md § Teardown): this step changes a context/governance doc, so run
   `/context-scrubber scan` scoped to these two files before the PR; if the context-forge plugin is
   unavailable, say so in the PR body.

**Verification**:
```bash
grep -n "feature 168 — fundamentals-blend-universe" docs/patterns/config-governance.md
grep -n "analysis.engine.fundamentals_blend_strategy_id\|analysis.engine.fundamentals_blend_enabled" \
  services/xstockstrat-analysis/CLAUDE.md   # 2 hits
```

---

## Deviation Log

- **Step 1 migration renumbered `024` → `026` (post-merge, 2026-09-01):** the spec (and every
  `024_analysis_engine_blend_keys` reference in Steps 1/verification above) pre-assigned config
  migration **024**. Feature 166's `025_ingest_mcp_client_keys` merged into `main-dev` first
  (PR #1063) while this branch was still open, so a `024` landing afterward would sit **below** the
  already-applied `025`, and golang-migrate (`migrate up` applies only versions > current) would
  never run it on the persistent dev/prod DBs — the two keys would silently never seed. The
  migration files were renamed to **`026_analysis_engine_blend_keys.{up,down}.sql`** (next free after
  025) and every durable reference (config-governance log, analysis `CLAUDE.md`) updated to `026`;
  the skipped `024` is a permanent, harmless gap (golang-migrate allows gaps). The Step-1 planning
  text above still reads `024` as authored — those references now denote the shipped `026` file.
- **Step 2 (accepted, impl-review advisory #3):** the fundamentals-side symbol normalization uses
  `_normalize_symbol(f.symbol)` rather than the spec's `f.symbol.upper()`, for symmetry with the
  signal side (`_normalize_symbol(s.symbol)`). Behavior-equivalent for uppercase tickers; both feed
  the same `signal_symbols & fundamentals_symbols` intersection.
- No other deviations. All 6 steps landed as specified; both code-bearing pairs passed the
  red-before-green gate (Step 3 RED via AttributeError pre-Step-2; Step 5's 5 substantive cases RED
  pre-Step-4). Analysis suite 654 pass, 85% coverage, ruff clean.
