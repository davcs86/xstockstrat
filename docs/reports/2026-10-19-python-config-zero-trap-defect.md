# Defect: Python config getters collapse a stored 0 / "" to the coded default

**Recorded**: 2026-10-19
**Severity**: SEV-2
**Impact type**: config-value-ignored
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-analysis, xstockstrat-indicators, xstockstrat-ingest
**Config-only fix possible**: no
**Source**: `docs/context-constitution-findings.md` § Latent bugs row 1 (CF-N10); `docs/context-constitution.md` § Gotchas (Python config zero-trap)

## Observed
`ConfigWatcher.get_int` / `get_str` / `get_float` return `v.<x>_val or default` in all three Python
services, so an operator-stored `0`, `0.0` or `""` silently resolves to the in-code default.
`config.ConfigValue` is a `oneof` that distinguishes 0 from unset, and `get_bool` already uses
`HasField`; analysis and ingest have a per-key `get_int_present` escape hatch, indicators has none
for numerics. Concrete analysis keys where 0 is a legitimate operator value but is swallowed:
- `analysis.backtest.default_commission_pct` 0 → 0.001, `default_slippage_pct` 0 → 0.0005 (a
  zero-cost backtest is impossible to configure).
- `analysis.opportunity.signal_rank_weight` 0 → 0.3, although the config service explicitly
  allows a lower bound of 0 and its comment claims "the getter honors a legitimate 0".
- `analysis.engine.alert_throttle_seconds` 0 → 300 (throttling cannot be disabled).

Ingest's two backfill semaphore keys keep the trap **deliberately** (0 would deadlock
`asyncio.Semaphore(0)`); a fix must preserve that clamp, not blanket-switch to `HasField`.

## Expected
Numeric/string getters honour a stored zero value via `HasField` (as `get_bool` and the Node `??`
getter do), with explicit clamps only where 0 is unsafe.

## Reproduction
1. `SetConfig analysis.opportunity.signal_rank_weight = 0` (accepted: bounds `[0,1]`).
2. Call `ListOpportunities`; ranking still blends signal rank at weight 0.3.
3. Likewise set `analysis.backtest.default_commission_pct = 0`, run `RunBacktest`; commission 0.001 is applied.

## Evidence
`services/xstockstrat-indicators/app/config/watcher.py:114`
> return v.int_val or default

`services/xstockstrat-ingest/app/config/watcher.py:118`
> return v.int_val or default

`services/xstockstrat-analysis/app/config/watcher.py:134`
> return v.float_val or default

`services/xstockstrat-analysis/app/handlers/servicer.py:787-788`
> commission = self._cfg.get_float("analysis.backtest.default_commission_pct", 0.001)
> slippage = self._cfg.get_float("analysis.backtest.default_slippage_pct", 0.0005)

`services/xstockstrat-analysis/app/handlers/servicer.py:4615`
> w = self._cfg.get_float("analysis.opportunity.signal_rank_weight", 0.3)

`services/xstockstrat-config/src/grpc/configServiceImpl.ts:115-116,120`
> keys are seeded unbounded. Lower 0 where the getter honors a legitimate 0 (refresh_hour_utc =
> midnight, signal_rank_weight = a valid weight); lower 1 on get_int zero-trap keys where 0 already
> 'analysis.opportunity.signal_rank_weight': { minValue: 0, maxValue: 1 },

`services/xstockstrat-analysis/app/engine/live_loop.py:351`
> throttle = self._cfg.get_int("analysis.engine.alert_throttle_seconds", default=300)

`services/xstockstrat-ingest/app/config/watcher.py:185-186` (intentional trap — keep)
> # get_int (zero-trap intentional): a configured 0 → default 3; 0 would reach
> # asyncio.Semaphore(0) at servicer.py:191 and deadlock. Do NOT switch to get_int_present.

## Root cause hypothesis
Truthiness `or default` was written to cover the unset case and conflates it with a zero value; the
fix has been applied only per key (`get_int_present` / `get_float_present`), leaving most keys trapped.

## Confidence
high
