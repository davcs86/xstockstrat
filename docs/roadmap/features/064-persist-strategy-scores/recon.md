# Recon: persist-strategy-scores

**Created**: 2026-07-03
**Feature dir**: `docs/roadmap/features/064-persist-strategy-scores/`

---

## Objective

Persist strategy scores (`overall_score`, `rating`, `component_scores`) produced by `ScoreStrategy`
to a DB-backed table so `ListStrategies` / `GetStrategyReport` survive an analysis-service restart,
replacing the volatile in-memory `self._strategies` dict. Storage-only change behind unchanged RPCs;
single service (`xstockstrat-analysis`).

## Codebase Map — `xstockstrat-analysis`

| Concern | Location |
|---|---|
| In-memory score dict declared | `app/handlers/servicer.py:86` (`self._strategies: dict[str, StrategyScore] = {}`) |
| Score written (ScoreStrategy) | `app/handlers/servicer.py:708` |
| `StrategyScore` proto built | `app/handlers/servicer.py:698-707` (`overall_score`, `rating`, `component_scores`) |
| Score read (ListStrategies) | `app/handlers/servicer.py:733` (`list(self._strategies.values())`) |
| Score read (GetStrategyReport) | `app/handlers/servicer.py:737` (`self._strategies.get(...)`) |
| Best-effort ledger write (FR-7 template) | `app/handlers/servicer.py:717-728` (try/except → `log.warning`) |
| Existing definitions repo (mirror target) | `app/repositories/strategies.py:27` (`StrategiesRepository`, ctor `__init__(self, db_pool)` :30) |
| Repo methods | `create`:34, `get_by_id`:47, `update`:54, `set_live_enabled`:70, `deactivate`:83, `list`:95; `_to_dict`:14 |
| Repo injected into servicer | `app/handlers/servicer.py:87` (`StrategiesRepository(db_pool) if db_pool else None`) |
| Servicer `__init__` signature | `app/handlers/servicer.py:61-71` (`db_pool=None` kwarg) |
| Pool created at boot | `app/main.py:45-49` (`asyncpg.create_pool(..., max_size=int(os.environ.get("DB_POOL_MAX","2")))`) |
| Servicer constructed + post-construct wiring | `app/main.py:52-61`; loop block `if db_pool is not None:` :84 (live loop 88-98, fundsignal 101-115); `wait_for_termination` :117 |
| Row→proto helper | `app/handlers/servicer.py:940` (`_row_to_strategy_definition`) |
| Migrations dir (highest = 004) | `services/xstockstrat-analysis/migrations/001–004`; next = `005_` |
| DDL style reference | `migrations/001_strategies.up.sql:1-10` (+ composite-PK precedent in 003/004) |
| Proto message | `packages/proto/analysis/v1/analysis.proto:86-91` (`component_scores` = `map<string,double>`) |
| Servicer tests | `tests/test_analysis_servicer.py` (`make_servicer()`:22 builds with **no** db_pool; ScoreStrategy asserted via `svc._strategies`) |
| Reusable AsyncMock pool pattern | `tests/test_fundsignal_loop.py:44-56` (`db_pool=AsyncMock()`, per-method `execute/fetch/fetchrow`) |
| Mocked-repo test pattern | `tests/test_analysis_servicer.py:446-575` (`svc._strategies_repo = AsyncMock()`, `_row_for(...)`:410) |

## Patterns to REUSE (anti-duplication core)

- **`StrategiesRepository` shape** (`app/repositories/strategies.py:27`) — new `StrategyScoresRepository`
  should mirror it exactly: same ctor (`__init__(self, db_pool)`), same asyncpg
  `fetchrow`/`fetch`/`fetchval` style, same `json.dumps(...)::jsonb` binding for the component-scores
  map, same `_to_dict` JSONB decode. **Do not** invent a new DB access style.
- **Repo injection idiom** (`servicer.py:87`) — `self._scores_repo = StrategyScoresRepository(db_pool) if db_pool else None`; guard every DB call on `is not None` so the no-DB test path (`make_servicer()`) still works.
- **Best-effort write** (`servicer.py:717-728`) — wrap the score-persist write in the same
  `try/except Exception → log.warning` so FR-7 holds (scoring never fails on a DB error).
- **Post-construct wiring block** (`main.py:84`, `if db_pool is not None:`) — the established site to
  add a one-time async hydrate step; mirrors `servicer._fundsignal_loop = fundsignal_loop` attach idiom.
- **AsyncMock pool test** (`test_fundsignal_loop.py:44-56`) — reuse for a scores-repo/servicer DB test
  without a real Postgres.

## Dependencies

- **Proto/RPC**: none. `StrategyScore`/`ListStrategiesResponse`/`StrategyReport` already carry every
  persisted field (`analysis.proto:86-91`). No `buf` gate triggered (C-09 N/A).
- **Migration chain**: analysis `001–004` applied; new table is `005_strategy_scores` (C-07).
- **Config keys**: none new. Existing `analysis.scoring.*` weights unchanged (C-05 respected).
- **Env vars**: none new. Reuses `DATABASE_URL` + `DB_POOL_MAX` already wired (`main.py:45-49`).
- **Connection pool**: reuses the single existing pool — analysis stays at max 2, total ≤ 20 (F-06).

## Risks / Not-found

- **No `analysis.strategy_scores` table/migration/repo exists** — all net-new.
- **No `ON CONFLICT`/upsert precedent** in `strategies.py` — the upsert (FR-2) is a new-to-this-service
  SQL pattern; keep it standard (`INSERT ... ON CONFLICT (strategy_id) DO UPDATE`).
- **No existing startup hydrate hook / `async init()`** on the servicer — a hydrate-at-boot approach
  would be net-new code at the `main.py:84` block. (Relevant to Open Question #1.)
- **No `CREATE SCHEMA analysis`** in this service's migrations — schema is assumed pre-existing; the new
  migration follows suit (`CREATE TABLE ... analysis.strategy_scores`, no schema create).
- **No dedicated `StrategiesRepository` unit-test file** — repo is exercised only via mocked servicer;
  a new scores test follows the existing mocked-repo / AsyncMock-pool pattern.
- **Ledger traps**: `fails.md` empty. `phase3-deviations.md` records the in-memory storage as a
  deliberate Phase 3 choice — this feature intentionally reverses it for scores only (not for other
  in-memory analysis state such as `self._backtests` or screener results).

## Open Questions to resolve in grilling

1. **DB-direct reads vs. hydrate-at-boot.** Read the DB on each `ListStrategies`/`GetStrategyReport`
   call (source of truth, no cache coherence), or hydrate `self._strategies` once at startup and keep
   write-through? Recon: no hydrate hook exists today; DB-direct avoids new startup machinery.
2. **FK to `analysis.strategies` vs. loose key.** `strategy_scores.strategy_id` FK (+ `ON DELETE
   CASCADE`) or a plain keyed column? Strategies are only soft-deactivated, never hard-deleted.
3. **Score retention on deactivation.** Keep the score row when a strategy is deactivated, or purge it?

## Recommended Scope (advisory step boundaries)

1. Migration `005_strategy_scores.up.sql` / `.down.sql` (+ DBA review).
2. `StrategyScoresRepository` (upsert + get + list) mirroring `strategies.py` (+ unit test).
3. Wire repo into servicer: persist in `ScoreStrategy` (best-effort); serve reads from DB in
   `ListStrategies` / `GetStrategyReport` (+ servicer tests).
4. Docs: analysis `CLAUDE.md` (new table + ledger note unchanged), root CLAUDE.md DB schema map if it
   enumerates tables.
