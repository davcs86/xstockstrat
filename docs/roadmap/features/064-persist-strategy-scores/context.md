# Context: persist-strategy-scores

**Feature**: `docs/roadmap/features/064-persist-strategy-scores/feature.md`
**Product Spec**: `docs/roadmap/features/064-persist-strategy-scores/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/064-persist-strategy-scores/implementation-spec.md`

---

## Session 2026-07-03 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Origin: follow-up ("Option B") to the strategies UI-discrepancy fix (PR #739). That PR made the
  insights views merge definitions with scores and render a "not scored yet" state; it left a noted
  follow-up: scores in `xstockstrat-analysis` are in-memory only (`self._strategies`,
  `services/xstockstrat-analysis/app/handlers/servicer.py:86,708,733,737`) and vanish on restart.
  This feature persists them.
- Grounding read: `analysis.strategies` table (migration `001_strategies.up.sql`) and existing
  migrations `001–004`; next migration number is `005_`.
- Known trap noted in product-spec: Phase 3 chose in-memory analysis storage deliberately
  (`docs/roadmap/phase3-deviations.md`); this feature reverses it for scores only. `fails.md` empty.
- Open questions captured for /sdd-design: DB-direct reads vs. hydrate-at-boot; FK to
  `analysis.strategies`; score retention on strategy deactivation.

## Session 2026-07-03 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Criteria verdict: PASS WITH WARNINGS (spec-reviewer). No blockers; every code-checkable claim
  verified (in-memory dict at servicer.py:86/708, ListStrategies:732, GetStrategyReport:736; next
  migration = 005_; pool budget stays 2; FR-7 best-effort mirrors AppendEvent try/except at :717-728).
- Warnings: 3 unchecked Open Questions (hydrate-at-boot vs DB-direct reads; FK to analysis.strategies;
  score retention on deactivation) — correctly deferred to /sdd-design (P-03). Must be closed in design.
- Overlap findings: none (feature-overlap = CLEAN). Migration 005_ free; table name unique; no config
  or proto collisions; no merge-order entry warranted.

## Session 2026-07-03 — sdd-design

- Phase 0 Recon: wrote recon.md (service: xstockstrat-analysis). Key reuse patterns: StrategiesRepository
  shape (app/repositories/strategies.py:27) as the mirror target; best-effort ledger try/except
  (servicer.py:717-728) for FR-7; AsyncMock pool test harness (test_fundsignal_loop.py:44-56).
- Phase 1 Grilling: 1 round (quick). Proposer offered DB-direct reads + best-effort write. Adversary
  (NEEDS WORK, no Floor breach) flagged a false-success hazard: swallowed upsert + DB-direct read →
  ScoreStrategy acks success but the next read returns NOT_FOUND; also dead in-memory write, JSONB
  copy-trap (_to_dict wrong key), and AsyncMock echo test giving false serialization coverage.
- Chosen approach: **write-through in-memory serving + hydrate-at-boot** (DB = durability layer, reads
  stay in-memory). Resolves the false-success hazard, preserves read-your-writes under FR-7, keeps the
  read path unchanged. Loose key (no FK); retain score row on deactivation. created_at/updated_at (not
  scored_at). Rejected: DB-direct reads; pure DB-direct w/ fake repo; DB-then-memory precedence; FK CASCADE.
- Constitution rules touched: C-01/C-05/C-07/C-08/P-06/F-01/F-04/F-06/F-07/P-03 (all honored). Floor
  breaches: none.
- Status: spec-ready → design-approved.
- Note (P-05): this feature deliberately reverses the Phase-3 in-memory-storage deviation
  (phase3-deviations.md) for scores only — not for self._backtests or screener state.

## Session 2026-07-03 — sdd-spec

- Generated implementation-spec.md with 6 steps. Status → implementation-ready.
- Consumed recon.md + design.md (design-approved). Verified every design anchor directly in code —
  all path:line references hold (C-01).
- Key codebase findings:
  - Last migration is `004_fundsignal_emitted`; next is `005_strategy_scores` (C-07). DDL/JSONB style
    from `migrations/001_strategies.up.sql:1-10`; no `CREATE SCHEMA analysis` (schema pre-exists).
  - Repo mirror target `StrategiesRepository` (`app/repositories/strategies.py:27`); `_to_dict` JSONB
    decode idiom at `strategies.py:14-24` — new repo must decode the `component_scores` key, not
    `definition_json` (P-03 copy-trap). No `ON CONFLICT` precedent — upsert is new-to-service.
  - `ScoreStrategy` writes `self._strategies[id] = score` at `servicer.py:708`; FR-7 best-effort
    template is the ledger emit `try/except → log.warning` at `servicer.py:717-728`. Components already
    clamped `[0,1]` at `servicer.py:677-679`; `math` imported at `servicer.py:16` for the finite guard.
  - Boot wiring site `main.py:84` `if db_pool is not None:`; servicer built at `main.py:52-61`.
- Design refinement (faithful to design.md): hydrate logic encapsulated as a testable servicer method
  `hydrate_scores()` (unit-tested in Step 5); `main.py` just makes the best-effort boot call. No
  standalone `main.py` unit test — boot glue, consistent with existing loop wiring.
- Steps 4/5 merged servicer.py + main.py into one `service` step + one paired `test` step (C-08).
- Neither `docs/patterns/database.md` nor root CLAUDE.md enumerates analysis tables (grep-confirmed) —
  docs work is a lightweight note in the analysis CLAUDE.md (Step 6).
- Reviewers snapshot unchanged: DBA (migration) + xstockstrat-analysis owner (service/test); docs=none.

## Session 2026-07-03 — sdd-review impl-spec (advisory)

- Criteria: PASS WITH WARNINGS (spec-reviewer). 0 blockers, no Floor breach. C-08 test-pairing and
  B3 ordering both satisfied; F-01/F-06/F-07 explicitly respected.
- Warning (fixed pre-execute): Step 3 cited `tests/test_analysis_servicer.py:33` for a
  `StrategiesRepository` import that doesn't exist there. Corrected the Codebase Evidence to point at
  the real mockable-repo pattern (`svc._strategies_repo = AsyncMock()` at `:446`). Execution not yet
  started, so F-09 (step-body immutability during execution) does not apply.
- Informational notes (no change): `math.isfinite` correctly guards only the JSONB `component_scores`
  path (overall_score → DOUBLE PRECISION accepts non-finite); Step 4 B2b `live` keyword is a
  false-positive (strategy live-loop, not TRADING_MODE).
- Overlap: CLEAN (feature-overlap). 064 is the only in-flight feature; migration 005_ free; no proto/
  config/file-path collisions; no merge-order entry needed.
- Status unchanged (advisory gate): implementation-ready.

## Open Threads (carried from design.md Open Risks)

- Partial durability: backtests not persisted → post-restart GetStrategyReport returns latest_backtest=null
  and re-score needs a fresh RunBacktest. Target: state explicitly in AC-2 at /sdd-spec.
- Unbounded table growth / orphan visibility: no retention/pagination; deactivated + ad-hoc-id scores
  persist & hydrate. Target: note in spec Out-of-Scope/Open Questions; candidate follow-up feature.
- NaN/Infinity JSONB rejection if a future 063 formula produces unclamped scores. Target: clamp/guard at
  the ScoreStrategy persist step.

## Session 2026-07-03 — sdd-execute (sequential)

- Running sequential mode. Interactive confirmation gates unavailable → explicit invocation taken as
  authorization (logged in Deviation Log). PR strategy: per-step commits on feature branch; PR #742 is
  the integration PR (logged in Deviation Log).

### Step 1 — migration: create analysis.strategy_scores [done]
- Created `005_strategy_scores.up.sql` / `.down.sql` (loose strategy_id PK, no FK; created_at/updated_at;
  component_scores JSONB default '{}').
- Verified via throwaway local postgres:16 cluster (docker down; db-migrate.sh needs live DB): apply →
  correct shape + PK, upsert idempotency (1 row, latest wins — FR-2/AC-3), re-apply idempotent, down
  drops cleanly (AC-4). CI-equivalent fallback logged in Deviation Log.
- Files modified: `services/xstockstrat-analysis/migrations/005_strategy_scores.{up,down}.sql`
- Deviations: process (sequential/PR) + CI-equivalent migration verification — see Deviation Log.

### Steps 2 & 3 — StrategyScoresRepository + unit test [done]
- TDD (paired, C-08/P-06): wrote test first → RED (`ModuleNotFoundError: app.repositories.strategy_scores`)
  → wrote repo → GREEN (7 passed). Repo mirrors StrategiesRepository (fetchrow/fetch, json.dumps(...)::jsonb);
  `_to_dict` decodes the `component_scores` key (P-03 copy-trap avoided, not `definition_json`).
  upsert = INSERT ... ON CONFLICT (strategy_id) DO UPDATE ... RETURNING *; get_by_id; list (no pagination).
- Ruff: 1 import-order fix on the new test file (its own new code), then clean; format clean.
- Files modified: `app/repositories/strategy_scores.py` (new), `tests/test_strategy_scores_repo.py` (new)
- Deviations: none.

### Steps 4 & 5 — servicer persist + hydrate wiring + tests [done]
- TDD (paired, C-08/P-06): appended TestScorePersistence to test_analysis_servicer.py → RED
  (4 failed: ImportError `_row_to_score`, missing `_scores_repo`/`hydrate_scores`) → implemented Step 4
  → GREEN (5 passed; full suite 152 passed, coverage 67.63% ≥ 40%).
- servicer.py: import + inject `self._scores_repo` (None without db_pool); best-effort upsert in
  ScoreStrategy after the in-memory write (FR-7 try/except → warning; math.isfinite JSONB guard);
  new `hydrate_scores()` method (no-op without repo); module-level `_row_to_score` helper (decodes
  component_scores map). ListStrategies/GetStrategyReport unchanged (serve self._strategies).
- main.py: best-effort `await servicer.hydrate_scores()` inside the existing `if db_pool is not None:`
  boot block — reuses the single asyncpg pool, no new pool (F-06). No env/config/proto change.
- Ruff check clean; ruff format applied to servicer.py's own new lines only (file was format-clean before).
- Files modified: `app/handlers/servicer.py`, `app/main.py`, `tests/test_analysis_servicer.py`
- Deviations: none.

### Step 6 — docs note in analysis CLAUDE.md [done]
- Added "Strategy Score Persistence (feature 064)" subsection documenting the table, best-effort upsert,
  hydrate-at-boot, no-new-pool, and the accepted limitations (no BacktestResult persistence, no
  retention/pagination, math.isfinite guard). grep confirms `strategy_scores` present.
- Files modified: `services/xstockstrat-analysis/CLAUDE.md`
- Deviations: none.

## Session 2026-07-03 — sdd-execute (sequential) — SESSION END
**Steps this session**: 1, 2, 3, 4, 5, 6 (all)
**Progress**: 6 done / 6 total — feature code-completed
**Verification**: full analysis suite 152 passed, coverage 67.63% (≥40); ruff check+format clean;
migration apply/upsert/rollback proven on a throwaway postgres:16 cluster.
**Ledger**: appended a write-through+hydrate-at-boot insight to docs/roadmap/ledger/insights.md.
**Integration PR**: #742 (feature/persist-strategy-scores → main-dev) — pre-existing; now carries the
full implementation. CI to run on push.
**Next**: merge PR #742 when CI passes + reviewers approve.

## Session 2026-07-12 (CI: feature status automation)

- Promotion PR #759 merged to main
- Feature promoted and committed: 6fab9e323637aa00e0ad5fc09bb68a1ab6c5a529
- Status updated: `code-completed` → `launched`
- Launched date: 2026-07-12
