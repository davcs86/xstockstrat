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
- A maximum age floor that drops ancient signals entirely (resolved — see Open Questions: not
  needed in V1, since FR-1's exponential decay already asymptotically approaches zero without a
  special-cased cutoff)

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-analysis` — scoring loop modification
- `xstockstrat-config` — new config key registration

## Consumer Surface(s)

- [x] **UI** — `xstockstrat-ui` `/insights`: the decayed `effective_confidence` feeds
  `combine_score()`'s `signal_score` input, which is one of the two terms `conviction`
  (`BarDiagnostic.conviction`, `packages/proto/analysis/v1/analysis.proto:147`) is computed from —
  the Backtest Diagnostics table on `/insights/strategies/[id]` renders `bar.conviction` per row
  (`services/xstockstrat-ui/src/components/insights/BacktestDiagnostics.tsx:153`), so a decayed
  signal changes a value already displayed there. Second-order: `conviction` drives `BarAction`
  entry/exit decisions, which roll into the headline `StrategyScore.overall_score`/`rating`
  (`analysis.proto:170,172`) shown on the same strategy detail page via feature 065's per-symbol
  evidence aggregation — no new UI element is required, an existing display simply reflects
  different (fresher-weighted) values once this ships.
- [ ] **Agent** — no MCP tool surfaces per-bar diagnostics or signal decay directly; none added.
- [ ] **None**

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

- [x] Should the decay reference time be `ingested_at` or the source newsletter's publication
  timestamp? **Resolved**: `ingested_at`, per FR-4 — it's platform-controlled and immune to
  newsletter timestamp manipulation. This was already the spec's own committed requirement (FR-4);
  the question is closed, not deferred.
- [x] Should a maximum age floor (e.g. signals older than 7 days get multiplier=0 and are dropped
  entirely) be added in V1? **Resolved: no.** FR-1's exponential decay is already
  self-limiting — at 3×half-life the multiplier is ≈0.125, at 7×half-life ≈0.008 — so a signal's
  practical influence vanishes on its own without a special-cased hard cutoff, consistent with this
  spec's existing V1-minimalism (single global half-life, no per-source rates). A DB-query-pruning
  floor is a distinct performance optimization, not a correctness requirement; if signal-table
  volume later makes an unbounded age range a real query cost, that is a named follow-up to raise
  against the ingest signal-retention story, not blocking scope here.
