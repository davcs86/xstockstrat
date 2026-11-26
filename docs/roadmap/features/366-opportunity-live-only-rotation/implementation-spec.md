# Implementation Spec: opportunity-live-only-rotation

**Status**: `pending`
**Created**: 2026-11-26
**Feature**: `docs/roadmap/features/366-opportunity-live-only-rotation/feature.md`
**Total Steps**: 11
**Feature Branch**: `feature/opportunity-live-only-rotation`

---

## Execution Summary

The spec follows design.md's Chosen Approach (the round-5 synthesis, D-1..D-16). It brings back none of
R-1..R-16, and it reuses recon.md's Patterns to REUSE: the live_loop identity-resume cursor algorithm
(`app/engine/live_loop.py:459-510`), the single `_replace_and_stamp_compute_state` write helper
(`servicer.py:4922`), `replace_for_user`'s whole-user DELETE+INSERT transaction, and the
`int_positive` config read form (`servicer.py:5543`).

Order:

1. **Schema.** Step 1 adds the cursor column (analysis `030`).
2. **Repositories.** Steps 2-3 add the cursor read/write, the explicit `computed_at` bind, the
   attributed-row read and a transaction handle, with unit and `real_pg` tests.
3. **Compute (one atomic unit, Steps 4-6).** The rotation chunk, the carried rows, the live-only
   validity stamp, the shortfall log, the `(rows, new_cursor)` return and the atomic persist. The unit
   also holds the config seed (config `056`) and the bounds entry, because CI's whole-tree wiring
   check (`node scripts/check-config-wiring.mjs --final`, `.github/workflows/ci.yml:1313`) fails on a
   read-unseeded or seeded-unread key.
4. **Heal (Steps 7-8).** The surgical heal applies the live-only stamp.
5. **Read side (Steps 9-10, one unit).** One `include_expired=True` read split into branches
   (i)-(v), plus the `analysis.opportunity.read_reissue` counter.
6. **Docs (Step 11).** The C-05 doc sync and the C-16 CHANGE rule text.

**Consumer surfaces (C-14).** No `xstockstrat-ui` or `xstockstrat-agent` step exists; the recorded
rationale and its pinning test are in § Step Dependencies ("Consumer surfaces (C-14)").

### Scenario Coverage (C-15)

| Scenario | Step(s) |
|---|---|
| `@AC-1` one compute evaluates at most one chunk | 5 |
| `@AC-2` successive computes cover the pool | 5 |
| `@AC-3` earlier-chunk rows survive, own `valid_until` | 5 |
| `@AC-4` a symbol leaving the pool loses carried rows | 5 |
| `@AC-5` rotation position survives a restart | 3 (DB round-trip), 5 (new servicer instance) |
| `@AC-6` a joining symbol is reached within one cycle | 5 |
| `@AC-7` held and watchlist rows unaffected | 5 |
| `@AC-8` removals do not delay remaining members | 5 |
| `@AC-9` held and per-symbol caps keep their limits | 5 |
| `@AC-10` full rotation within the cycle bound | 5 |
| `@AC-11` oversized pool keeps the limit, logs the shortfall | 5 |
| `@AC-12` carried row older than one cycle removed | 5 (plus the `>=` boundary in the pure-helper test) |

### O-7 gate (verified this session)

The design made O-7 the `/sdd-spec` gate. It was checked on tree `origin/feature/opportunity-live-only-rotation@dfa444c2`
(`origin/main-dev@34f68c57` is 1 commit ahead, with no diff under `services/`):

- **365** (`origin/feature/fix-a-filtered-listopportunities`, implementation-ready) has **no code on
  any branch yet**. Its spec (Step 1) replaces the bare `else:` at `servicer.py:4790` with
  `elif not await opps.has_fresh(user_id):` and adds `"has_fresh": "fetchval"` to
  `tests/conftest.py:298` `_BC_METHOD_FOR`. Step 9 here is written against that post-365 shape, and
  the Precondition below gates on it.
- **308** (`origin/feature/fix-analysis-per-symbol-isolation`, in-progress): its current service diff
  touches `app/services/{evaluator,isolation,screener}.py` and one line of `servicer.py`. Its spec
  Steps 11-12 change `_row_for` only (one `try` over loaders and eval, and the
  `EVALUATION_FAILED_PROVENANCE` marker). Neither touches step 2b, the stamp, `replace_for_user` or
  `_replace_and_stamp_compute_state`. 366 rebuilds held, watchlist and muted rows fresh every compute
  and carries only live-only rows, and any failure fails the whole compute (D-3). So 308 R-4 ("never
  drop held/watchlist/muted rows on a failure path") holds.
  - **Finding (no design change; flagged for impl-spec review).** 308 adds an `evaluation_failed`
    marker whose non-held stored action is the UNSPECIFIED override. The binding O-9 rule keeps
    without comparing only for `fundamentals_unavailable` and `formula_unreadable`. So a carried
    `evaluation_failed` live-only row is compared, does not match, and is dropped. The symbol then
    falls back to its fresh `(sym, "")` row (D-12), so no pool symbol loses all rows. Adding
    `evaluation_failed` to the keep-list would need an operator ruling.
- **330** (`origin/feature/fix-live-enrich-ttl-seed`): its config migration `055` is already on trunk.
  Its remaining diff touches no `servicer.py` code. It has no conflict with 366.
- **Migration numbers.** `git log --remotes --diff-filter=A` over both `migrations/` dirs finds no
  analysis `03x` and no config `056`-`059` on any of the 220 remote refs. So analysis **`030`** and
  config **`056`** are free. They stay provisional until merge.

## Step Dependencies

- **Consumer surfaces (C-14).** The product spec names `xstockstrat-ui` `/insights/opportunities`,
  `/trader/positions/[symbol]` and the agent tool `list_opportunities`. design.md (Consumer surfaces)
  decides they are reached only through the existing `ListOpportunities` rows and their per-row
  `valid_until`: every served row is mapped by `_row_to_opportunity` (`servicer.py:4746`, defined at
  `:6925`), which already sets `Opportunity.valid_until` per row (pinned at
  `tests/test_analysis_servicer.py:6462`). There is no proto, UI or agent code change (recon.md:107).
  This is a recorded decision, not an omission. Step 10 adds the test that pins mixed per-row
  `valid_until` values reaching the `ListOpportunities` response.
- **Precondition before Step 1.** Rebase in the order 365, then 308 and 330, then 366 (operator
  decision 2026-11-26). Merge `origin/main-dev` into `feature/opportunity-live-only-rotation` once 365
  has merged. Then confirm
  `grep -n "elif not await opps.has_fresh(user_id):" services/xstockstrat-analysis/app/handlers/servicer.py`
  finds exactly one hit. If 365 has not merged, Steps 1-8 may run, but Step 9 is blocked (P-03).
  - After 308 merges, line numbers in `servicer.py` move. Re-locate every cited site by its symbol
    or its quoted code, never by its line number.
- Step 2 requires Step 1, because `get` selects the new column.
- Step 3 covers Step 2 [service → test].
- **Steps 4+5+6 land together.**
  - Trigger (§C "changes a return shape"): Step 4 changes `_compute_opportunities` from `list[dict]` to
    `(rows, new_cursor)`. That breaks every unpacking test call site, about 25 of them, and three
    `AsyncMock(return_value=[])` stubs (Step 5 lists them). Ledger `fails.md:1860-1865` warns about this
    arity trap.
  - Trigger (§C "adds a read classified by a guard test"): `tests/test_config_read_classification.py`
    requires every new read to be classified.
  - Trigger (§C "seeds a config key"): Step 6's seed must land with Step 4's reader.
  - All three steps are on the backend consumer surface.
- **Steps 7+8.** Step 7 requires Step 4 (`_is_live_only_row`, `_live_only_cycle_days`). Step 8 covers
  Step 7. They are not a unit, because no existing test breaks.
- **Steps 9+10 land together.**
  - Trigger: Step 9 changes the first read to `include_expired=True`. That turns
    `tests/test_analysis_servicer.py:7930` red (`[c.kwargs["include_expired"] for c in calls] == [False, True]`),
    and Step 10 repairs it.
  - Step 9 requires the Precondition (365) and Step 4 (`_is_live_only_row`).
- Step 11 requires Steps 4, 6, 7 and 9, because it documents their behaviour.
- Step 6 regenerates `scripts/config-wiring-stored.json`. Regenerate it again after any `origin/main-dev`
  merge that brings in another config migration (`inputs_sha256`, 330 spec precedent). A renumber of
  `056` re-runs Step 6's Verification.
- Durable-suite promotion (C-16) runs in the `/sdd-execute` integration PR, not in a step. It covers
  366's scenarios and the `docs/sdd/business-rules/platform.feature` `@AC-6 @feature-244` stored-zero row
  for `analysis.opportunity.live_only_cycle_max_days` (stored 0 reads as 3).

## Assumptions (recorded per CLAUDE.md "How to Act" #1, for impl-spec review)

1. **Pool bucket = projected computes.** The design never defines the "pool bucket" in the O-12 log key
   (pool bucket, N, cycle_days). This spec uses `projected_computes = -(-P // N)`, the same expression
   as `live_loop.py:484`. Changes in pool size that do not move the projection then stay quiet.
2. **Shortfall condition.** D-5 makes the planning unit one chunk per full compute, at one daily
   refresh. So the shortfall fires when `projected_computes > cycle_max_days`. AC-11 (P=350, N=20) gives
   18 > 3.
3. **Transaction handle.** D-2 says the servicer owns one `acquire()` + `transaction()`. The spec opens
   it through a new `OpportunitiesRepository.transaction()` context manager, on the repository's own
   pool. In production that is the same `db_pool` (`servicer.py:610,622`). It is not
   `self._db_pool.acquire()`, because the `read_path` "pool" fixture swaps `self._db_pool` for a
   `FakePool` whose `acquire` is a plain coroutine (`tests/conftest.py:280-288`). Same connection, same
   transaction, same pool (F-06). When the cursor is `None` the helper keeps today's single
   `replace_for_user` call.
4. **Carry read only on a non-empty pool.** The cursor read and the attributed-row read run only when
   `competitive_pool` is non-empty. With no pool, nothing can be carried and the cursor is untouched
   (D-1). That keeps every no-live-strategy test off the new reads.
5. **Pure helpers for exact boundaries.** The chunk (`_rotation_chunk`) and predicate (e)
   (`_carry_within_cycle`) are module-level pure functions. The FR-8 `>=` boundary and the wrap/churn
   cases can then be pinned with exact timestamps, without patching the clock.

---

### Step 1 — migration: `live_only_cursor` column on `analysis.opportunity_compute_state`

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/migrations/030_opportunity_compute_state_live_only_cursor.up.sql` — create
- `services/xstockstrat-analysis/migrations/030_opportunity_compute_state_live_only_cursor.down.sql` — create

**Reviewers**: DBA — Migration NNN numbering (no gaps, no conflicts), up+down pair present, run-order compliance; xstockstrat-analysis owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Last analysis migration: `029_seed_fundamentals_blend_strategy.up.sql` (`ls services/xstockstrat-analysis/migrations | tail -4`). No remote ref adds `03x`.
- Table: `migrations/023_opportunity_compute_state.up.sql:8-13`, which has `user_id TEXT NOT NULL`, `computed_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `valid_until TIMESTAMPTZ NOT NULL` and `PRIMARY KEY (user_id)`. Its down is `DROP TABLE IF EXISTS analysis.opportunity_compute_state;`.

**TDD**: `N/A (migration)`

**Covers**: —

**Instructions**:
1. Up: a header in the 023 style (`-- Migration: 030_..., -- Service: xstockstrat-analysis`, one
   constraint line: the cursor is the last-evaluated normalized symbol of the live-only rotation,
   written only in the queue-replace transaction). Then
   `ALTER TABLE analysis.opportunity_compute_state ADD COLUMN IF NOT EXISTS live_only_cursor TEXT NULL;`.
2. Down: `ALTER TABLE analysis.opportunity_compute_state DROP COLUMN IF EXISTS live_only_cursor;`.
3. Additive and nullable: no default, no backfill, no index. Existing rows read `NULL`, so the
   rotation starts at the head of the pool (D-1).

**Verification**:
```bash
ls services/xstockstrat-analysis/migrations/030_*.up.sql services/xstockstrat-analysis/migrations/030_*.down.sql
# read both: the .up ADD COLUMN live_only_cursor is reversed by the .down DROP COLUMN live_only_cursor
```

---

### Step 2 — service: repositories — cursor read/write, explicit `computed_at`, attributed-row read, transaction handle

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/repositories/opportunity_compute_state.py` — modify
- `services/xstockstrat-analysis/app/repositories/opportunities.py` — modify

**Reviewers**: xstockstrat-analysis owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `OpportunityComputeStateRepository.get` (`opportunity_compute_state.py:17-27`) selects only `computed_at, valid_until`. `upsert` (`:29-42`) does `INSERT ... VALUES ($1, now(), $2) ON CONFLICT (user_id) DO UPDATE SET computed_at = now(), valid_until = EXCLUDED.valid_until`.
- `OpportunitiesRepository.replace_for_user(self, user_id, rows)` (`opportunities.py:81-120`) does `async with self._db.acquire() as conn, conn.transaction():`, then `DELETE ... WHERE user_id = $1`, then an `executemany` INSERT of 13 columns with binds `$1..$13`. It binds no `computed_at` (docstring `:85-86`).
- `_to_dict` (`opportunities.py:64-73`) decodes `readiness_json` and `provenance` JSONB.
- `read()` already projects `o.computed_at` (`opportunities.py:236-238`).
- Ledger `fails.md` 2026-09-16 (feature 190): type-anchor every bind (`$n::type`), so a `None` cannot be indeterminate.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `get`: select `computed_at, valid_until, live_only_cursor`. Update the docstring.
2. Add `async def write_cursor(self, user_id: str, cursor: str, *, conn=None) -> None`. It runs on
   `conn` when one is given, otherwise on `self._db`:
   `INSERT INTO analysis.opportunity_compute_state (user_id, computed_at, valid_until, live_only_cursor) VALUES ($1, now(), to_timestamp(0), $2) ON CONFLICT (user_id) DO UPDATE SET live_only_cursor = EXCLUDED.live_only_cursor`.
   - The on-conflict branch touches only the cursor (D-13), so the feature-177 empty gate is never
     clobbered. The first-insert epoch is aware and skew-safe (R-6 rejected `'-infinity'`).
   - `upsert` stays unchanged. It never names `live_only_cursor`, so it cannot clobber it.
3. `replace_for_user(self, user_id, rows, *, conn=None)`:
   - With `conn` given, run the DELETE and the INSERT on it, inside the caller's transaction. Otherwise
     keep today's `acquire()` + `transaction()`. Factor the body into one private coroutine; do not
     duplicate it.
   - Add column `computed_at` to the INSERT, bound as `COALESCE($14::timestamptz, now())` with
     `r.get("computed_at")`. A fresh row passes `None` and gets `now()`. A carried row keeps its stored
     value (FR-8, D-4).
   - Update the docstring sentence "``computed_at`` defaults to ``now()`` per row".
4. Add `async def read_attributed_rows(self, user_id: str) -> list[dict]`:
   `SELECT opportunity_key, symbol, strategy_id, action, conviction, readiness_json, signal_axis, provenance, thesis, valid_until, computed_at, composite_score FROM analysis.opportunities WHERE user_id = $1 AND strategy_id <> ''`,
   mapped through `_to_dict`. It has no actions join and no validity filter. The compute applies the
   carry predicates in Python.
5. Add `transaction(self)`, an `@contextlib.asynccontextmanager` that does
   `async with self._db.acquire() as conn, conn.transaction(): yield conn` (Assumption 3).
6. No new pool and no new connection (F-06). No outbound gRPC, so header propagation does not apply.

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run pytest tests/test_opportunities_repo.py tests/test_opportunity_compute_state.py -q
uv run ruff check . && uv run ruff format --check .
grep -n "COALESCE(\$14::timestamptz, now())\|to_timestamp(0)\|live_only_cursor" app/repositories/opportunities.py app/repositories/opportunity_compute_state.py
```

---

### Step 3 — test: repository SQL, binds, decode, no-clobber and atomicity (unit + `real_pg`)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_opportunities_repo.py` — modify
- `services/xstockstrat-analysis/tests/test_opportunity_rotation_real_pg.py` — create

**Reviewers**: xstockstrat-analysis owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `_mock_pool()` (`tests/test_opportunities_repo.py:35-50`) and `_fetch_pool()` (`:27-32`). The replace-INSERT bind tests are at `:236-296`.
- Bound-param guard: `test_read_every_bound_param_is_referenced_in_every_sort_branch` (`:153-168`), using `re.search(rf"\${i}(?![0-9])", sql)`.
- `real_pg` harness: `local_pg` fixture (`tests/conftest.py:439`); the pool fixture pattern is in `tests/test_fundsignal_emitted_real_pg.py:16-28` (`CREATE SCHEMA IF NOT EXISTS analysis`, then executing migration files from `_MIGRATIONS`). The DDL to run is `011_opportunities`, `023_opportunity_compute_state`, `024_opportunity_composite_score`, `025_opportunity_symbol_score` and the new `030` (all `.up.sql`).
- CI installs PostgreSQL for the analysis `real_pg` tests (`.github/workflows/ci.yml:508-510`).

**TDD**: `red-green required`

**Covers**: `AC-5`

**Instructions**:
1. Unit tests (`_mock_pool`):
   - The replace INSERT names `computed_at` and contains `COALESCE($14::timestamptz, now())`. A row
     without `computed_at` binds `None` at index 13, and a row with one binds it.
   - The bound-param guard is extended to the new INSERT: every `$1..$14` appears.
   - With `conn=` passed, `replace_for_user` runs on that conn and never calls `pool.acquire`.
   - `read_attributed_rows` SQL filters `strategy_id <> ''` and projects `computed_at`.
2. `real_pg` (new module, `pytestmark = pytest.mark.real_pg`), with a pool fixture as in
   `test_fundsignal_emitted_real_pg.py:20-28` running the five migrations above:
   - **Decode + no-clobber (D-13).** `write_cursor` on an absent user, then `get` returns an aware
     `valid_until == datetime(1970,1,1,tzinfo=UTC)`, so `datetime.now(UTC) < state["valid_until"]`
     evaluates without a TypeError. `upsert(u, future)` then `write_cursor(u, "MSFT")`: `valid_until`
     is still `future` and the cursor is `"MSFT"`. `write_cursor` then `upsert`: the cursor survives
     the upsert.
   - **Mixed binds (O-21).** One `replace_for_user` `executemany` with a `None` and a datetime
     `computed_at`. The stored `computed_at` is `now()`-ish and the given value respectively.
   - **Atomicity (D-2, FR-5).** Inside `async with repo.transaction() as conn:` run
     `replace_for_user(..., conn=conn)` and `write_cursor(..., conn=conn)`, then raise. Afterwards
     both the previous rows and the previous cursor are unchanged.
   - **Restart (`@AC-5`, DB half).** After a committed transaction, a fresh repository on a new pool
     reads the same cursor.
3. C-13: the row literal is single-consumer per module, so it stays inline. Say so in the module
   docstring.

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run pytest tests/test_opportunities_repo.py -q
uv run pytest -m real_pg tests/test_opportunity_rotation_real_pg.py -q   # skips locally without a PG binary; runs in CI
uv run pytest --cov=app --cov-fail-under=40
uv run ruff check . && uv run ruff format --check .
grep -n "def .*fixture\|from .conftest\|conftest\|from tests\." tests/test_opportunity_rotation_real_pg.py   # C-13
```

---

### Step 4 — service: rotation chunk, carried rows, live-only stamp, shortfall log and atomic persist

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: xstockstrat-analysis owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence** (tree `dfa444c2`, recon.md Codebase Map re-confirmed this session):
- `async def _compute_opportunities(self, user_id: str, propagation_meta) -> list[dict]:` at `:5359`. Its only `return rows` is at `:5984`. `now_utc = datetime.now(UTC)` is at `:5382`.
- `denied_covered: list[tuple[str, str]] = []` at `:5415`. It is filled at `:5454-5455` (`for sym in resolved.denied & resolved.union: denied_covered.append(...)`).
- `_capped_live(sym, exclude=frozenset())` at `:5461-5465`. `_candidate` at `:5469`.
- Step 2b at `:5533-5552`: `_new_live_strats` (`:5535-5537`); `live_signal_symbols = (...) - held_norm` (`:5541`); `competitive_pool` (`:5542`); `max_live_only = int_positive(self._cfg, "opportunity.max_live_only_symbols_per_compute", 20)` (`:5543`); the conviction sort and `[:max_live_only]` (`:5544-5547`); the per-symbol loop (`:5548-5552`).
- Step 3 at `:5554-5560`: `targets = [k for k in candidates if k[0] == sym]` / `if not targets: _candidate(sym, ""); targets = [(sym, "")]`. The tie rule is `if sig.conviction > c["_best_sig_conv"]` starting from `-1.0` (`:5601-5603`).
- Muted rows at `:5619-5625`. The cut is at `:5629-5639`.
- Stamp at `:5955-5963`: `valid_until = session_end + timedelta(hours=window_hours)`, then `for r in rows: r["valid_until"] = valid_until`. The `symbol_score` fold is at `:5964-5983`.
- `_resolve_action_tag(candidate, exit_fires)` at `:6810-6832`. A non-held, non-watchlist candidate resolves through `_action_for(best_direction, False)` only, else `None`.
- `_replace_and_stamp_compute_state(self, user_id, rows, propagation_meta=None)` at `:4922-4940`. Callers: `_kick_opportunity_recompute._run` (`:4952-4953`) and `_opportunity_refresh_tick` (`:6070-6071`). The only production callers of `_compute_opportunities` are those two sites (grep `_compute_opportunities(` in `app`).
- `self._opportunity_compute_failures` init at `servicer.py:640`, the per-user in-memory precedent.
- Live-loop log precedent: `live_loop.py:467-486` (`-(-len(pairs) // n)`).

**Lands with**: `Step 5, Step 6`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Module-level pure helpers** (next to `_opportunity_key`, `:6803`). Each docstring is at most 2
   lines of constraint (CLAUDE.md "How to Act" #5).
   - `_is_live_only_row(provenance) -> bool`: `"live_strategy" in p` and none of `"watchlist"`,
     `"position"`, `"denied"` (D-6 predicate (a)).
   - `_rotation_chunk(pool: list[str], cursor: str | None, n: int) -> tuple[list[str], str | None]`.
     `pool` is sorted. An empty pool returns `([], cursor)`. Otherwise:
     `start = bisect_right(pool, cursor) if cursor is not None else 0`; `if start >= len(pool): start = 0`;
     `chunk = [pool[(start + i) % len(pool)] for i in range(min(n, len(pool)))]`; and the function
     returns `(chunk, chunk[-1])`. This is the `live_loop.py:459-510` algorithm (D-1).
   - `_carry_within_cycle(valid_until, computed_at, now, cycle_days) -> bool`:
     `valid_until > now and now - computed_at < timedelta(days=cycle_days)`. An age of exactly one cycle
     is dropped (`>=`, FR-8). The age clause matters only after `cycle_max_days` is lowered, and it must
     not be deleted (O-23).
2. **Config read.** Add `def _live_only_cycle_days(self) -> int: return int_positive(self._cfg, "opportunity.live_only_cycle_max_days", 3)`.
   It is the single read site, read once per compute (F-07, C-05). Step 7 reuses it.
3. **Step 2b** (replaces `:5543-5552`). Keep the `max_live_only` read: its meaning is now the chunk
   limit (R-1 is locked, so the limit wins).
   - `pool = sorted(competitive_pool)`.
   - When `pool` is non-empty (Assumption 4):
     - `state = await self._opportunity_compute_state_repo.get(user_id)` when the repo is not `None`.
       `cursor = (state or {}).get("live_only_cursor")`.
     - `chunk, new_cursor = _rotation_chunk(pool, cursor, max_live_only)`.
     - `self._log_live_only_shortfall(user_id, len(pool), max_live_only, cycle_days)` (item 6).
     - `stored = await self._opportunities_repo.read_attributed_rows(user_id)` when the repo is not
       `None`, else `[]`. Any exception from either read propagates and fails the compute (D-3).
   - Otherwise `chunk, new_cursor, stored = [], None, []`.
   - Iterate `chunk` with the existing `for strat in _new_live_strats(sym)` body.
4. **Carry selection** (before step 3, D-12). Do it all from data known before step 3.
   - `denied_covered_set = set(denied_covered)`, built once.
   - `best_direction_by_symbol`: for each non-chunk pool symbol, the direction of the max raw
     `sig.conviction` over `signals_by_symbol[sym]`, with step 3's strict `>` starting from `-1.0`
     (`:5601-5603`).
   - A stored row `r` is carried only when **all** of these hold:
     - (a) `_is_live_only_row(r["provenance"])`;
     - (b) `r["symbol"]` is in `pool` and not in `chunk`. Since `competitive_pool` excludes `held_norm`,
       (a) and (b) together guarantee the symbol is non-held, which predicate (c)'s deny equivalence
       relies on (D-15). State this in a constraint comment of at most 2 lines.
     - (c) `r["strategy_id"] in _capped_live(r["symbol"]) and (r["symbol"], r["strategy_id"]) not in denied_covered_set`
       (D-15, the FR-7 cap, R-2 locked);
     - (e) `_carry_within_cycle(r["valid_until"], r["computed_at"], now_utc, cycle_days)`;
     - (f), three-way (D-10). Let
       `expected = _resolve_action_tag({"is_held": False, "is_watchlist": False, "best_direction": best_direction_by_symbol[sym]}, False)`.
       If `expected is None`, drop the row. Else, if the provenance holds `"fundamentals_unavailable"` or
       `"formula_unreadable"`, keep it without comparing. Else keep it only when
       `int(expected) == r["action"]`.
   - `carried_symbols = {r["symbol"] for r in carried}`.
5. **Step 3.** Under `if not targets:`, `continue` for `sym in carried_symbols` (no `(sym, "")` row,
   D-4/D-12). Every other path stays the same.
6. **Shortfall** (D-5, FR-2a; operator O-6, O-12).
   - Add `self._live_only_shortfall_key: dict[str, tuple[int, int, int]] = {}` beside
     `_opportunity_compute_failures` (`:640`).
   - `_log_live_only_shortfall(user_id, pool_size, n, cycle_days)` computes
     `projected = -(-pool_size // n)` and `key = (projected, n, cycle_days)`. When the key differs from
     the stored one, it stores the key. When `projected > cycle_days`, it also logs at INFO, exactly:
     `log.info("opportunity live-only rotation shortfall: user=%s pool=%d per_compute=%d projected_computes=%d cycle_max_days=%d", user_id, pool_size, n, projected, cycle_days)`.
   - This is a log, not an error. It is labelled in computes (Assumptions 1-2).
7. **Stamp** (`:5961-5963`). `live_only_valid_until = now_utc + timedelta(days=cycle_days)`. Each fresh
   row gets `live_only_valid_until` when `_is_live_only_row(r["provenance"])`, else today's
   `valid_until` (D-7, operator O-5: no 168h cap).
8. **Append** (after the stamp, before the `owned_ids` fold). `fresh_keys = {r["opportunity_key"] for r in rows}`,
   then `rows.extend(r for r in carried if r["opportunity_key"] not in fresh_keys)`.
   - Fresh wins (D-6).
   - Carried rows keep their stored `computed_at`, `valid_until` and `composite_score`, and they join
     the `symbol_score` fold (D-4).
   - They are not traced and do not count against `max_universe_size`.
9. **Return** `rows, new_cursor`, and change the annotation to `tuple[list[dict], str | None]`.
10. **Persist.** Change the signature to `_replace_and_stamp_compute_state(self, user_id, rows, propagation_meta=None, cursor=None)`.
    - When `cursor is not None` and `self._opportunity_compute_state_repo is not None`:
      `async with self._opportunities_repo.transaction() as conn:`, then
      `await self._opportunities_repo.replace_for_user(user_id, rows, conn=conn)`, then
      `await self._opportunity_compute_state_repo.write_cursor(user_id, cursor, conn=conn)`.
    - Otherwise keep today's single `replace_for_user(user_id, rows)`.
    - The feature-177 empty stamp stays best-effort, outside and after the transaction, unchanged
      (operator 'Keep best-effort'). The accepted residual O-25: while that stamp keeps failing, each
      poll recomputes and each recompute advances the cursor.
    - Update the docstring, at most 2 lines of constraint.
11. **Callers** (`:4952-4953`, `:6070-6071`). Use `rows, cursor = await self._compute_opportunities(...)`,
    then `await self._replace_and_stamp_compute_state(<uid>, rows, <meta>, cursor=cursor)`.
12. **Clock.** Freshness uses the app clock (`now_utc`), the same trade-off as `:4799`. This is
    documented only. Header propagation: no new outbound gRPC call (two DB reads), so §B does not apply.

**Verification**: Step 5's combined unit gate (Steps 4+5+6).

---

### Step 5 — test: rotation behaviour (`@AC-1`..`@AC-12`), invariants, call-site and fake updates, config-read tables

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_opportunity_rotation.py` — create
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify
- `services/xstockstrat-analysis/tests/test_opportunities_fundamentals_guard.py` — modify
- `services/xstockstrat-analysis/tests/test_unreadable_formula.py` — modify
- `services/xstockstrat-analysis/tests/test_opportunity_compute_state.py` — modify
- `services/xstockstrat-analysis/tests/test_analysis_tick_telemetry.py` — modify
- `services/xstockstrat-analysis/tests/test_config_zero_clamps.py` — modify
- `services/xstockstrat-analysis/tests/test_config_read_classification.py` — modify

**Reviewers**: xstockstrat-analysis owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Harness (`tests/test_analysis_servicer.py`): `make_servicer` (`:44`), `_sig` (`:4482`), `_FakeOppRepo` (`:4499`, `replace_for_user` stores verbatim at `:4509`, `has_fresh` at `:4515`), `_wl` (`:4704`), `_strat_row(..., symbols=, created_at=, denied=, signal_eligible=)` (`:4715`), `_materialized_svc(..., live_strategies=)` (`:4776`, which seeds `list_live_enabled` at `:4835`), `_drain_opportunity_recompute` (`:4875`), and `_StampedComputeState` (`:5731`).
- Unpacking call sites of `_compute_opportunities` that bind its result (grep `_compute_opportunities(` in `tests`):
  - `test_analysis_servicer.py:5511, 5535, 5557, 5625, 7697, 8005, 8031`;
  - `test_opportunities_fundamentals_guard.py:217, 243, 255, 267, 286, 304, 314, 331, 346, 434, 458`;
  - `test_unreadable_formula.py:601, 635, 648, 653, 666`.
  - Sites that discard the result need no change: `test_analysis_servicer.py:5658, 5697`, `test_opportunities_latency.py:94`, `test_owner_header_guard.py:272`.
- Stubs returning the old shape: `test_opportunity_compute_state.py:52` (`AsyncMock(return_value=[])`), `:81` (`side_effect=[[], [{"symbol": "AAPL"}]]`), and `test_analysis_tick_telemetry.py:50` (`compute or AsyncMock(return_value=[])`). `test_opportunity_refresh.py:77` raises, so it needs no change.
- Config guards: `AC6_ROWS` (`tests/test_config_zero_clamps.py:32-67`, the row for `max_live_only` is at `:61`) and `FR3_KEYS` (`tests/test_config_read_classification.py:25-62`, the row at `:56`). The module docstring says "A new read must be classified here".

**Lands with**: `Step 4, Step 6`

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12`

**Instructions**:
1. **Repair the call sites** listed above: `rows, _ = await ...`, or `(await ...)[0]` inside `_find(...)`.
   Stubs return `([], None)`, and the side effect becomes `[([], None), ([{"symbol": "AAPL"}], None)]`.
2. **Fakes.**
   - `_FakeOppRepo.replace_for_user(self, user_id, rows, conn=None)` stores
     `{**r, "computed_at": r.get("computed_at") or datetime.now(UTC)}`, which mirrors the COALESCE.
   - Add `read_attributed_rows` (the stored rows with `strategy_id != ""`) and an async-CM
     `transaction()` that yields `None`.
   - Give `_StampedComputeState` a `write_cursor(user_id, cursor, *, conn=None)` that stores
     `live_only_cursor` in its row, and add the same to any other compute-state fake a failing test
     reaches (grep `def upsert(self, user_id` in `tests`). Add nothing speculatively.
3. **Config tables.** Add `("opportunity.live_only_cycle_max_days", "int", 3)` to `AC6_ROWS`, and
   `"opportunity.live_only_cycle_max_days"` to `FR3_KEYS` (stored zero reads as 3, the EXTEND of
   `@AC-6 @feature-244`).
   - **Real reader returns the seeded value** (config-wiring criterion (b)). In
     `tests/test_config_zero_clamps.py`, add a test parametrized over two stored values: the value
     parsed from `services/xstockstrat-config/migrations/056_analysis_live_only_cycle_max_days.up.sql`
     (repo-relative from `Path(__file__)`; the CI checkout is not sparse) and a stored `5`. Each case
     builds `AnalysisServicer(snapshot_watcher(**{"opportunity.live_only_cycle_max_days": value}), ...)`
     in the `test_ac6_servicer_init_semaphores_and_pool` construction shape (`:110-127`, including the
     `svc._compute.shutdown(wait=False)` teardown) and asserts `svc._live_only_cycle_days() == value`.
4. **New module `tests/test_opportunity_rotation.py`.** Reuse the harness above and import it, never
   copy it (C-13). The Background is a 45-symbol pool: watchlisted, bound only to
   `dip_buyer_vol_stop`, each with an active signal, and two live strategies covering every symbol.
   Each test is written RED first and names its `@AC`.
   - **Pure helpers.** `_rotation_chunk` covers empty, first chunk, resume, wrap
     (P=45, N=20: computes 1-3 end at `pool[19]`, `pool[39]`, `pool[14]`), and cursor-past-end.
     `_carry_within_cycle` is checked at exactly `computed_at = now - 3d` (dropped), at
     `now - 3d + 1µs` (kept), and at `valid_until == now` (dropped).
   - `@AC-1`: one compute gives exactly 20 symbols with rows for each live strategy.
   - `@AC-2` / `@AC-10`: three computes give all 45 symbols both live rows. No compute produces fresh
     live rows for more than 20 symbols. No shortfall line is logged (ceil(45/20)=3 is not > 3).
   - `@AC-3`: AAPL's first-compute row keeps `valid_until` and `computed_at` after a second compute in
     which AAPL is not in the chunk.
   - `@AC-4`: removing AAPL's signal drops its carried live rows and keeps `dip_buyer_vol_stop`.
   - `@AC-5`: a second `make_servicer()` sharing the same `_FakeOppRepo` and compute-state fake
     resumes after the stored cursor. NVDA's row keeps the first compute's `valid_until`.
   - `@AC-6`: ZM joins after compute 1 and has a row within 3 more computes.
   - `@AC-8`: 10 already-covered symbols lose their signals. After 3 more computes all 35 remaining
     symbols have rows and none of the 10 do.
   - `@AC-7`: held AAPL has `dip_buyer_vol_stop` and both live rows, exit-traced.
   - `@AC-9`: 25 held symbols, 7 live strategies each: exactly 20 get live rows, and none gets more
     than 5.
   - `@AC-11`: a 350-symbol pool gives at most 20 new live symbols, and the exact Step 4 INFO line
     appears once with `pool=350 per_compute=20 projected_computes=18 cycle_max_days=3`. A second
     identical compute logs nothing new.
   - `@AC-12`: a stored carried row with `computed_at = now - 4d` (cycle 3) is dropped. AAPL keeps
     `dip_buyer_vol_stop`.
   - **Lowered cycle (O-23).** A row stamped under cycle 5 (`valid_until` still in the future) with
     age 4 days is dropped once the cycle is 3.
   - **Invariant (O-10).** After every compute, every pool symbol has at least one row.
   - **Signal flip (f).** A buy→sell flip drops the carried row. An unchanged direction keeps it. A
     `formula_unreadable` / `fundamentals_unavailable` carried row with stored UNSPECIFIED is kept.
   - **Deny (D-15).** A carried `(AAPL, squeeze_breakout_trend)` whose strategy then denies AAPL
     leaves exactly one row for that `opportunity_key`, the muted placeholder. The `(AAPL, "")` row
     has parity with a never-carried denied non-chunk symbol.
   - **Held + denied + carried.** A held, denied symbol with a carried row drops the carried row. This
     pins predicate (b), not only (a).
   - **All-sell pool (O-20).** `rows == []` with a non-null cursor: the cursor advances, the empty
     stamp applies, and the stored `live_only_cursor` survives the upsert.
   - **Parity.** `best_direction_by_symbol` equals step 3's `best_direction` for tied raw convictions
     (first-seen wins, strict `>`).
   - **Fail closed (D-3; 356 @AC-5/@AC-10).** `read_attributed_rows` raising makes the kick recompute
     fail. The previous rows and the cursor are unchanged, and
     `analysis.opportunity.recompute{kind=full,outcome=failed}` counts it.
   - **Atomic persist.** `write_cursor` raising inside the transaction leaves the fake's rows
     unchanged. The fake transaction must re-raise.

**Verification** (the single gate for the Steps 4+5+6 unit; Steps 4 and 6 have no separate gate):
```bash
# analysis (Steps 4+5)
cd services/xstockstrat-analysis
uv run pytest tests/test_opportunity_rotation.py tests/test_analysis_servicer.py tests/test_opportunities_fundamentals_guard.py tests/test_unreadable_formula.py tests/test_opportunity_compute_state.py tests/test_analysis_tick_telemetry.py tests/test_config_zero_clamps.py tests/test_config_read_classification.py -q
uv run pytest --cov=app --cov-fail-under=40
uv run ruff check . && uv run ruff format --check .
grep -n "from tests\.\|from \.test_analysis_servicer\|conftest" tests/test_opportunity_rotation.py   # C-13: harness imported, not copied
grep -n "_live_only_cycle_days" tests/test_config_zero_clamps.py   # real-reader seeded-value test present
# config (Step 6)
cd ../xstockstrat-config && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40 && pnpm run lint
# whole-tree config wiring (Steps 4+6)
cd ../.. && node scripts/check-config-wiring.mjs --final && node scripts/check-config-wiring.mjs --doc-check
grep -n "live_only_cycle_max_days" services/xstockstrat-config/src/grpc/configServiceImpl.ts scripts/config-wiring-stored.json
```

---

### Step 6 — config: seed `opportunity.live_only_cycle_max_days` (config `056`) and its SetConfig bounds

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/056_analysis_live_only_cycle_max_days.up.sql` — create
- `services/xstockstrat-config/migrations/056_analysis_live_only_cycle_max_days.down.sql` — create
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify
- `services/xstockstrat-config/src/__tests__/liveOnlyCycleMaxDaysSeedMigration.test.ts` — create
- `scripts/config-wiring-stored.json` — modify (regenerated, never hand-edited)

**Reviewers**: xstockstrat-config owner — Config key naming, environment / global-per-user scoping, WatchConfig stream stability; xstockstrat-analysis owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias; DBA — Migration NNN numbering, up+down pair present

**Codebase Evidence**:
- Last config migration: `055_analysis_live_enrich_ttl_reseed`. `056` is free on every remote ref.
- Seed precedent (namespace-relative, insert-if-absent, sentinel actor): `migrations/054_marketdata_delisting_confirmation_days.up.sql`, an `INSERT INTO config.config_values (namespace, key, value_type, value_data, description, default_value, consuming_service, updated_by, environment, user_id) VALUES (...staging...), (...production...) ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;`. Its down deletes only the sentinel row still at the seeded value.
- Test precedent: `src/__tests__/delistingConfirmationSeedMigration.test.ts`, using `findOne` / `splitStatements` from `./migrationSql`.
- Bounds: `'analysis.opportunity.max_live_only_symbols_per_compute': { minValue: 1, maxValue: 500 },` at `src/grpc/configServiceImpl.ts:137` (`SCALAR_BOUNDS_REGISTRY`, full-dotted keys).
- Stored-set generator: `scripts/config-wiring-stored.py:1-5` (needs `DATABASE_URL`, `psql`, `migrate`). CI job `config-wiring-stored` (`.github/workflows/ci.yml:1320-1345`) uploads the regenerated file as an artifact. 330's spec Step Dependencies documents both routes, and that the JSON is never written by hand.
- Reader: Step 4 `_live_only_cycle_days`, `int_positive(self._cfg, "opportunity.live_only_cycle_max_days", 3)`.

**Lands with**: `Step 4, Step 5`

**TDD**: `N/A (config seed; its static shape test is written alongside and runs in the unit's Verification)`

**Covers**: —

**Instructions**:
1. Up: one INSERT in the 054 shape, under namespace `analysis` with key
   `opportunity.live_only_cycle_max_days`.
   - Columns: `int`, value `'3'`, default `'3'`, consuming service `xstockstrat-analysis`, actor
     `system:config-migration-feature-opportunity-live-only-rotation`.
   - One row each for `staging` and `production`, with `user_id NULL`, and
     `ON CONFLICT ... DO NOTHING`.
   - Description: "Live-only opportunity rotation (feature 366): a full rotation of the live-only pool
     should finish within this many days, and a carried live-only row older than this is dropped. Fresh
     live-only rows are stamped valid_until = computed_at + this many days. Bounds [1,30]. A value of 0
     or less reads as 3."
2. Down: one DELETE restricted by namespace, key, `environment IN ('staging','production')`,
   `user_id IS NULL`, the actor and `value_data = '3'`.
3. Add `'analysis.opportunity.live_only_cycle_max_days': { minValue: 1, maxValue: 30 },` directly after
   `:137`.
4. Test (mirrors `delistingConfirmationSeedMigration.test.ts`):
   - the up is one insert-if-absent INSERT;
   - exactly the two global int rows at `3`;
   - the stored key is namespace-relative;
   - `3` lies inside `{1,30}`;
   - the down deletes only the sentinel row.
5. Regenerate `scripts/config-wiring-stored.json` with `scripts/config-wiring-stored.py` (local Docker
   route, or the CI artifact fallback; record the run URL in `context.md`). If neither route works,
   the step is blocked (P-03).

**Verification**: Step 5's combined unit gate (Steps 4+5+6), which includes this step's config and
wiring commands.

---

### Step 7 — service: the surgical heal stamps live-only rows with the cycle window

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: xstockstrat-analysis owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `_retry_unavailable_symbols` heal: `window_hours = int_positive(self._cfg, "opportunity.valid_window_hours", 24)` (`:5023`). Heal rows carry `"provenance": provenance`, `"valid_until": None` and `"_healed": True` (`:5250-5260`). The window is applied post-loop: `healed_valid_until = session_end + timedelta(hours=window_hours)`, then `for hr in heal_rows: if hr.pop("_healed", False): hr["valid_until"] = healed_valid_until` (`:5312-5320`). It is persisted by `replace_symbols` (`:5323`, which re-stamps `computed_at = now()`, `opportunities.py:138-153`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Inside the `_healed` loop, a row with `_is_live_only_row(hr["provenance"])` gets
   `datetime.now(UTC) + timedelta(days=self._live_only_cycle_days())`. Read the cycle once before the
   loop. Other rows keep `healed_valid_until` (D-7).
2. The heal resets the FR-8 age through `replace_symbols`' `computed_at = now()`, with no change there
   (design §3). `replace_symbols` never writes the cursor.
3. No new outbound call.

**Verification**: Step 8's commands.

---

### Step 8 — test: heal stamp for live-only vs other rows

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_opportunity_rotation.py` — modify

**Reviewers**: xstockstrat-analysis owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Heal harness: `_unavailable_served_row(symbol, strategy, *, provenance, computed_at, valid_until=None)` (`tests/test_analysis_servicer.py:4665`), and the existing heal tests around `:5830`.

**TDD**: `red-green required`

**Covers**: — (regression guard for `185 @AC-8` and D-7; no 366 scenario is new here)

**Instructions**:
1. RED: a healed `["live_strategy", "unavailable"]` row gets `valid_until ≈ now + 3d`. A healed
   `["watchlist", "unavailable"]` row keeps `session_end + valid_window_hours`.
2. C-13: import `_unavailable_served_row`; add no second copy.

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run pytest tests/test_opportunity_rotation.py -q
uv run pytest --cov=app --cov-fail-under=40
uv run ruff check . && uv run ruff format --check .
```

---

### Step 9 — service: read-side split (branches (i)-(v)) and the `read_reissue` counter

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/app/telemetry.py` — modify

**Reviewers**: xstockstrat-analysis owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `_read_opportunity_queue` (`servicer.py:4758`):
  - the fresh read `opps.read(..., include_expired=False, sources=req_sources, action_filter=request.action_filter, sort=request.sort, symbol=req_symbol)` at `:4765-4774`;
  - the heal selection at `:4775-4789`;
  - the no-rows branch at `:4790-4819`, which after 365 is `elif not await opps.has_fresh(user_id):`;
  - `q.rows = rows` at `:4820`, and the facet using `q.served_include_expired` at `:4824-4828`.
- Kicks fire in the caller's `finally`, after the budgeted connection is released (`:4719-4725`, ANALYSIS-14).
- `_OPPORTUNITY_RECOMPUTE = Counter("analysis.opportunity.recompute", ...)` at `telemetry.py:444-446`, and helper `record_opportunity_recompute` at `:486-488`. `Counter.add` swallows errors (`:325-338`).

**Lands with**: `Step 10`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `telemetry.py`: add `_OPPORTUNITY_READ_REISSUE = Counter("analysis.opportunity.read_reissue", description="ListOpportunities re-reads after expired live-only rows")`
   beside `:444`, and `def record_opportunity_read_reissue() -> None: _OPPORTUNITY_READ_REISSUE.add(1)`.
   It is label-free (D-16, R-16).
2. In `_read_opportunity_queue`, replace the first read with the same call at `include_expired=True`
   (`all_rows`). Then `now = datetime.now(UTC)` and split in Python (D-11, D-14):
   - **(i)/(ii)** Any row with `valid_until <= now` and `not _is_live_only_row(provenance)`: set
     `q.kick_full = True` and `q.served_include_expired = True`, and serve `all_rows`. The read already
     has the matching WHERE, so there is no second read and no heal.
   - **(iii)** Some fresh row, and every row is fresh: serve `all_rows` and run the existing 185 @AC-8
     heal selection (`:4776-4789`) over them.
   - **(iv)** Some fresh row and some expired row (they can only be expired live-only rows): re-issue
     today's unchanged `include_expired=False` call, sequentially on the same `opps`, which is the
     budgeted connection. Serve its result, call `telemetry.record_opportunity_read_reissue()`, and run
     the heal over the served rows. Never set `kick_full` (R-14). This is the documented steady state.
   - **(v)** Otherwise (no row at all, or only expired live-only rows): fall through to 365's
     `elif not await opps.has_fresh(user_id):` body, unchanged.
   - Factor the heal selection into one local block reached from (iii) and (iv); do not duplicate it.
3. Keep `q.rows = rows` and the facet block unchanged. `served_include_expired` stays `False` on
   (iii)/(iv), which is correct because every served row is fresh.
4. Rows are never Python-filtered or re-sorted (R-11, R-12). There are no writes on the read path
   (R-13). The predicate-(e) lookahead is not adopted (operator 'Accept ~24h gap').
5. Comments: at most 2 lines each, constraint only (for example, "(iv) never kicks: every expiry kick
   would schedule another one a cycle later").

**Verification**: Step 10's commands.

---

### Step 10 — test: read branches, heal preservation, facet freshness, counter, and the `:7930` repair

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_opportunity_rotation.py` — modify
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify

**Reviewers**: xstockstrat-analysis owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `test_symbol_filter_normalized_into_both_reads` (`tests/test_analysis_servicer.py:7916-7931`): a single expired `["live_strategy"]` row, asserting `[c.kwargs["include_expired"] for c in calls] == [False, True]`. Under Step 9 this row is live-only, so the read takes branch (v), and 365's all-stale body then issues the second read: `[True, True]`.
- `read_path` fixture (`tests/conftest.py:367-415`): its pool mode asserts one connection and `assert_budgeted_read_order` with statements in `("fetch", "fetchval", "fetchrow")` (`:325-341`).
- Counter assertion helper: `metric_sum(reader, name, **attrs)` (`tests/test_live_loop_telemetry.py:35`); `metric_reader` (`tests/test_telemetry.py`). Usage precedent: `tests/test_analysis_tick_telemetry.py:176-185`.

**Lands with**: `Step 9`

**TDD**: `red-green required`

**Covers**: `AC-3` (a carried row stays served on fresh reads while valid)

**Instructions**:
1. Repair `:7930` to `[True, True]`. Keep the `symbol == "SCHD"` assertion, and update the docstring.
2. New tests (`@pytest.mark.usefixtures("read_path")`, so both paths run):
   - **(i)** an expired `["watchlist"]` row plus a fresh one: stale branch, a kick, an expired facet,
     one read call.
   - **(iii)** all fresh: one read, no kick, and the heal fires for an old `unavailable` row
     (185 @AC-8).
   - **(iv)** fresh plus an expired `["live_strategy"]` row: two reads (`[True, False]`), the expired
     row is not served, no kick, the heal still fires, and `analysis.opportunity.read_reissue` counts 1.
   - **(v)** only expired live-only rows, with no fresh row user-wide: 365's all-stale body (a kick and
     a stale serve). With a fresh row elsewhere for the user (a symbol-filtered read): no kick, an empty
     page.
   - `read_reissue` increments on (iv) only.
   - **Consumer surface (C-14).** A `ListOpportunities` call over a fresh row and a carried live-only
     row with distinct, unexpired `valid_until` values returns both opportunities, each with its own
     `valid_until` (`opp.valid_until.ToDatetime(tzinfo=UTC)`, the `:6462` assertion form).
   - Symbol grouping: in (iii), rows come back in the repository's order, never re-sorted
     (190 @AC-8/@AC-9).
3. C-13: reuse `_materialized_svc` / `_FakeOppRepo` / `_unavailable_served_row`; add no new domain
   literal homes.

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run pytest tests/test_opportunity_rotation.py tests/test_analysis_servicer.py tests/test_list_opportunities_deadlines.py tests/test_opportunity_compute_state.py tests/test_opportunities_repo.py tests/test_telemetry_allowlist.py -q
uv run pytest --cov=app --cov-fail-under=40
uv run ruff check . && uv run ruff format --check .
grep -n "record_opportunity_read_reissue" app/handlers/servicer.py app/telemetry.py
```

---

### Step 11 — docs: C-05 key docs, C-16 CHANGE rule text, observability, read branches and residuals

**Status**: `pending`
**Service**: `docs` (`services/xstockstrat-analysis/`, `docs/patterns/`)
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify
- `docs/patterns/config-governance.md` — modify
- `services/xstockstrat-analysis/docs/opportunities.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-analysis/CLAUDE.md`:
  - `:267` is the `valid_window_hours` row;
  - `:274` is the `max_live_only_symbols_per_compute` row ("Cap (feature 131) ... Ranked by max active-signal conviction descending ... AC-8");
  - `:293-296` is the feature-131 worst-case note;
  - `:324-329` is § Observability, with its instruments list at `:327`.
- `docs/patterns/config-governance.md`:
  - `:146-152` is the Per-Feature Registered Keys log ("Newest first"; the newest entry is feature 330 at `:152`);
  - `:538` is "Non-held live-covered symbol cap per compute. `get_int`." (the reader is `int_positive`);
  - `:542` is the `valid_window_hours` row.
- `services/xstockstrat-analysis/docs/opportunities.md:7` is the `ListOpportunities` freshness paragraph.
- `docs/patterns/database.md` does not list `opportunity_compute_state` columns (`grep -n opportunity_compute_state docs/patterns/database.md`: no hit), so it needs no change (O-22).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. `CLAUDE.md:274`: rewrite as the per-compute chunk limit of the live-only rotation (feature 366).
   - The chunk is the next N symbols of `sorted(competitive_pool)` after the persisted
     `live_only_cursor`.
   - Earlier-chunk rows are carried until their next turn, until they leave the pool, or until they
     age `>=` one cycle.
   - The row reads with `int_positive`.
   - The C-16 CHANGE of 131 @AC-8 is operator-signed (2026-11-26).
2. Add a row for `opportunity.live_only_cycle_max_days` (int, `3`, seeded by config `056`, bounds
   `[1,30]`).
3. In the `:267` row: live-only rows are instead stamped `computed_at + live_only_cycle_max_days` days
   (operator O-5, no 168h cap).
4. `:293-296`: add the carried-row bound
   `min(P - N, N × computes_per_cycle) × max_live_strategies_per_symbol` (O-14).
5. § Observability: list `analysis.opportunity.read_reissue` (label-free; counts branch (iv)
   re-reads). Add a load-bearing log entry with the exact Step 4 text
   `opportunity live-only rotation shortfall: user=%s pool=%d per_compute=%d projected_computes=%d cycle_max_days=%d`
   (INFO, only when (projected computes, N, cycle days) changes). This closes O-24.
6. `config-governance.md:538`: change to "Per-compute chunk limit of the live-only rotation (feature
   366). `int_positive`." Add a row for `analysis.opportunity.live_only_cycle_max_days` after `:542`.
   Add a newest-first entry `### feature 366 — opportunity-live-only-rotation (xstockstrat-config / xstockstrat-analysis)`
   above `:152`, with the key table row (namespace `analysis`, key `opportunity.live_only_cycle_max_days`,
   int, `3`, reader `app/handlers/servicer.py:_live_only_cycle_days`, bounds `[1,30]`, seeded `056`),
   following the 352 entry's wording.
7. `opportunities.md:7`:
   - read branches (i)-(v), with (iv) as the routine steady state (two reads, no kick, measured by
     `read_reissue`);
   - the cursor committed in the queue-replace transaction;
   - the accepted residuals: expired live-only rows hidden for about 24 h until their next chunk
     ('Accept ~24h gap'); after `cycle_max_days` is lowered, old-cycle rows stay visible on fresh reads
     until the next compute (`opportunities.py:233`); O-25 (a failing best-effort empty stamp makes
     each poll recompute and advance the cursor);
   - the FR-2a shortfall as the expected default at homelab scale (operator O-6).
8. Keep it docs-only, with no banned phrases (`node scripts/check-config-wiring.mjs --doc-check`).

**Verification**:
```bash
node scripts/check-config-wiring.mjs --doc-check
grep -n "live_only_cycle_max_days\|read_reissue\|live-only rotation shortfall" services/xstockstrat-analysis/CLAUDE.md docs/patterns/config-governance.md services/xstockstrat-analysis/docs/opportunities.md
grep -n "max_live_only_symbols_per_compute" docs/patterns/config-governance.md | grep -c "get_int\`"   # expect 0 on the :538 row
```

---

## Open Risks → step coverage

| Risk (design.md § Open Risks) | Addressed at |
|---|---|
| O-7 (308/330/365 diffs) | § O-7 gate above (verified); Precondition |
| O-24 (`read_reissue` and shortfall text in § Observability) | Step 4 (exact text), Step 11 |
| O-25 (best-effort stamp residual) | Step 4 item 10 (accepted), Step 11 |
| Branch (iv) two reads | Steps 9-10 (counter), Step 11 |
| About 24 h hidden expired live-only rows | Step 11 (accepted residual) |
| Predicate (c) relies on non-held (a)+(b) | Step 4 comment, Step 5 held+denied test |
| App clock vs DB `now()` | Step 4 item 12 (documented) |
| D-3 fail-closed blocks held/watchlist refresh | Step 5 fail-closed test |
| `best_direction_by_symbol` coupling | Step 5 parity test |
| Lowered cycle leaves old rows visible | Step 5 lowered-cycle test, Step 11 |
| 308 `evaluation_failed` carried row dropped (stored UNSPECIFIED, not in the O-9 keep-list) | Operator ruling pending before Step 4 executes or 308 merges (context.md Open Thread); otherwise an accepted residual recorded in Step 11 |

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
