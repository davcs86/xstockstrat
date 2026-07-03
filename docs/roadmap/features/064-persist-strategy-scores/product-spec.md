# Product Spec: persist-strategy-scores

**Created**: 2026-07-03

---

## Problem Statement

Strategy scores produced by `ScoreStrategy` in `xstockstrat-analysis` are held only in an in-memory
dict (`self._strategies` in `app/handlers/servicer.py`). Because that dict is never persisted,
`ListStrategies` and `GetStrategyReport` return nothing after the service restarts, so the insights
"Strategy Scores" card, the `/insights/strategies` page, and any report view silently lose all scores
until every strategy is backtested again. This is inconsistent with strategy **definitions**, which
are already DB-backed (`analysis.strategies`, migration `001`) and survive restarts.

## User Story

As a platform operator, I want strategy scores to be persisted durably (DB-backed), so that the
scored views survive an analysis-service restart and stay consistent with the DB-backed strategy
definitions shown in the trader "Live Strategies" panel.

## Functional Requirements

FR-1. `ScoreStrategy` MUST persist the computed score (overall score, rating, and per-component
scores) durably keyed by `strategy_id`, in addition to (or in place of) the in-memory dict.
FR-2. Re-scoring an already-scored strategy MUST upsert — update the existing row in place, never
create a duplicate or a second history row (latest-score-wins; score history is out of scope).
FR-3. `ListStrategies` MUST return persisted scores so that, after an analysis-service restart with
no new backtests, previously scored strategies still appear with their score/rating.
FR-4. `GetStrategyReport` MUST return the persisted score for a strategy after a restart (the
`latest_backtest` portion may remain in-memory/best-effort — see Out of Scope).
FR-5. On startup the service MUST make persisted scores available to the read RPCs without requiring
a re-backtest (either hydrate the in-memory dict from the DB at boot, or read the DB directly in the
read RPCs — an implementation choice for /sdd-design).
FR-6. Persistence MUST reuse the existing analysis asyncpg pool — no new connection pool and no
change to the platform 20-connection budget (analysis stays at pool max 2).
FR-7. Persistence failures MUST NOT break scoring: `ScoreStrategy` still returns the computed score
to the caller even if the DB write fails (best-effort write with a logged warning, mirroring the
existing best-effort ledger-event pattern in the same handler).

## Out of Scope

- Any `xstockstrat-ui` changes — the UI already merges definitions with scores and renders a
  "not scored yet" state (PR #739). This feature only makes the score side durable.
- Score **history** / time-series (keeping every past score). Only the latest score per strategy is
  persisted.
- Automatically recomputing or re-backtesting strategies on startup or on a schedule.
- Persisting the full `BacktestResult` (`latest_backtest`) — only the `StrategyScore` is persisted.
- Changing the scoring formula, weights, or rating thresholds.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-analysis` — owns `ScoreStrategy`, `ListStrategies`, `GetStrategyReport`, the
  `self._strategies` in-memory dict, and the `analysis.*` schema/migrations where the new table lives.

## Proto Contract Changes

- [x] No proto changes required — `StrategyScore`, `ListStrategiesResponse`, and `StrategyReport`
  already carry everything being persisted (`strategy_id`, `overall_score`, `component_scores`,
  `rating`). The change is storage-only, behind unchanged RPC contracts.

## Config Key Changes

- [x] No new config keys — scoring weights already exist under `analysis.scoring.*`; this feature
  adds no runtime-tunable behavior.

## Database Changes

New migration in `services/xstockstrat-analysis/migrations/` (next number `005_`), adding a table to
the existing `analysis` schema, e.g.:

- `analysis.strategy_scores`
  - `strategy_id TEXT PRIMARY KEY` — one latest score per strategy
  - `overall_score DOUBLE PRECISION NOT NULL`
  - `rating TEXT NOT NULL`
  - `component_scores JSONB NOT NULL` — map of component name → score (e.g. `sharpe`, `drawdown`, `win_rate`)
  - `scored_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` / `updated_at`
- Write path is an upsert on `strategy_id` (`INSERT ... ON CONFLICT (strategy_id) DO UPDATE`).
- Migration ships an `.up.sql` + `.down.sql` pair per the DB runbook; never edit an applied migration.
- Relationship to `analysis.strategies` (FK vs. loose key) is an open question below.

## Feature Workflow Notes

Branch to create: `feature/persist-strategy-scores` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [ ] 1 service owner approval (non-breaking proto or config change) — `xstockstrat-analysis`
- [ ] 2 service owners + platform lead (breaking proto change) — N/A (no proto change)
- [x] DBA review + service owner (schema migration) — required for the `005_strategy_scores` migration

## Acceptance Criteria

1. Score a strategy via `ScoreStrategy`, restart the analysis service, then call `ListStrategies` —
   the strategy still appears with its overall score, rating, and component scores.
2. `GetStrategyReport` returns the persisted `StrategyScore` for that strategy after the restart.
3. Re-scoring the same strategy updates the existing row (one row per `strategy_id`; no duplicates).
4. The migration has a matching up/down pair, numbered `005_`, applies cleanly via
   `scripts/db-migrate.sh`, and rolls back cleanly.
5. The analysis connection-pool budget is unchanged (still max 2; no new pool) — root CLAUDE.md
   § Connection Pool Budget table needs no edit.
6. A simulated DB-write failure during `ScoreStrategy` still returns the computed score to the
   caller (logged warning, no RPC error) — FR-7.
7. `uv run pytest` passes with coverage ≥ 40% for the service, including a test that exercises the
   persist → read-back path.

## Open Questions

- [ ] **Hydrate-at-boot vs. DB-direct reads.** Should `ListStrategies`/`GetStrategyReport` read the
  DB on each call (source of truth) or should the service hydrate `self._strategies` from the DB once
  at startup and keep serving from memory (write-through cache)? Deferred to `/sdd-design`. DB-direct
  is simpler and avoids cache-coherence bugs; hydrate-at-boot preserves current hot-path behavior.
- [ ] **Foreign key to `analysis.strategies`.** Should `strategy_scores.strategy_id` FK to
  `strategies.strategy_id` (with `ON DELETE CASCADE`)? Strategies are only ever *deactivated*, never
  hard-deleted today, so a score row can currently outlive nothing — but a loose key avoids ordering
  constraints if an ad-hoc backtest scores a `strategy_id` that has no definition row. Decide in design.
- [ ] **Deactivated strategies.** When a strategy is deactivated (`ManageStrategy` DEACTIVATE),
  should its persisted score be removed or retained? (The UI already hides/badges inactive strategies
  via definitions, so retaining the score row is harmless — confirm.)

> **Known trap (from `docs/roadmap/phase3-deviations.md`):** analysis in-memory score storage was a
> *deliberate* Phase 3 deviation, not an oversight. This feature intentionally reverses that decision
> for scores only. `fails.md` has no related entry. Make sure the design does not conflate this with
> other intentionally-in-memory analysis state (e.g. screener scan results), which stay in-memory.
