# Context: signal-source-weighting

**Feature**: `docs/roadmap/features/007-signal-source-weighting/feature.md`
**Product Spec**: `docs/roadmap/features/007-signal-source-weighting/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/007-signal-source-weighting/implementation-spec.md`

---

## Session 2026-05-16T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Origin: audit of analysis service signal aggregation revealed all sources are weighted equally regardless of reliability.
- No proto changes required; weights delivered via existing config WatchConfig stream.

## Session 2026-05-23T00:00:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings:
  - C-3 trading mode: spec does not explicitly state paper-safety (advisory; analysis feeds backtests only, no order execution)
  - Overlap: 009-agent-mcp-server also modifies `xstockstrat-analysis` — coordinate merge order to avoid conflicts in servicer.py
- Open question resolved: weights bounded to [0.0, 1.0], clamped at read time; FR-5 and AC-3 updated accordingly
- Backlog idea 016-config-ui-weight-validation created for deferred client-side validation

## Session 2026-05-23T00:00:02Z — sdd-execute

### Step 3 — docs: Document `analysis.signals.source_weights` in analysis CLAUDE.md [done]
- Appended new row to the Config Keys Consumed table in `services/xstockstrat-analysis/CLAUDE.md` after `analysis.scoring.win_rate_weight`, documenting type, default, and clamping behaviour.
- Files modified: `services/xstockstrat-analysis/CLAUDE.md`
- Deviations: none

## Session 2026-05-23T00:00:01Z — sdd-execute

### Step 2 — service: Apply per-source weight multiplier in `_compute_signal_score` [done]
- Added `import json` at module level; read `analysis.signals.source_weights` via `get_str` in `RunBacktest` with JSON parse + clamp; threaded `source_weights` through `_backtest_symbol` signature and call site; extended `_compute_signal_score` signature with `source_weights: dict | None = None` and applied `weight = max(0.0, min(1.0, ...))` multiplier in the inner loop.
- Files modified: `services/xstockstrat-analysis/app/handlers/servicer.py`
- Deviations: none

## Session 2026-05-23T00:00:00Z — sdd-execute

### Step 1 — config: Seed `analysis.signals.source_weights` config key [done]
- Created up/down migration pair `003_analysis_signal_source_weights` in `services/xstockstrat-config/migrations/`. Inserts two rows (dev + production, trading_mode='all') with value_type='string', value_data='{}'. ON CONFLICT DO NOTHING guard ensures idempotency.
- Files modified: `services/xstockstrat-config/migrations/003_analysis_signal_source_weights.up.sql`, `services/xstockstrat-config/migrations/003_analysis_signal_source_weights.down.sql`
- Deviations: none

## Session 2026-05-24T00:00:00Z — sdd-execute

### Step 4 — test: Unit tests for weighted `_compute_signal_score` and config read path [done]
- Added `cfg.get_str = MagicMock(side_effect=lambda key, default="": default)` to `make_servicer()` in `tests/test_analysis_servicer.py` to cover new JSON config read path without TypeError.
- Appended `TestComputeSignalScoreWithWeights` class (8 tests) to `tests/test_analysis_helpers.py` covering: weight=1.0 identity, weight=0.0 silence, reduced influence, missing-source default=1.0, clamp above 1.0, clamp below 0.0, score always in [0.0,1.0], mixed weighted sources.
- All 61 tests pass; coverage 46.94% (threshold 40%).
- **Deviation**: grpcio version mismatch blocked pytest. `uv.lock` in all 3 Python services pinned grpcio 1.78.0 but generated stubs require >=1.80.0. Bumped `grpcio>=1.63.0` → `>=1.80.0` (and grpcio-reflection, grpcio-tools) in `pyproject.toml` for `xstockstrat-analysis`, `xstockstrat-indicators`, `xstockstrat-ingest`; regenerated all three `uv.lock` files.
- Files modified: `services/xstockstrat-analysis/tests/test_analysis_helpers.py`, `services/xstockstrat-analysis/tests/test_analysis_servicer.py`, `services/xstockstrat-analysis/pyproject.toml`, `services/xstockstrat-analysis/uv.lock`, `services/xstockstrat-indicators/pyproject.toml`, `services/xstockstrat-indicators/uv.lock`, `services/xstockstrat-ingest/pyproject.toml`, `services/xstockstrat-ingest/uv.lock`
- Feature status → `code-completed`

## Session 2026-05-23T00:00:00Z — sdd-spec

- Generated implementation-spec.md with 4 steps. Status → implementation-ready.
- Key codebase findings:
  - Last config migration is `002_config_environment.up.sql`; new migration is `003_analysis_signal_source_weights.up.sql/down.sql`
  - `_compute_signal_score` at `servicer.py:L494` accumulates conviction without weights; signature change adds `source_weights: dict | None = None` so all existing tests pass unchanged
  - Config service stores JSON payloads as `value_type='string'`; `buildConfigValue` returns `string_val` for both `'string'` and unknown types (confirmed at `configServiceImpl.ts:L248`); analysis watcher reads via `get_str()` then `json.loads()`
  - `xstockstrat-config-ui/app/sources/page.tsx:L164` already references `analysis.signals.source_weights` key name — confirms the key name is correct
  - `make_servicer()` in `test_analysis_servicer.py` mocks `get_float` but not `get_str`; Step 4 adds the missing `get_str` mock to prevent `json.loads(MagicMock())` TypeError in existing `TestRunBacktest` tests

## Session 2026-05-24 (CI: feature status automation)

- Promotion PR #321 merged to main
- Feature promoted and committed: 75c8866a31dc4cce892192f7e4ce469add7345e1
- Status updated: `code-completed` → `launched`
- Launched date: 2026-05-24
