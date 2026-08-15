# Implementation Spec: live-strategy-opportunity-attribution

**Status**: `pending`
**Created**: 2026-08-14
**Feature**: `docs/roadmap/features/131-live-strategy-opportunity-attribution/feature.md`
**Total Steps**: 5
**Feature Branch**: `feature/live-strategy-opportunity-attribution`

---

## Execution Summary

Single-service change in `xstockstrat-analysis` (Python), no proto / migration / DB-schema work.
The read-side `_compute_opportunities` (`servicer.py:2083-2242`) gains a fourth attribution origin —
a `live_by_symbol` index built from `live_enabled=TRUE AND active=TRUE` strategies' symbol universes —
so a held position or active signal covered by a live strategy surfaces that strategy's readiness
trace instead of falling through to unattributed (`strategy_id=""`, `0/0`). Order: (1) add the
repository method + shared SQL-predicate constant and re-point `live_loop.py`'s inline query at it
(structural no-drift for AC-5); (2) test it; (3) fold `live_by_symbol` into the attribution loops
with the three fan-out caps and widen `_drain_held_symbols`; (4) test it (with the mandatory harness
extensions); (5) register the three new config keys and update the service's attribution prose.
Steps 1→2 and 3→4 are the C-08 service/test pairs.

**Consumer surface (C-14).** The product spec names `/insights` Opportunities as the only consumer
surface and marks it **no UI code change required** — the existing display path
(`Opportunity.strategy_id`/`passing_conditions`/`total_conditions`/`provenance`,
`analysis.proto:447-459`, already rendered at
`services/xstockstrat-ui/src/app/insights/opportunities/page.tsx:333-341,354-356`) simply populates
more often. An existing e2e assertion already exercises that rendering path with real (non-`0/0`)
values (`e2e/insights/opportunities.spec.ts:70-72`), and the e2e mock is provenance-blind
(`e2e/mock-backend.ts` serves static `OPPORTUNITIES`, never routing through `_compute_opportunities`),
so no new fixture / `INVENTORY.md` row is needed (design.md Open Risk "C-12 fixture obligation —
RESOLVED"). No UI step is therefore required — this is a decision, not an omission.

## Step Dependencies

- Step 2 [test] covers Step 1 [service] (repository method + predicate parity).
- Step 4 [test] covers Step 3 [service] (`_compute_opportunities` attribution + `_drain_held_symbols`).
- Step 3 requires Step 1: `_compute_opportunities` calls `StrategiesRepository.list_live_enabled()`,
  added in Step 1. (In sequential execution the method exists before Step 3 consumes it; Step 2's
  test keeps it from being dead code between the two.)
- Step 5 [config] documents the three keys Step 3 reads via `self._cfg.get_int(...)`; no code
  ordering constraint (F-07 is satisfied in Step 3's code; Step 5 is the C-05 documentation duty).
- **Merge order (external, from `docs/roadmap/features/merge-order.md`):** this feature must open its
  integration PR **after `134-signal-source-reliability-weight`** lands (same-function overlap on the
  `signal_axis` line, `servicer.py:2163`) and **before `132-strategy-symbol-denylist`** (132 layers on
  131's `live_by_symbol`/`resolve_universe`). Full cohort order: `133 → 134 → 131 → 132`. `/sdd-execute`
  surfaces this at integration-PR time; it does not affect per-step execution.

---

### Step 1 — service: `StrategiesRepository.list_live_enabled()` + shared predicate constant

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/repositories/strategies.py` — modify
- `services/xstockstrat-analysis/app/engine/live_loop.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `list_live_enabled` / `LIVE_ENABLED_PREDICATE_SQL` do not exist yet — confirmed via
  `grep -rn "list_live_enabled\|LIVE_ENABLED_PREDICATE" app/ tests/` → no hits.
- Existing sibling `list()` to mirror: `app/repositories/strategies.py:147-161` —
  `sql = f"SELECT * FROM analysis.strategies {where} ORDER BY created_at DESC"`,
  `rows = await self._db.fetch(sql, *params)`, `return [_to_dict(r) for r in rows], int(total or 0)`.
  `_to_dict` (`strategies.py:14-24`) decodes `definition_json` and returns `dict(row)` including the
  `active`, `live_enabled`, and `created_at` columns.
- The live loop's inline predicate to de-duplicate: `app/engine/live_loop.py:188-190` —
  `rows = await self._db.fetch("SELECT * FROM analysis.strategies WHERE live_enabled = TRUE AND active = TRUE")`.
- `live_loop.py` already imports from the repositories/servicer layer at module level
  (`live_loop.py:29 from app.handlers.servicer import _row_to_strategy_definition`), so a module-level
  `from app.repositories.strategies import LIVE_ENABLED_PREDICATE_SQL` introduces no new cycle.

**TDD**: `red-green required`

**Instructions**:
1. In `strategies.py`, add a module-level constant (no leading underscore — it is designed for
   cross-module import per design.md § Chosen Approach "Repository/predicate"):
   `LIVE_ENABLED_PREDICATE_SQL = "live_enabled = TRUE AND active = TRUE"`.
2. Add a `list_live_enabled(self) -> list[dict]` method to `StrategiesRepository` (sibling of `list()`),
   returning `[_to_dict(r) for r in await self._db.fetch(f"SELECT * FROM analysis.strategies WHERE {LIVE_ENABLED_PREDICATE_SQL}")]`.
   No pagination, no `ORDER BY` (the caller ranks by `created_at` itself in Step 3). Returns the row
   dicts (each carrying `strategy_id`, `created_at`, `definition_json`, …).
3. In `live_loop.py`, add `from app.repositories.strategies import LIVE_ENABLED_PREDICATE_SQL` to the
   module-level imports (near `live_loop.py:29`), and change the query at `live_loop.py:188-190` to
   interpolate the constant: `await self._db.fetch(f"SELECT * FROM analysis.strategies WHERE {LIVE_ENABLED_PREDICATE_SQL}")`.
   Do **not** touch the loop's constructor, `_run_cycle` control flow, or `self._db.fetch(...)` call
   shape — this is the deliberately-minimal one-line predicate swap (design.md rejected the
   shared-method refactor for disproportionate blast radius on a tested production loop).

**Verification**:
```
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
grep -n "LIVE_ENABLED_PREDICATE_SQL" app/repositories/strategies.py app/engine/live_loop.py
# confirm: one definition in strategies.py, one import + one f-string use in live_loop.py,
# and the literal "live_enabled = TRUE AND active = TRUE" appears exactly ONCE in the tree
grep -rn "live_enabled = TRUE AND active = TRUE" app/ | wc -l   # → 1
```
Coverage + red-green enforced by the paired Step 2.

---

### Step 2 — test: `list_live_enabled()` predicate + single-source parity

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Test module already exercises `StrategiesRepository`-shaped fakes and `_db.fetch` mocks throughout
  (`tests/test_analysis_servicer.py`), and uses `AsyncMock` for async DB calls (e.g.
  `_materialized_svc`, `:3661-3662`). A minimal fake with an `AsyncMock` `fetch` returning asyncpg-`Record`-like
  dicts is the established shape.
- C-13 (Python) canonical fixture home is `tests/conftest.py`; the strategy-row literals here have a
  single consumer (this test) → inline is compliant; state that verdict, do not centralize speculatively.

**TDD**: `red-green required`

**Instructions**:
1. Add a test that constructs a `StrategiesRepository` over a fake db whose `fetch` (`AsyncMock`)
   returns a mixed set of rows and asserts `list_live_enabled()` issues a query containing
   `LIVE_ENABLED_PREDICATE_SQL` and returns the `_to_dict`-decoded rows. Since the SQL predicate is a
   server-side `WHERE`, the fake `fetch` should assert the SQL string passed to it **contains**
   `"live_enabled = TRUE AND active = TRUE"` (the shared constant), then return two rows and assert
   both come back `_to_dict`-decoded (so `definition_json` is a `dict`, not a JSON string).
2. Red-before-green: written against the pre-Step-1 tree the test fails at import/attribute
   (`AttributeError: 'StrategiesRepository' object has no attribute 'list_live_enabled'` and
   `ImportError` for `LIVE_ENABLED_PREDICATE_SQL`).
3. Do **not** add a re-declared-string parity test that hard-codes the predicate and asserts equality
   — design.md § Rejected Alternatives rejects it (proves nothing about `live_loop.py`'s real query;
   the shared constant already makes parity structural). Step 1's `wc -l → 1` grep is the parity guard.

**Verification**:
```
cd services/xstockstrat-analysis && ruff check . && ruff format --check . && pytest --cov=app --cov-fail-under=40
```
Confirm the new test passes and coverage stays ≥ 40%.

---

### Step 3 — service: fold `live_by_symbol` into `_compute_opportunities`; widen `_drain_held_symbols`

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Target function: `_compute_opportunities`, `servicer.py:2083-2242`. Origin indexes built at
  `:2102-2109` (`watchlist_by_symbol` via `setdefault(_normalize_symbol(sym), set()).add(strat)`,
  `signals_by_symbol`, `held_norm`). `_candidate()` template `:2113-2129` (fields
  `is_watchlist`/`is_held`/`signal_axis`/…). `_add_provenance()` `:2131-2133`.
- Watchlist loop `:2135-2140`; held loop `:2142-2150` (`targets = list(strats) if strats else [""]`);
  signals-merge loop `:2152-2168` (`targets = [k for k in candidates if k[0] == sym]`, `:2155`);
  curated/speculative split + universe cap `:2170-2177`
  (`curated = [c for c in candidates.values() if c["is_watchlist"] or c["is_held"]]`,
  `max_universe = self._cfg.get_int("analysis.opportunity.max_universe_size", 100)`, `:2172`).
- Trace call site `:2205-2209` (`rule = "exit" if c["is_held"] else "entry"`,
  `evaluate_conditions_traced(...)`) — unchanged; it already keys off `c["strategy_id"]`/`c["is_held"]`.
- Deferred-import precedent for the exact helper: `servicer.py:1824`
  `from app.engine.live_loop import strategy_symbols  # noqa: PLC0415 (avoids import cycle)`.
- `_row_to_strategy_definition(row: dict) -> StrategyDefinition` is module-level in the same file
  (`servicer.py:2990`) — call directly, no import.
- `strategy_symbols(definition)`: `live_loop.py:37-47`, public, reads `signal_params.symbols` via
  `HasField` + `MessageToDict` (import, do not duplicate — DRY guard rail).
- `_normalize_symbol`: `servicer.py:2542-2545` (`(symbol or "").strip().upper()`).
- `_drain_held_symbols`: `servicer.py:2384-2410` — currently `-> set`, `held.update(p.symbol for p in resp.positions)`.
  Two call sites: `servicer.py:1924` (ScreenSymbols held cross-ref, membership test `if r.symbol in held:` at `:1926`)
  and `servicer.py:2099` (`_compute_opportunities`, then `held_norm = {_normalize_symbol(s) for s in held}` at `:2109`).
- `Position.market_value` = field 5, `double` — confirmed `grep -n "market_value" packages/proto/portfolio/v1/portfolio.proto` → `double market_value = 5;`.
- Drain backstops: `_MAX_DRAIN_PAGES = 50` (`servicer.py:107`), `_BAR_PAGE_SIZE = 1000` (`servicer.py:94`).
- `self._strategies_repo` may be `None` (guarded in `_load_strategy_definition`, `servicer.py:2253`
  `if self._strategies_repo is not None`) — mirror that guard for the new `list_live_enabled()` call.

**TDD**: `red-green required`

**Instructions**:
Implement design.md § Chosen Approach steps 1–7 **verbatim in mechanism** (the design is the
authoritative source; do not re-derive). Concretely, inside `_compute_opportunities`:

1. **Widen `_drain_held_symbols` (`servicer.py:2384-2410`)** from `-> set` to `-> dict[str, float]`
   keyed by **normalized** symbol, valued by summed `abs(Position.market_value)`:
   accumulate `held.setdefault(_normalize_symbol(p.symbol), 0.0)` `+= abs(p.market_value)` per position
   across pages; init `held: dict[str, float] = {}`; early-return `{}` when `self._portfolio is None`.
   (Normalize at construction — design.md § Rejected Alternatives rejects keeping it raw-keyed: the
   ranking read in step 5 uses a normalized `sym`, so a raw key silently ranks a real symbol at 0.0.)
2. **Screener call-site adjustment (`servicer.py:1926`)** — REQUIRED, and a deliberate departure from
   design.md's "both call sites are dict-compatible with zero other changes" prose (which understates
   this; surfaced at `/sdd-spec` per P-03, record as a deviation if a reviewer asks). `held` is now a
   dict keyed by normalized symbols; change `if r.symbol in held:` to
   `if _normalize_symbol(r.symbol) in held:` so the membership test stays correct against normalized
   keys (preserves current behavior for already-uppercase broker tickers; strictly more correct for a
   mixed-case one). Do not otherwise touch `ScreenSymbols`.
3. **`_compute_opportunities` local `held` → `held_value_by_symbol`**: at `servicer.py:2099` rename the
   local to `held_value_by_symbol` (a dict now), and replace `:2109`
   `held_norm = {_normalize_symbol(s) for s in held}` with `held_norm = set(held_value_by_symbol)`
   (keys already normalized).
4. **Build `live_by_symbol` + `created_at_by_strategy`** after the existing index block (`:2109`),
   guarded by `if self._strategies_repo is not None`: deferred-import `strategy_symbols` from
   `app.engine.live_loop` (mirror `servicer.py:1824`); for each row from
   `await self._strategies_repo.list_live_enabled()`, `definition = _row_to_strategy_definition(row)`,
   and for each `sym` in `strategy_symbols(definition)`:
   `live_by_symbol.setdefault(_normalize_symbol(sym), set()).add(row["strategy_id"])` **and**
   `created_at_by_strategy[row["strategy_id"]] = row["created_at"]`. Normalizing the key here is
   load-bearing (design.md step 1: `signal_params.symbols` has no write-time case validation, so an
   un-normalized key would silently never match `held_norm`/`signals_by_symbol`).
5. **Extend `_candidate()` template (`servicer.py:2117-2127`)** with `"is_live": False`.
6. **`_capped_live(sym, exclude=frozenset())`** helper local to `_compute_opportunities`, reading the
   per-symbol cap once alongside `max_universe`:
   `max_live_strats = self._cfg.get_int("analysis.opportunity.max_live_strategies_per_symbol", 5)`;
   `_capped_live` returns
   `sorted(live_by_symbol.get(sym, set()) - exclude, key=lambda s: created_at_by_strategy[s])[:max_live_strats]`.
   Tiebreak is `created_at` ascending (design chose this over lexicographic `strategy_id`). **Add an
   inline comment on `_capped_live` that the exclude-before-slice order is load-bearing** for the
   held loop's `_capped_live(sym, exclude=watch)` composition (design.md step 6 proof; the
   `/sdd-spec` recommendation targets this call site).
7. **Watchlist loop (`:2135-2140`)**: after `_add_provenance(c, "watchlist")`, if
   `strat in live_by_symbol.get(sym, set())` (full uncapped index — tagging-only, zero marginal cost)
   also set `c["is_live"] = True` and `_add_provenance(c, "live_strategy")`. Per-strategy check, not a
   blanket per-symbol union.
8. **Held loop (`:2142-2150`)**, bounded by the held cap:
   `max_live_held = self._cfg.get_int("analysis.opportunity.max_live_held_symbols_per_compute", 20)`;
   `live_eligible_held = [sym for sym in held_norm if _capped_live(sym, exclude=watchlist_by_symbol.get(sym, set()))]`;
   `ranked_held = sorted(live_eligible_held, key=lambda sym: (-held_value_by_symbol.get(sym, 0.0), sym))`;
   `held_live_budget = set(ranked_held[:max_live_held])`. Then for each `sym in held_norm`:
   `watch = watchlist_by_symbol.get(sym, set())`; `live_all = live_by_symbol.get(sym, set())`;
   `live_new = _capped_live(sym, exclude=watch) if sym in held_live_budget else []`;
   `targets = list(watch | set(live_new)) if (watch or live_new) else [""]`. For each `strat` in
   `targets`: unconditional `c["is_held"]=True` + `_add_provenance(c, "position")` (every held symbol
   still gets ≥1 row — cap governs only the live-attribution fan-out), **plus** if `strat in live_all`
   set `c["is_live"]=True` + `_add_provenance(c, "live_strategy")`.
9. **New bounded step, inserted between the held loop and the signals-merge loop (before `:2152`)** —
   the per-`(symbol, strategy)` distinct-symbol-capped block from design.md step 6:
   `_new_live_strats(sym) = [s for s in _capped_live(sym) if (sym, s) not in candidates]`;
   `live_signal_symbols = (signals_by_symbol.keys() & live_by_symbol.keys()) - held_norm` (the
   `- held_norm` exclusion is load-bearing — a held symbol here would produce a wrongly entry-traced
   duplicate; design.md step 6 + Open Risk);
   `competitive_pool = [sym for sym in live_signal_symbols if _new_live_strats(sym)]`;
   `max_live_only = self._cfg.get_int("analysis.opportunity.max_live_only_symbols_per_compute", 20)`;
   `ranked = sorted(competitive_pool, key=lambda sym: (-max(sig.conviction for sig in signals_by_symbol[sym]), sym))[:max_live_only]`;
   for each `sym` in `ranked`, for each `strat` in `_new_live_strats(sym)`: `c = _candidate(sym, strat)`,
   `c["is_live"] = True`, `_add_provenance(c, "live_strategy")`. This pre-seeds the row before the
   signals-merge loop's `targets = [k for k in candidates if k[0] == sym]` (`:2155`) finds it.
   Use `_capped_live(sym)` with **no** `exclude` here (design.md step 6 proof — exclude-before-slice
   would breach the per-symbol cap).
10. **Curated predicate (`:2173`)**: extend to
    `curated = [c for c in candidates.values() if c["is_watchlist"] or c["is_held"] or c["is_live"]]`,
    and the `speculative` list's negation correspondingly
    (`not (c["is_watchlist"] or c["is_held"] or c["is_live"])`). Unconditional per existing candidate —
    the caps operate strictly upstream at creation time, never demoting an existing curated candidate.
11. Confirm no conviction-formula change (Open Question / fails.md 2026-08-05): this feature changes
    only *which* candidates get traced, never the `conviction` ordinal or `signal_axis` math — re-confirm,
    do not touch `:2163` or the readiness ordinal.

Read the three new caps via `self._cfg.get_int(...)` only — never hardcode the defaults as Python
literals (F-07).

**Verification**: red-green enforced by the paired Step 4; lint + coverage run there. Structural check:
```
cd services/xstockstrat-analysis
grep -n "list_live_enabled\|live_by_symbol\|is_live\|_capped_live\|held_value_by_symbol\|max_live_strategies_per_symbol\|max_live_only_symbols_per_compute\|max_live_held_symbols_per_compute" app/handlers/servicer.py
# confirm the three get_int keys are read (F-07), _drain_held_symbols returns a dict, screener site normalized
```

---

### Step 4 — test: live-strategy attribution + mandatory harness extensions

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- **Harness break (mandatory fix):** `_materialized_svc` (`:3637-3673`) stubs
  `svc._strategies_repo = AsyncMock()` and sets only `get_by_id` (`:3661-3662`). Once Step 3 calls
  `self._strategies_repo.list_live_enabled()`, a bare `AsyncMock` returns a `MagicMock` (not a list) and
  the `for row in …` build raises `TypeError` — this breaks **all 12** existing
  `TestListOpportunitiesMaterialized` tests (`:3683-3877`). `_materialized_svc` MUST default
  `list_live_enabled` to return `[]` (and accept live rows for new tests).
- `_strat_row` (`:3608-3630`) builds a strategy row dict but sets **no** `signal_params.symbols` and
  **no** `created_at` — both are needed for a live-covered row (`strategy_symbols` reads
  `signal_params.symbols`; `_capped_live`'s `created_at_by_strategy[s]` reads `created_at`).
- Test suite home / conventions: `class TestListOpportunitiesMaterialized` (`:3683`); sibling naming
  `test_<condition>_<expected_behavior>`; helpers `_sig`, `_wl`, `_list_opps` (`:3676-3680`, returns
  `{o.symbol: o}` + the list); config mock `make_servicer` returns defaults
  (`cfg.get_int = MagicMock(side_effect=lambda key, default=0: default)`, `:38`), so the three new caps
  read as `5/20/20` with no extra wiring.
- Insertion-order safety confirmed (design.md Open Risk "Insertion-order test fragility — RESOLVED"):
  existing assertions are set/dict-key/`len`-based except `test_ranked_by_conviction_and_signal_axis`
  (`:3790-3800`), whose order comes from `_FakeOppRepo.read()`'s rank-sort (`:3552`), decoupled from
  `candidates` build order — the new step-6 insertion cannot regress it.
- C-13 (Python) home is `tests/conftest.py`; strategy-row literals have a single consumer (this file)
  → inline compliant; record that verdict.

**TDD**: `red-green required`

**Instructions**:
1. **Extend `_materialized_svc`**: add a `live_strategies=None` param; set
   `svc._strategies_repo.list_live_enabled = AsyncMock(return_value=list(live_strategies or []))`.
   Default `[]` keeps every existing test green (this is the harness fix, not optional).
2. **Extend `_strat_row`** (or add a sibling `_live_strat_row`) so a row can carry
   `signal_params.symbols` (set `StrategyDefinition(signal_params=Struct/…)` — mirror the proto shape;
   `strategy_symbols` reads it via `MessageToDict`) and a `created_at` value (any deterministic
   `datetime`). Keep the default (no `signal_params`, no `created_at`) so existing callers are
   unchanged (C-13: centralize only under a real second consumer).
3. **New tests as siblings inside `TestListOpportunitiesMaterialized`**, each red before Step 3:
   - **AC-1**: a held symbol in a live strategy's `signal_params.symbols`, no watchlist binding →
     attributed to that strategy with a **real exit-rule** trace (`total_conditions > 0`, not `0/0`),
     `"live_strategy"` in provenance, `is_live` → curated.
   - **AC-2**: an active signal (no watchlist, no held) on a live-covered symbol → attributed with a
     **real entry-rule** trace, `total_conditions` == the entry-rule leaf count, `"live_strategy"` in
     provenance, and the candidate is `curated` (survives the `max_universe_size` cut) — this is the
     one case FR-6 actually changes (recon.md nuance: held is already curated).
   - **AC-3**: a symbol covered by both a watchlist binding **and** a live strategy for the **same**
     `(symbol, strategy_id)` → exactly one row, `provenance ⊇ {"watchlist", "live_strategy"}`.
   - **AC-5**: an `active=TRUE, live_enabled=FALSE` strategy (absent from `list_live_enabled`'s
     return) never attributes a live candidate — assert no `"live_strategy"` provenance / no `is_live`
     row for its symbol.
   - **AC-4 curated classification**: a live-only (signal-covered) candidate lands in `curated`, not
     truncated by a tiny `max_universe_size` (drive via the `make_servicer` default or a per-test
     `get_int` override, mirroring `:887`/`:2251`).
4. **Waived (design.md Open Risk "Test-helper incompatibility — CLOSED, not required", explicit user
   decision):** do **not** add a dedicated multi-strategy-per-same-symbol (`_list_opps` by-`symbol`
   grouping) test. Record this as a chosen scope waiver in the step, not a silent gap.
5. Run against the pre-Step-3 tree to confirm the new tests fail (attribute/behavior), then pass after.

**Verification**:
```
cd services/xstockstrat-analysis && ruff check . && ruff format --check . && pytest --cov=app --cov-fail-under=40
```
Confirm: all pre-existing `TestListOpportunitiesMaterialized` tests still pass (harness fix), the new
tests pass, coverage ≥ 40%.

---

### Step 5 — config: register the three new keys + update attribution prose

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify
- `docs/patterns/config-governance.md` — modify

**Reviewers**: `xstockstrat-analysis` owner — config key naming (`<service>.<category>.<key>`), backtest determinism

**Codebase Evidence**:
- Existing `analysis.opportunity.*` rows to sit beside: `services/xstockstrat-analysis/CLAUDE.md`
  § Config Keys Consumed (the `analysis.opportunity.max_universe_size`/`valid_window_hours`/
  `snooze_default_hours`/`signal_rank_weight`/`refresh_hour_utc` block).
- Per-Feature Registered Keys log: `docs/patterns/config-governance.md:76` (append-only, newest-first;
  one entry per feature with a header + a Key/Type/Default/Description table — see feature 129/102/030
  entries as the format, `:80-110`). The existing `analysis.opportunity.max_universe_size` row is at
  `config-governance.md:172`.
- Config-key naming `<service>.<category>.<key>` (C-05) — all three follow `analysis.opportunity.*`.

**TDD**: `N/A (docs/config registration — no code)`

**Instructions**:
1. In `services/xstockstrat-analysis/CLAUDE.md` § Config Keys Consumed, add three rows in the
   `analysis.opportunity.*` block:
   - `analysis.opportunity.max_live_strategies_per_symbol` | int | `5` | Per-symbol cap: how many
     live-enabled strategies may **newly** attribute to one symbol via live-coverage (candidate-creation
     sites only; tagging an existing row is uncapped). AC-7.
   - `analysis.opportunity.max_live_only_symbols_per_compute` | int | `20` | Cap on distinct **non-held**
     signal+live-covered symbols that get a new candidate row per compute pass (step 6). Composes
     multiplicatively with the per-symbol cap. AC-8.
   - `analysis.opportunity.max_live_held_symbols_per_compute` | int | `20` | Cap on distinct **held**
     symbols that may receive a new live-only strategy attribution per compute pass (does not bound the
     held-row count itself). AC-9.
   Note the combined worst case (200 newly-attributed rows across the two disjoint pools) per AC-9's
   compound note; do not present any single key as *the* row ceiling.
2. In `docs/patterns/config-governance.md` § Per-Feature Registered Keys, prepend a new **newest-first**
   entry: `### feature 131 — live-strategy-opportunity-attribution (\`xstockstrat-analysis\`)` with a
   short rationale (live-strategy symbol-coverage attribution + three compute-fan-out caps; read live
   via `self._cfg.get_int(...)`, no config-service seed migration — mirrors the existing
   `analysis.opportunity.*` no-seed pattern) and the three-row Key/Type/Default/Description table.

**Verification**:
```
grep -n "max_live_strategies_per_symbol\|max_live_only_symbols_per_compute\|max_live_held_symbols_per_compute" \
  services/xstockstrat-analysis/CLAUDE.md docs/patterns/config-governance.md
# confirm all three keys documented in BOTH files
```
Then, per the root CLAUDE.md Teardown rule, run `/context-scrubber scan` scoped to the two edited
context docs and fix any grounded findings (or note in the PR body if the plugin is unavailable).

---

## Deviation Log

### D-1 — `list_live_enabled` owner-scoped for the per-user compute (post-133 ownership)
**Disposition**: fix-now (§5.7 Option A), applied not blocked — a single correct behavior, not a fork.
131's spec predates feature 133 (strategy ownership, merged before 131 executes). `_compute_opportunities`
is now **per-user**; a global `list_live_enabled()` would attribute *another* user's live strategy to
this user's held/signal symbols — an IDOR leak (the other origins, held/watchlist, are already
owner-scoped). Added an optional `user_id` param to `list_live_enabled` (Step 1): **no arg → global**
(the live loop, deliberately global, keeps calling it with no arg — AC-5 unchanged); **user_id given →
`AND user_id = $1`** (Step 3's compute passes the compute's `user_id`). Step 2 tests both paths.
Recorded in `fails.md` (a spec written before a security-model feature lands must be re-owner-scoped).

### D-2 — Step 4 harness fix: held-position mock needs `market_value` (Step 3 side effect)
**Disposition**: applied — a mandatory harness fix implied by Step 3, beyond Step 4's written instructions.
Step 3 instruction 1 widened `_drain_held_symbols` to sum `abs(Position.market_value)`, so the
`_materialized_svc` `ListPositions` mock (which built `SimpleNamespace(symbol=s)` with no
`market_value`) had to carry a value or every held test raises `AttributeError`. Extended the mock's
`held` param to accept a plain symbol (default value `1000.0`) **or** a `(symbol, market_value)` tuple
for the value-ranked live-budget path. Step 4's instructions named only the `list_live_enabled`
default; this is the second implied harness break, recorded here (P-03: surfaced, not silently done).

### D-3 — Step 3 screener call-site normalization (design-prose understatement)
**Disposition**: applied as the spec's own Step 3 instruction 2 anticipated. `_drain_held_symbols` now
keys by **normalized** symbol, so `ScreenSymbols`'s `if r.symbol in held:` membership test became
`if _normalize_symbol(r.symbol) in held:` — preserving behavior for already-uppercase broker tickers,
strictly more correct for a mixed-case one. design.md's "both call sites are dict-compatible with zero
other changes" understated this one line; the impl-spec already flagged it (recorded here per that note).

### D-4 — `_capped_live`/`max_live_strats` defined before the loops, not "alongside `max_universe`"
**Disposition**: applied — faithful to intent, position adjusted for correctness. The spec (instruction 6,
echoing design step 3) said to read the per-symbol cap "alongside `max_universe`", but `max_universe`
is read **after** the attribution loops while `_capped_live` is consumed **inside** the held loop and
the live-only step. Defined `max_live_strats` + `_capped_live` right after the `live_by_symbol` build
(before the watchlist loop) so it exists at first use; still a single `get_int` read (F-07 satisfied).
`max_universe` stays at its original site. No behavior change — purely ordering.
