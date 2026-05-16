# Product Spec: signal-source-weighting

**Created**: 2026-05-16

---

## Problem Statement

The analysis service's `_compute_signal_score()` treats all signal sources equally — a low-quality newsletter and a high-conviction institutional source each contribute the same weight to the aggregated conviction score. This dilutes the signal from reliable sources and amplifies noise from unreliable ones.

## User Story

As a platform operator, I want to assign a reliability weight to each signal source, so that higher-quality sources have proportionally more influence on the conviction score used in backtesting and live strategy evaluation.

## Functional Requirements

FR-1. The analysis service must apply a per-source multiplier to each signal's conviction before accumulating buy/sell totals in `_compute_signal_score()`.
FR-2. Source weights must be read from the config service using the key `analysis.signals.source_weights` as a JSON object mapping source name to float multiplier (e.g. `{"goldman": 1.5, "citron": 0.8}`).
FR-3. If a source is not present in the weights map, its effective multiplier must default to `1.0` (neutral — existing behaviour unchanged).
FR-4. Weights must be read via the existing WatchConfig stream so changes apply to the next backtest run without a service restart.
FR-5. The weighted conviction must remain clamped or handled such that the final `signal_score` stays in the `0.0–1.0` range.
FR-6. The new config key must be documented in the analysis service's `CLAUDE.md` under "Config Keys".

## Out of Scope

- Automatic source quality scoring or machine-learning-based weight derivation.
- Per-symbol or per-timeframe weight overrides.
- Retroactive re-scoring of completed backtests already stored in memory.
- Any changes to the ingest service or the `ExternalSignal` proto schema.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-analysis` — `_compute_signal_score()` in `app/handlers/servicer.py` reads weights and applies multiplier per source
- `xstockstrat-config` — new config key `analysis.signals.source_weights` must be registered

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

New key:
- `analysis.signals.source_weights` — type: JSON string (object), default: `"{}"` (empty object → all sources weight 1.0), scoped per environment and trading_mode

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/signal-source-weighting` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (config key addition)
- [ ] 2 service owners + platform lead (breaking proto change) — not applicable
- [ ] DBA review + service owner (schema migration) — not applicable

## Acceptance Criteria

1. A backtest run with `source_weights={"source_a": 2.0, "source_b": 0.5}` produces a different `signal_score` per bar than the same run with no weights, when both sources have active signals on that bar.
2. A source absent from `source_weights` behaves identically to the current implementation (multiplier = 1.0).
3. The `signal_score` output of `_compute_signal_score()` remains in `[0.0, 1.0]` under all weight combinations.
4. Changing `analysis.signals.source_weights` via the config service takes effect on the next `RunBacktest` call without restarting the analysis service.
5. The config key is documented in `services/xstockstrat-analysis/CLAUDE.md` under "Config Keys".

## Open Questions

- [ ] Should weight values be bounded (e.g. max 10.0) to prevent a single source from dominating completely, or is that left to operator discretion?
