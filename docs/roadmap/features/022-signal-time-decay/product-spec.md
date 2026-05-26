# Product Spec: signal-time-decay

**Created**: 2026-05-26

---

## Problem Statement

The analysis service applies source weights to signals (feature 007) but treats all signals as equally fresh regardless of age. A buy signal extracted from a newsletter 72 hours ago carries identical conviction weight to one extracted 30 minutes before market open. Markets reprice information quickly; stale signals actively mislead the scoring engine and can produce erroneous high-confidence scores on information the market has already acted on.

## User Story

As a platform operator, I want signal confidence to decay exponentially with age so that the analysis engine naturally deprioritizes stale signals and reacts more strongly to recent intelligence.

## Functional Requirements

FR-1. The analysis service scoring loop must apply an exponential decay multiplier to each signal's effective confidence before aggregating: `effective_confidence = raw_confidence × source_weight × exp(-λ × age_hours)` where `λ = ln(2) / half_life_hours`.
FR-2. The decay half-life must be configurable via a config key (`analysis.scoring.signal_decay_half_life_hours`, float, default: 24.0) with no restart required.
FR-3. A half-life of 0 or negative must disable decay (multiplier = 1.0) to allow rollback without config key removal.
FR-4. Signal age is computed as `now_utc - signal.ingested_at` (the timestamp recorded by the ingest service at extraction time, not the source publication time).
FR-5. The decay calculation must be deterministic: backtests use the signal's `ingested_at` timestamp relative to the backtest window's `now`, not the real wall clock.
FR-6. The effective (post-decay) confidence must be logged at DEBUG level per signal to aid tuning.

## Out of Scope

- Per-source-type decay rates (one global half-life in V1; per-source rates are a V2 extension)
- Decay applied in the indicators formula engine (only in the analysis scoring loop)
- UI visualization of decayed vs. raw confidence

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-analysis` — scoring loop modification
- `xstockstrat-config` — new config key registration

## Proto Contract Changes

- [ ] No proto changes required

## Config Key Changes

- `analysis.scoring.signal_decay_half_life_hours` — float; half-life in hours for exponential confidence decay (default: 24.0; set to 0 to disable)

## Database Changes

- [ ] No schema changes

## Feature Workflow Notes

Branch to create: `feature/signal-time-decay` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking config + analysis logic change)
- [ ] 2 service owners + platform lead (breaking proto change) — not applicable
- [ ] DBA review + service owner (schema migration) — not applicable

## Acceptance Criteria

1. A signal ingested 48 hours ago with a 24-hour half-life has its confidence halved relative to a signal ingested now with identical raw values.
2. Setting `signal_decay_half_life_hours` to 0 via the config service (no restart) immediately disables decay — scores match pre-feature behavior.
3. Backtests using a fixed historical window produce the same score on repeated runs (determinism invariant).
4. DEBUG logs show `raw_confidence`, `source_weight`, `age_hours`, `decay_multiplier`, and `effective_confidence` per signal.
5. Analysis service unit tests cover: decay at t=0 (multiplier=1.0), at t=half_life (multiplier≈0.5), at t=3×half_life (multiplier≈0.125), and disabled decay.

## Open Questions

- [ ] Should the decay reference time be `ingested_at` or the source newsletter's publication timestamp? `ingested_at` is preferred — it's platform-controlled and immune to newsletter timestamp manipulation. Confirm at impl-spec time.
- [ ] Should a maximum age floor (e.g. signals older than 7 days get multiplier=0 and are dropped entirely) be added in V1? Would simplify DB queries. Decision deferred to impl-spec.
