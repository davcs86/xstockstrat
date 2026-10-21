# Product Spec: fix-python-config-zero-trap

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-19-python-config-zero-trap-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20

---

## Problem Statement

**Observed.** `ConfigWatcher.get_int` / `get_str` / `get_float` return `v.<x>_val or default` in all three Python
services (`services/xstockstrat-indicators/app/config/watcher.py:96,114,130`;
`services/xstockstrat-ingest/app/config/watcher.py:110,118,144`;
`services/xstockstrat-analysis/app/config/watcher.py:97,105,134`). A stored `0`, `0.0` or `""` resolves to the
in-code default, although `config.ConfigValue` is a `oneof` that distinguishes zero from unset and `get_bool`
already uses `HasField`. Analysis and ingest have per-key `get_int_present` (analysis also `get_float_present`);
indicators has only `get_str_present`. Swallowed analysis keys where 0 is legitimate:
- `analysis.backtest.default_commission_pct` 0 → 0.001 and `default_slippage_pct` 0 → 0.0005
  (`services/xstockstrat-analysis/app/handlers/servicer.py:787-788`);
- `analysis.opportunity.signal_rank_weight` 0 → 0.3 (`servicer.py:4615`), although config bounds allow 0 and the
  bounds comment claims "the getter honors a legitimate 0" (`services/xstockstrat-config/src/grpc/configServiceImpl.ts:115-116,120`);
- `analysis.engine.alert_throttle_seconds` 0 → 300 (`services/xstockstrat-analysis/app/engine/live_loop.py:351`).

**Expected.** Numeric and string getters honour a stored zero value via `HasField` (as `get_bool` and the Node
`??` getter do), with explicit clamps only where 0 is unsafe. Ingest's backfill semaphore keys keep a 0 → safe
value clamp (`services/xstockstrat-ingest/app/config/watcher.py:185-186`, `asyncio.Semaphore(0)` deadlock).

## Reproduction Steps

1. `SetConfig analysis.opportunity.signal_rank_weight = 0` (accepted: bounds `[0,1]`).
2. Call `ListOpportunities`; ranking still blends signal rank at weight 0.3.
3. Set `analysis.backtest.default_commission_pct = 0` and run `RunBacktest`; commission 0.001 is applied.

## Root Cause Hypothesis

Truthiness `or default` was written for the unset case and conflates it with a zero value. The fix was applied per
key (`get_int_present` / `get_float_present`), leaving most keys trapped.

## Affected Services

- xstockstrat-analysis
- xstockstrat-indicators
- xstockstrat-ingest
- xstockstrat-config (possible: bounds comment/`minValue: 1` rows that exist only because of the trap, `configServiceImpl.ts:115-117`)

## Fix Scope

- [x] No proto changes anticipated (`ConfigValue` oneof already distinguishes zero from unset)
- [x] No database migrations anticipated
- [ ] Config bounds possibly revised: keys bounded `minValue: 1` because the getter traps 0, plus the inaccurate bounds comment (`configServiceImpl.ts:115-117`); no new keys
- [x] Intentional trap sites preserved as explicit clamps: ingest backfill semaphores (`ingest/app/config/watcher.py:185,208`); analysis call sites documented as intentional (`servicer.py:790`, `:1152`, `:2913`)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Go and Node config getters (not reported as trapped)
- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
