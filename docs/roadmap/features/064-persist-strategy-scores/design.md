# Design: persist-strategy-scores

**Created**: 2026-07-03
**Rounds**: 1 (quick; termination: approved — correctness objection resolved by upgrading the read model)
**Approved by**: user @ 2026-07-03 (delegated; interactive gate unavailable, proceeded on the recommended outcome)
**Grounded in**: recon.md

---

## Chosen Approach

**Write-through in-memory serving layer with DB durability + hydrate-at-boot.** The DB is the
durability backup; `self._strategies` (recon.md:server `servicer.py:86`) stays the read path. This
was chosen over the proposer's original *DB-direct reads*, which the adversary showed creates a
false-success contract (best-effort write swallowed by FR-7 → a following DB-direct read returns
`NOT_FOUND` for a score the client was just told succeeded).

**1. Migration `005_strategy_scores`** (recon.md:migrations, next NNN = 005; DDL style from
`migrations/001_strategies.up.sql:1-10`):

```sql
-- 005_strategy_scores.up.sql
CREATE TABLE IF NOT EXISTS analysis.strategy_scores (
    strategy_id      TEXT PRIMARY KEY,                       -- loose key, no FK (ad-hoc scores allowed)
    overall_score    DOUBLE PRECISION NOT NULL,
    rating           TEXT NOT NULL,
    component_scores JSONB NOT NULL DEFAULT '{}'::jsonb,     -- map<string,double>: sharpe/drawdown/win_rate
    created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
-- down: DROP TABLE IF EXISTS analysis.strategy_scores;
```

No `CREATE SCHEMA analysis` (schema pre-exists — recon.md:Not-found). `created_at`/`updated_at` follow
the `analysis.strategies` convention rather than the proposer's `scored_at` (which the adversary
flagged as misleading on re-score); `updated_at = NOW()` is set on every upsert.

**2. `StrategyScoresRepository`** mirroring `app/repositories/strategies.py:27` (recon.md:Patterns to
REUSE) — same ctor `__init__(self, db_pool)`, same asyncpg `fetchrow`/`fetch` style, same
`json.dumps(...)::jsonb` binding. Methods:
- `upsert(strategy_id, overall_score, rating, component_scores: dict) -> dict` —
  `INSERT ... VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (strategy_id) DO UPDATE SET overall_score=EXCLUDED.overall_score, rating=EXCLUDED.rating, component_scores=EXCLUDED.component_scores, updated_at=NOW() RETURNING *`.
- `get_by_id(strategy_id) -> dict | None`; `list() -> list[dict]`.
- Module-level `_to_dict(row)` decoding the **`component_scores`** JSONB key — NOT a blind copy of
  `strategies.py:14` (which decodes `definition_json`); asyncpg returns JSONB as `str`, so decode via
  the `isinstance(raw, str)` branch (`strategies.py:20`).

**3. Servicer wiring** (`app/handlers/servicer.py`):
- Inject `self._scores_repo = StrategyScoresRepository(db_pool) if db_pool else None` (mirrors `:87`).
- **ScoreStrategy** (`:708`): keep the synchronous `self._strategies[id] = score` (this is the live
  read path). Immediately after, best-effort upsert wrapped in the **same** `try/except Exception →
  log.warning` idiom as the ledger emit (`:717-728`) — FR-7 honored, and because reads serve from
  memory the swallowed-write case still reads back correctly (no false success). Convert the protobuf
  `ScalarMap` via `dict(score.component_scores)` before `json.dumps`.
- **Reads unchanged**: `ListStrategies` (`:733`) and `GetStrategyReport` (`:737`) keep serving from
  `self._strategies`. No behavior change for callers; the DB is invisible to the read path.
- **New `_row_to_score(row) -> StrategyScore`** helper (mirrors `_row_to_strategy_definition` `:940`)
  used only by hydrate.

**4. Hydrate-at-boot** (`app/main.py:84`, the `if db_pool is not None:` block — recon.md:server
`main.py:84`, the fundsignal-loop attach site): after servicer construction, best-effort
`rows = await scores_repo.list(); for r: servicer._strategies[r["strategy_id"]] = _row_to_score(r)`,
wrapped in its own try/except → warning so a hydrate failure never blocks startup. This is the only
net-new startup machinery (~5 lines) and is what makes scores survive a restart.

**Open-question resolutions:** (1) write-through + hydrate-at-boot, not DB-direct; (2) loose key, no
FK to `analysis.strategies`; (3) retain the score row on deactivation (UI filters inactive via
definitions — spec Out-of-Scope).

**Test approach (C-08 / P-06):**
- Repo unit test (net-new file) with AsyncMock pool (`tests/test_fundsignal_loop.py:44-56`): assert
  `upsert` issues the ON-CONFLICT SQL with the `json.dumps`ed map; assert `_to_dict` decodes a
  realistic JSONB **string** (real-serialization coverage the mock-echo test lacked).
- Servicer tests (mirror `tests/test_analysis_servicer.py:446-575`, `svc._scores_repo = AsyncMock()`):
  (a) ScoreStrategy calls `upsert` with the right args; (b) FR-7 — `upsert.side_effect = Exception`,
  assert ScoreStrategy still returns the score **and** the in-memory read still returns it (proves no
  false-success); (c) hydrate test — given `list()` rows, `self._strategies` is populated with correct
  `StrategyScore` protos (this is the restart-survivability / AC-7 proof); (d) `_row_to_score`
  round-trip equality on `component_scores` (`map<string,double>`).
- Existing `make_servicer()` no-DB tests (`tests/test_analysis_servicer.py:22`) unaffected — repo is
  `None`, hydrate skipped, reads serve the dict as today.

## Rejected Alternatives

- **DB-direct reads (proposer's original)** — rejected: best-effort write + read-from-DB yields a
  false "scored" ack when the swallowed upsert fails and the next read returns `NOT_FOUND`; also leaves
  the `self._strategies` write at `:708` as dead, never-read, unbounded state.
- **Pure DB-direct, delete the shadow dict, fake-repo for the no-DB test path** — rejected: removes
  the dead-state problem but keeps the acknowledged-but-vanished write gap, and forces touching
  `make_servicer()` scaffolding.
- **Non-best-effort persist with memory fallback (explicit DB-then-memory precedence)** — rejected:
  preserves read-your-writes without a boot hook but reintroduces dual-source read branching; the
  write-through+hydrate design achieves the same with a simpler, single read path.
- **FK `strategy_id → strategies.strategy_id ON DELETE CASCADE`** — rejected: strategies are only
  soft-deactivated (never hard-deleted), and ad-hoc backtests may score an id with no definition row,
  so a FK buys nothing and adds an ordering constraint.

## Open Risks

- [ ] **Partial durability (backtests not persisted).** Post-restart `GetStrategyReport` returns the
  hydrated score with `latest_backtest = null`, and re-scoring a strategy still requires a fresh
  `RunBacktest` (`self._backtests` is volatile; ScoreStrategy aborts `NOT_FOUND` without it —
  `servicer.py:668-674`). In scope (spec Out-of-Scope excludes `BacktestResult` persistence) — to be
  **stated explicitly in AC-2 at /sdd-spec** so the limitation is contractual, not a surprise.
- [ ] **Unbounded table growth / orphan visibility.** `strategy_scores` has no retention/cleanup or
  pagination; deactivated and ad-hoc-id scores persist and are hydrated into `ListStrategies`. The UI
  cross-references definitions, but the RPC makes no such guarantee. Accepted for now — candidate
  follow-up (retention or a definitions join). Note in the spec's Out-of-Scope / Open Questions.
- [ ] **NaN/Infinity JSONB rejection.** Today all components clamp to `[0,1]` (`servicer.py:677-679`),
  so JSONB is safe; a future unclamped `analysis.fundsignal.scoring_formula_id` (063) score could
  produce a value Postgres JSONB rejects → the upsert throws and is swallowed (silent non-persist).
  Mitigate at the persist step (clamp/guard before `json.dumps`) — target the ScoreStrategy wiring step.

## Constitution Rules Touched

- `C-01` — honored: every /sdd-spec step will cite recon.md `path:line` (this design is fully grounded).
- `C-02` — honored: read `context.md` before writing this phase's artifacts.
- `C-05` — honored: no new config keys; existing `analysis.scoring.*` reused.
- `C-07` — honored: migration is `005_strategy_scores.{up,down}.sql`, next NNN after `004`.
- `C-08` / `P-06` — honored: the migration/repo/servicer steps each get a paired test step; the design
  specifies real-serialization + FR-7 + hydrate tests (fixing the adversary's false-coverage finding).
- `F-01` — honored: brand-new migration `005`; no applied `.up.sql` is edited.
- `F-04` — honored: no invented paths/symbols; unknowns live in recon.md `## Risks / Not-found`.
- `F-06` — honored: reuses the single existing asyncpg pool; analysis stays at pool max 2, total ≤ 20.
- `F-07` — honored: no hardcoded config; scoring weights still read via `WatchConfig`.
- `P-03` — honored: the `_to_dict` copy-trap (wrong JSONB key) is called out so it isn't blind-copied.
