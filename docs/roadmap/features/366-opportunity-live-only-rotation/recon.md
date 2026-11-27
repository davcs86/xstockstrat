# Recon: opportunity-live-only-rotation

**Created**: 2026-11-26
**From**: product-spec.md (spec-ready, round 2, 2026-11-26)
**Tree**: feature/opportunity-live-only-rotation@91634878 ≡ origin/feature/opportunity-live-only-rotation. origin/main-dev@34f68c57 is 1 commit ahead, with no diff under `services/xstockstrat-analysis` or `services/xstockstrat-config`.
**Affected services**: xstockstrat-analysis. Config seed and bounds go in xstockstrat-config. Consumer surfaces (C-14): xstockstrat-ui `/insights/opportunities` and `/trader/positions/[symbol]`, and the xstockstrat-agent tool `list_opportunities`. Neither consumer changes code unless design adds a per-row "as of" cue.

---

## Objective

Today step 2b of `_compute_opportunities` sorts and truncates the live-only pool. It keeps the top `opportunity.max_live_only_symbols_per_compute` (20) non-held, live-covered signal symbols by conviction, so every other symbol is shut out for as long as the ranking holds. Feature 366 changes this so that each compute evaluates the **next chunk** of the pool from a per-user cursor stored in Postgres. The cursor commits atomically with the queue replace. Rows from earlier chunks are carried forward, each with its own `computed_at`/`valid_until`, until the symbol's next turn, until it leaves the pool, or until the row is older than one full cycle. A full rotation is bounded by the new key `analysis.opportunity.live_only_cycle_max_days` (default 3, bounds [1,30]). When the bound cannot be met, the per-compute limit wins and the shortfall is recorded.

## Codebase Map

- **`xstockstrat-analysis`** (Python)
  - Compute entry: `_compute_opportunities(self, user_id, propagation_meta)` — `app/handlers/servicer.py:5359`.
  - Per-symbol live cap helper: `_capped_live(sym, exclude=frozenset())` — `servicer.py:5461` (reads `opportunity.max_live_strategies_per_symbol` at `:5459`). This is FR-7 and stays unchanged.
  - Candidate builder: `_candidate(sym, strat)` — `servicer.py:5469`.
  - Held path (FR-7, unchanged): `max_live_held` read at `servicer.py:5509`; ranked by held market value at `:5515-5518`.
  - **Change site — step 2b** at `servicer.py:5533-5552`:
    - `_new_live_strats` is at `:5535-5537`.
    - `live_signal_symbols = (signals_by_symbol.keys() & live_by_symbol.keys()) - held_norm` is at `:5541`. The `- held_norm` exclusion is load-bearing, per the comment at `:5539-5540`.
    - `competitive_pool` is at `:5542`.
    - `max_live_only = int_positive(self._cfg, "opportunity.max_live_only_symbols_per_compute", 20)` is at `:5543`.
    - The conviction sort and `[:max_live_only]` slice are at `:5544-5547`.
  - Step 3, signal collapse: `servicer.py:5554-5560`. A pool symbol **outside** the chunk still gets an unattributed `(sym, "")` candidate from its signal when it has no other candidate.
  - Universe cut: `max_universe_size` is read at `servicer.py:5629`. Curated candidates (watchlist/held/live) rank above the cut. `budget = max(0, max_universe - len(curated) - len(muted_only))` is at `:5638`, and `selected = curated + muted_only + speculative[:budget]` is at `:5639`.
  - Row build: `"opportunity_key": _opportunity_key(user_id, sym, strat)` is at `servicer.py:5933`. `_opportunity_key` is at `:6803`; it returns `user|symbol_norm|strategy_id`.
  - Uniform validity stamp: `valid_until = session_end + timedelta(hours=window_hours)` and `for r in rows: r["valid_until"] = valid_until` are at `servicer.py:5961-5963`. `window_hours` is read at `:5669` (`opportunity.valid_window_hours`, default 24). A carried row must bypass this stamp (FR-8).
  - Persist + stamp: `_replace_and_stamp_compute_state(self, user_id, rows, propagation_meta=None)` is at `servicer.py:4922-4940`. It calls `replace_for_user` and then, **only when `rows` is empty**, makes a separate, best-effort upsert to compute-state (`:4933-4940`). These are two writes in two transactions.
  - Recompute concurrency: the per-user lock `_opportunity_locks` is at `servicer.py:634` and `:4916-4920`. The stale-read kick `_kick_opportunity_recompute` is at `:4942`. The daily refresh is `_opportunity_refresh_tick(self, schedule: DurableSchedule)` at `:6045`.
  - Read path (`_read_opportunity_queue`):
    - The fresh read `opps.read(..., include_expired=False, ...)` is at `servicer.py:4765-4774`.
    - The surgical-heal candidate selection (185 FR-5) is at `:4776-4789`.
    - Cold/empty gate: `count_for_user`, then `state_repo.get` and `if not (state is not None and datetime.now(UTC) < state["valid_until"])`, at `:4791-4799`.
    - The all-stale branch serves `include_expired=True` at `:4807-4815`.
  - Compute-state repo attribute: `self._opportunity_compute_state_repo` — `servicer.py:621`.
  - Opportunities repo: `app/repositories/opportunities.py`.
    - `replace_for_user` is at `:81-120`. It runs one transaction: `DELETE ... WHERE user_id = $1` (`:88`), then an `executemany` INSERT of 13 columns (`:92-120`). The INSERT binds **no** `computed_at`, so `computed_at` defaults to `now()` (docstring at `:85`).
    - `replace_symbols` (the heal path) is at `:122+`. It is UPDATE-only and re-stamps `computed_at = now()`.
    - `read` uses `valid_clause = "" if include_expired else "AND o.valid_until > now()"` at `:233`.
    - `count_for_user` is at `:332`. `has_fresh` (`valid_until > now()`) is at `:340-345`.
    - The EXPIRY sort uses `MIN(o.valid_until) OVER (PARTITION BY o.symbol)` at `:53`.
  - Compute-state repo: `app/repositories/opportunity_compute_state.py:13-42`.
    - `get` selects only `computed_at, valid_until`.
    - `upsert(user_id, valid_until)` is `INSERT ... ON CONFLICT (user_id) DO UPDATE SET computed_at = now(), valid_until = EXCLUDED.valid_until`.
  - Tables:
    - `analysis.opportunity_compute_state` comes from `migrations/023_opportunity_compute_state.up.sql:8-13`: `user_id TEXT PK`, `computed_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `valid_until TIMESTAMPTZ NOT NULL`.
    - `analysis.opportunities.computed_at` (`TIMESTAMPTZ NOT NULL DEFAULT now()`) comes from `migrations/011_opportunities.up.sql:20`.
  - Last migration: `029_seed_fundamentals_blend_strategy.up.sql` (`services/xstockstrat-analysis/migrations/`). The same holds on origin/main-dev.
  - Config-read pattern: `int_positive(self._cfg, "<namespace-relative key>", <default>)`, for example at `servicer.py:5543`.
- **`xstockstrat-config`** (Node.js)
  - Bounds registry entry: `'analysis.opportunity.max_live_only_symbols_per_compute': { minValue: 1, maxValue: 500 }` at `src/grpc/configServiceImpl.ts:137` (`SCALAR_BOUNDS_REGISTRY`).
  - Seeds for the existing key are in `migrations/028_analysis_opportunity_keys.up.sql:75-78` (down at `028_...down.sql:20`). The description heal is at `041_heal_config_keys_to_reader_catalog.up.sql:83`, and it still says "Cap (feature 131…".
  - Last migration: `055_analysis_live_enrich_ttl_reseed.up.sql`. The same holds on origin/main-dev.

## Patterns to REUSE

- **Rotation cursor semantics** → reuse the identity-keyed resume cursor from `app/engine/live_loop.py:459-510`. It sorts to a total order (`records.sort(...)` at `:459`), then:
  - resumes with `start = bisect_right(pairs, self._cursor_key)` (`:464`);
  - wraps or clamps with `if start >= len(pairs): start = 0` (`:465-466`);
  - zero-guards an empty set and leaves the cursor untouched (`:456-458`, `:462-463`);
  - advances with `idx = (start + i) % len(pairs)` and `self._cursor_key = pairs[last_idx]` (`:494`, `:510`).

  Ledger `insights.md:1855-1858` (feature 132) makes this rule: "prefer deterministic total-order + identity-resume over index-modulo whenever the collection is rebuilt each cycle". The live_loop cursor lives **in memory** (`self._cursor_key`, `:300`), so 366 reuses the *algorithm* and persists the key, which is a normalized symbol (FR-5). An identity-keyed cursor holds FR-6 under churn: a symbol that joins is reached within one cycle, and no member is skipped when another leaves.
- **Overflow / shortfall diagnostic** → follow the live_loop overflow log at `live_loop.py:467-486`. It logs the pool size, the window, wrapping, and the projected cycles `-(-len(pairs) // n)`, warns once per budget, and adds to `_TRUNCATION_COUNTER`. Compute it from the **full pool** before chunking (ledger `fails.md:661-663`).
- **Stateless rotating offset** (`fundsignal_loop.py:424`, `datetime.now(UTC).toordinal() % len(deduped)`) → **do not reuse** for 366. It has no stable index→item identity, so it fails FR-6 under churn, and it gives one offset per day. Ledger `insights.md:1856` names it as the anti-pattern.
- **Config key read** → `int_positive(self._cfg, "opportunity.live_only_cycle_max_days", 3)`, the same form as `servicer.py:5543`, read once per compute.
- **Config seed + bounds**:
  - Seed in a new config migration. Precedents: `028_analysis_opportunity_keys.up.sql:75-78` and `055_analysis_live_enrich_ttl_reseed.up.sql`.
  - Add the bounds entry `{ minValue: 1, maxValue: 30 }` next to `configServiceImpl.ts:137`.
- **Compute-state persistence** → extend `OpportunityComputeStateRepository` (`opportunity_compute_state.py`) and the single write helper `_replace_and_stamp_compute_state` (`servicer.py:4922`). Do not add a parallel helper. Ledger `fails.md:2282-2284` (feature 177) says to "stamp it on EVERY write path … centralize in one helper".
- **Whole-user authoritative replace** → keep `replace_for_user`'s DELETE+INSERT transaction (`opportunities.py:87-120`). Carried rows are re-INSERTed inside it, with their `computed_at`/`valid_until` bound explicitly. Today's INSERT omits `computed_at`.
- **Tests**:
  - The fake opportunities repo `replace_for_user(self, user_id, rows)` at `tests/test_analysis_servicer.py:4501-4509`, with fakes at `:5581` and `_StampedComputeState` at `:5778`, runs a compute end-to-end without a DB.
  - The compute-state mocks are at `tests/test_opportunity_compute_state.py:50-138`.
  - The repo SQL-binding tests are at `tests/test_opportunities_repo.py:236+`.
  - The real-PG harness is `tests/test_read_budget_real_pg.py` (`pytestmark = pytest.mark.real_pg` at `:20`, the `local_pg` fixture at `:51`). Use it for restart-survival and atomicity (AC-5).
  - Run with `uv run pytest` and `uv run pytest -m real_pg`.
  - The stored-zero tables `tests/test_config_zero_clamps.py:61` and `tests/test_config_read_classification.py:56` need a row for the new key.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-5 @FR-4 @regression @feature-356` "A failed held drain fails the opportunity recompute and keeps the previous queue" (`services/xstockstrat-analysis/acceptance/fix-analysis-held-position-drains.feature`) — a failed compute never replaces the queue. The rotation cursor and carried rows may change only in the same transaction as a successful replace.
- **PRESERVE** `@AC-10 @FR-4 @regression @feature-356` "A failed daily-refresh user is counted and keeps the previous queue" (`services/xstockstrat-analysis/acceptance/fix-analysis-held-position-drains.feature`) — a failed user's queue and rotation state stay untouched, and the refresh schedule still advances.
- **PRESERVE** `@AC-1 @FR-1 @feature-185` "A data-unavailable symbol is marked unavailable, not evaluated-0/0" (`services/xstockstrat-analysis/acceptance/opportunity-compute-robustness.feature`) — evaluated rows and carried rows both keep the terminal sentinel. Feature 289 later amended this to `formula_unreadable` for formula refusals.
- **PRESERVE** `@AC-5 @FR-1 @feature-185` "The sentinel survives the materialization round-trip" (`services/xstockstrat-analysis/acceptance/opportunity-compute-robustness.feature`) — the carry/merge in `replace_for_user` must not drop sentinel or marker fields.
- **PRESERVE** `@AC-8 @FR-5 @feature-185` "A data-unavailable row self-heals via a surgical read-time recompute" (`services/xstockstrat-analysis/acceptance/opportunity-compute-robustness.feature`) — the heal (`replace_symbols`) re-stamps `computed_at`. Design must reconcile this with FR-8, which says carried rows keep their own `computed_at`.
- **PRESERVE** `@AC-6 @FR-4 @feature-185` "A cold read is non-blocking and distinguishable from an empty universe" and `@AC-7 @FR-4 @feature-185` "A persistently-failing cold compute renders a terminal error, not an infinite spinner" (`services/xstockstrat-analysis/acceptance/opportunity-compute-robustness.feature`) — cold and failed compute states stay distinguishable. Rotation must not make a partial first-chunk queue look complete, and the cursor write must not make the empty-universe gate fire for a non-empty user (see Risks R-3).
- **PRESERVE** `@AC-21 @FR-1 @FR-2 @regression @feature-289` "The marker round-trips storage and a sibling's outage does not flip the row" (`services/xstockstrat-analysis/acceptance/opportunity-compute-robustness.feature`) — carried rows keep the unreadable-formula marker.
- **PRESERVE** `@AC-1 @regression @feature-193` "the queue attributes the blend only inside the fundamentals universe" (`services/xstockstrat-analysis/acceptance/fix-blend-queue-fundamentals-universe.feature`) — the live-only pool for `fundamentals_macd_blend` stays inside the fundamentals universe. A chunk or a carried row must not attribute the blend outside it.
- **PRESERVE** `@AC-2 @regression @feature-193` "signal_eligible is inert for the blend on the queue" (`services/xstockstrat-analysis/acceptance/fix-blend-queue-fundamentals-universe.feature`) — rotation must not give the blend the cross-user signal pool.
- **PRESERVE** `@AC-8 @FR-4 @feature-190` "Expiry sort orders by soonest valid_until while keeping symbol grouping" and `@AC-9 @FR-4 @feature-190` "A symbol's rows stay contiguous under expiry sort" (`services/xstockstrat-analysis/acceptance/opportunities-server-side-filters.feature`) — mixed per-row `valid_until` (FR-8) must not break the sort or the grouping. `MIN(o.valid_until) OVER (PARTITION BY o.symbol)` at `opportunities.py:53` already groups by symbol.
- **PRESERVE** `@AC-13 @FR-6 @feature-190` "Pagination traverses the filtered, sorted result" (`services/xstockstrat-analysis/acceptance/opportunities-server-side-filters.feature`) — carried rows paginate like any other row.
- **PRESERVE** `@AC-7 @FR-6 @feature-199` "The composite is deterministic across recomputation within one pass" (`services/xstockstrat-analysis/acceptance/opportunity-composite-score.feature`) — carried rows keep their stored composite.
- **PRESERVE** `@AC-10 @FR-5 @feature-200` "The symbol score is deterministic for a fixed input set" (`services/xstockstrat-analysis/acceptance/symbol-opportunity-ranking.feature`) — a mix of carried and fresh rows must fold deterministically. `symbol_score` is stamped symbol-uniform over the symbol's rows after `:5963`, so design must decide whether a carried row's `symbol_score` is re-folded.
- **PRESERVE** `@AC-6 @FR-3 @regression @feature-244` stored-zero outline, row `analysis.opportunity.max_live_only_symbols_per_compute` → 20 (`docs/sdd/business-rules/platform.feature`) — a stored 0 still reads as 20. The key's meaning changes from cap to chunk limit, but its default and bounds stay the same. The row text "live-only symbol cap per compute" is superseded wording.
- **EXTEND** `@AC-6 @FR-3 @regression @feature-244` stored-zero outline (`docs/sdd/business-rules/platform.feature`) — add an equivalent row for the new `analysis.opportunity.live_only_cycle_max_days` (stored 0 → 3).
- **PRESERVE** `@AC-5 @FR-5 @feature-306` "The gate has no form-mismatch kind" (`docs/sdd/business-rules/platform.feature`) — the new key is read namespace-relative and seeded by a config migration. Otherwise the config-wiring gate reports `prefixed-read`.
- **CHANGE (operator-signed 2026-11-26, context.md)** — 366 reverses feature 131's rejection of cross-pass carried state (`docs/roadmap/features/131-live-strategy-opportunity-attribution/context.md:12`) and 131's AC-8 truncation rule. 131's scenarios were archived **without** promotion, so no durable `@AC` is broken. The rule text lives in `services/xstockstrat-analysis/CLAUDE.md:274` and `docs/patterns/config-governance.md:538`, and 366 updates both. On `:538`, `get_int` must also become `int_positive`. The reader is `int_positive` (`servicer.py:5543`). Design must restate the CHANGE and keep 131's per-compute bound (131 `context.md:23`).
- **No promoted guard** exists for `max_live_held_symbols_per_compute` or `max_live_strategies_per_symbol` beyond the stored-zero rows. The 366 FR-7 / @AC-9 scenarios will be the first behavioural pin.
- Not read in full: `config-keys-relative-consumers.feature` (304) and `fix-config-keys-drift.feature` (295). Their rules stand behind the platform `@AC-5 @feature-306` row.

## Dependencies

- Proto/RPC: none. The per-row `Opportunity.valid_until` already exists and is shown as "expires" (`xstockstrat-ui src/app/insights/opportunities/page.tsx:86,537`, cited by the product spec). An explicit per-row `computed_at` "as of" cue would be a proto addition and a UI change. That is a design decision, recommended out of scope.
- Migration:
  - Analysis: the next free number is **`030`**, for `ALTER TABLE analysis.opportunity_compute_state ADD COLUMN <cursor> TEXT NULL`. The down migration drops the column.
  - Config: the next free number is **`056`**, to seed `opportunity.live_only_cycle_max_days`.
  - Re-derive both numbers from the merged tree at `/sdd-spec`. Peers 308 and 330 are `in-progress`. 330's `055` is already on this tree, and 308's branch adds no migration today.
- Config keys:
  - `analysis.opportunity.live_only_cycle_max_days`: new, int, default 3, bounds [1,30], stored key `opportunity.live_only_cycle_max_days`.
  - `analysis.opportunity.max_live_only_symbols_per_compute`: existing. The meaning becomes "chunk limit", and its descriptions change in `CLAUDE.md:274`, `config-governance.md:538` and optionally the description seed in a config migration (041:83 text). Do not edit applied 041 (F-01).
  - Context keys that bear on the design: `opportunity.valid_window_hours` (24, [1,168]) sets each row's `valid_until` window, and `opportunity.refresh_hour_utc` sets the daily refresh anchor.
- Inter-service edges: none new.
- New env vars / ports: none.

## Risks / Not-found

- **R-1. A carried row's own `valid_until` (24 h default) is shorter than the FR-8 age limit (3 days).**
  - The fresh read filters `o.valid_until > now()` (`opportunities.py:233`, called with `include_expired=False` at `servicer.py:4765-4774`).
  - A carried row that keeps its producing compute's `valid_until` (`session_end + valid_window_hours`, `servicer.py:5961`) therefore disappears from the normal fresh read after about 24 h. It shows again only on the all-stale branch.
  - So FR-3's "stays in the queue" and FR-8's "dropped after one cycle" conflict at the defaults. Design must pick one:
    - (a) keep the row's `valid_until` and accept that it is invisible on fresh reads after the window;
    - (b) make the cycle the effective validity of carried rows;
    - (c) bound `live_only_cycle_max_days × 24 ≤ valid_window_hours`;
    - (d) something else.
  - Whichever is chosen, design must pin the FR-8 `>` vs `>=` boundary. This is the single biggest open item.
- **R-2. Coverage arithmetic.** At P≈350 and N=20 a full cycle needs ceil(350/20)=18 chunks. Daily refresh plus stale-read kicks give about one compute a day, plus extra computes when rows go stale. A 3-day bound cannot be met at N=20 unless design adds rotation passes, which FR-2 allows: extra passes, rotating on stale-read recomputes, or chunk sizing. Otherwise FR-2a's shortfall applies. Design must say which mechanism holds the bound, or state that FR-2a is the normal state at homelab scale.
- **R-3. The compute-state table doubles as the empty-universe freshness gate.**
  - The gate `if not (state is not None and datetime.now(UTC) < state["valid_until"])` (`servicer.py:4798-4799`) is consulted only when `count_for_user == 0`.
  - `valid_until` is `NOT NULL` (023), so a cursor write for a non-empty compute must either keep the existing `valid_until` (`ON CONFLICT` updates the cursor only) or INSERT a value that cannot later suppress a cold/empty recompute (@AC-6/@AC-7 @feature-185).
  - Today's `upsert` always overwrites `computed_at`/`valid_until`.
  - Design may instead prefer a separate table. The operator's preferred shape is "cursor column on 023", and design should confirm or reject it.
- **R-4. Atomicity (FR-5).** `_replace_and_stamp_compute_state` does `replace_for_user` and then a separate best-effort stamp, in two transactions (`servicer.py:4932-4940`). The cursor must commit in the **same** transaction as the replace, so either `replace_for_user` takes the cursor or both writes share one connection and transaction. A failed compute (356 @AC-5/@AC-10) must leave the queue, the carried rows and the cursor all unchanged.
- **R-5. 308 R-4 hard constraint.** 308 is in-progress: `docs/roadmap/features/308-fix-analysis-per-symbol-isolation/debate.md:42` on `origin/feature/fix-analysis-per-symbol-isolation` says R-4 is locked, "replace_for_user deletes held/watchlist/muted rows". The carried-row merge must never drop held, watchlist or muted rows on a failure path. 366 rebases after 308. 330 (in-progress) touches the same function, in its bars request.
- **R-6. Heal vs FR-8.** `replace_symbols` (`opportunities.py:122+`) re-stamps `computed_at = now()` and sets `valid_until`. Design must decide whether a healed carried row counts as re-evaluated, which resets its FR-8 age, or keeps its original age.
- **R-7. Interaction with the step-3 signal collapse.** A pool symbol outside the chunk still gets a fresh `(sym, "")` signal candidate (`servicer.py:5554-5560`). When a carried `(sym, strat)` row exists, the collapse should not also create a `(sym, "")` row for the same symbol, and today's collapse logic does not know about carried rows. Design must define how carried rows enter the candidate set: as candidates, or merged at persistence only. If they enter as curated candidates, they also count against the `max_universe_size` speculative budget (`servicer.py:5638`).
- **R-8. Rotation order.** Use a stable total order, normalized symbol with identity-resume. Re-sorting by conviction each pass starves or repeats symbols under FR-6. The current pool is a set-derived list with no stable order (`servicer.py:5541-5542`).
- **R-9. Shortfall diagnostic.** There is no metric or log on this path today. The only analysis opportunity metric is `analysis.opportunity.recompute{kind,outcome}`. Compute the diagnostic from the full pool before chunking (`fails.md:661-663`).
- **Ledger trap resolved.**
  - `insights.md:544-545` (2026-08-03) said live_loop "truncates rather than round-robins". Feature 132 then added the bisect cursor (`insights.md:1856`; `live_loop.py:23,298-300,464-510`), so live_loop **does** rotate now, in memory.
  - `services/xstockstrat-analysis/docs/opportunities.md` has no rotation, fair-share or round-robin text (grep found none), so the contradiction the product spec cited is not present in that file today.
  - The live_loop algorithm can be reused. Its scheduler cannot, because it evaluates (strategy, symbol) pairs on its own loop, not the per-user queue compute.
- **Test gap.** No behavioural test pins the current live-only cap. The rotation needs its own RED tests (P-06).
- **Not read**:
  - the 308/330 in-flight diffs to `_compute_opportunities` in detail;
  - the `xstockstrat-ui` and `xstockstrat-agent` acceptance suites for `/insights/opportunities` and `list_opportunities`. Read them only if design adds an "as of" cue;
  - how `symbol_score` is folded after `:5963` (not read past the stamp).
- **Path note.** The workflow task named the feature dir `docs/roadmap/features/docs/roadmap/features/366-opportunity-live-only-rotation/`. That path does not exist. This file was written to the real dir `docs/roadmap/features/366-opportunity-live-only-rotation/`.

## Recommended Scope

Advisory. These are inputs to the debate and to `/sdd-spec`, not binding.

1. **Analysis migration `030` (DBA):** add a nullable cursor column to `analysis.opportunity_compute_state`, with up and down migrations. Alternatively use a separate table if design rejects co-locating the cursor with the empty-gate (R-3).
2. **Config migration `056` + bounds:** seed `opportunity.live_only_cycle_max_days` = 3 and add `{1,30}` to `SCALAR_BOUNDS_REGISTRY`. Paired TS test.
3. **Repo:**
   - `replace_for_user` accepts the cursor and carried rows, writing an explicit `computed_at`/`valid_until` for carried rows, all in one transaction.
   - The compute-state repo exposes a cursor read that leaves `valid_until` unaffected.
   - Paired repo tests and a `real_pg` atomicity / restart test.
4. **Servicer step 2b:**
   - stable-order pool and identity-resume chunk;
   - carried-row selection: drop on leaving the pool, on re-evaluation, or past the age limit, with the boundary pinned;
   - the shortfall log/metric taken from the full pool;
   - cursor written through `_replace_and_stamp_compute_state`;
   - failure paths keep everything (356, 308 R-4).
   - Paired tests cover AC-1..AC-12.
5. **Docs (C-05):**
   - `services/xstockstrat-analysis/CLAUDE.md:274` (and the `:295` worst-case note);
   - `docs/patterns/config-governance.md:538` (cap → chunk limit; `get_int` → `int_positive`), plus a new row for the new key;
   - the `platform.feature` stored-zero row at promotion.
6. **Sequencing:** rebase after 308 lands. Re-derive the migration numbers at `/sdd-spec`.
