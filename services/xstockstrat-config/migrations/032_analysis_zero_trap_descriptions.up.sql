-- Migration: 032_analysis_zero_trap_descriptions.up.sql
-- Service: xstockstrat-config, feature 244 (fix-python-config-stored-zero).
-- Description-only: 027/028 stay immutable; the description guard keeps each UPDATE idempotent.

UPDATE config.config_values
SET description = 'Weight w in [0,1] of the independent signal axis in the queue ORDER BY (feature 097): rank = (1-w)*conviction + w*signal_axis. Bounds [0,1]. 0 is honored - the default sort ranks by conviction alone.'
WHERE namespace = 'analysis'
  AND key = 'analysis.opportunity.signal_rank_weight'
  AND description = 'Weight w in [0,1] of the independent signal axis in the queue ORDER BY (feature 097): rank = (1-w)*conviction + w*signal_axis. Bounds [0,1]. 0 is not honored - reads as the 0.3 default (get_float).';

UPDATE config.config_values
SET description = 'Process-lifetime semaphore bounding cross-request concurrency of _compute_opportunities bars-fetch calls (feature 141, SEV-2 fix for TimescaleDB out-of-shared-memory). Read once in AnalysisServicer.__init__ (a stored 0 or negative reads as the default 2). Takes effect at service restart. Bounds [1,5] (ceiling = marketdata PgBouncer pool size).'
WHERE namespace = 'analysis'
  AND key = 'analysis.opportunity.max_concurrent_bars_fetches'
  AND description = 'Process-lifetime semaphore bounding cross-request concurrency of _compute_opportunities bars-fetch calls (feature 141, SEV-2 fix for TimescaleDB out-of-shared-memory). Read once in AnalysisServicer.__init__ (get_int, max(1,...)). Takes effect at service restart. Bounds [1,5] (ceiling = marketdata PgBouncer pool size).';

UPDATE config.config_values
SET description = 'Bounds the per-candidate evaluate_conditions_traced fan-out in _compute_opportunities Phase 2 (feature 176), separate from max_concurrent_bars_fetches (priority-inversion guard). Read once in AnalysisServicer.__init__ (a stored 0 or negative reads as the default 4). Takes effect at service restart. Bounds [1,50].'
WHERE namespace = 'analysis'
  AND key = 'analysis.opportunity.max_concurrent_candidates'
  AND description = 'Bounds the per-candidate evaluate_conditions_traced fan-out in _compute_opportunities Phase 2 (feature 176), separate from max_concurrent_bars_fetches (priority-inversion guard). Read once in AnalysisServicer.__init__ (get_int, max(1,...)). Takes effect at service restart. Bounds [1,50].';

UPDATE config.config_values
SET description = 'The readiness materializer loop''s own bars-fetch semaphore (feature 180), separate from analysis.opportunity.max_concurrent_bars_fetches so a background pre-warm never starves interactive readiness; also throttles the feature-181 GetWatchlistReadiness on-read refresh kick (R-F). A stored 0 or negative reads as the default 2 (read-side clamp). Bounds [1,5] (ceiling = marketdata PgBouncer pool size, feature-141 SEV-2 guard).'
WHERE namespace = 'analysis'
  AND key = 'analysis.readiness_materializer.max_concurrent_bars_fetches'
  AND description = 'The readiness materializer loop''s own bars-fetch semaphore (feature 180), separate from analysis.opportunity.max_concurrent_bars_fetches so a background pre-warm never starves interactive readiness; also throttles the feature-181 GetWatchlistReadiness on-read refresh kick (R-F). Never set 0 (get_int zero-trap collapses it to the default 2). Bounds [1,5] (ceiling = marketdata PgBouncer pool size, feature-141 SEV-2 guard).';
