# Product Spec: fix-ctx-cancel-warn-flood

**Type**: bug
**Defect report**: `docs/reports/2026-11-04-portfolio-marketdata-warn-flood-after-ctx-cancel-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-04

---

## Problem Statement

When a ledger stream is canceled mid-handler, `ConsumePositionSyncs` continues its per-position loop with a dead context: `upsert position from sync failed` (2,770) and `delete positions not in sync failed` (545), all `context canceled`, in 9 hourly bursts. Marketdata shows `GetBars: cache insert failed - begin tx: context canceled` (557) and `warm poller: cache insert failed`.

## Reproduction Steps

1. Restart or deploy the ledger while portfolio processes an `account.positions.synced` event.
2. Observe one WARN per position plus one for the delete, all `context canceled`.

## Root Cause Hypothesis

No `ctx.Err()` short-circuit in the per-item loops (`portfolio_service.go:1420-1430`) or cache-insert paths (`marketdata_service.go:371`). The event is redelivered by `boundedRetry`, so this is log noise plus wasted DB calls, not data loss. Deploy correlation inferred from timestamps. The two services are independent fix sites.

## Affected Services

xstockstrat-portfolio, xstockstrat-marketdata

## Fix Scope

- [ ] No proto changes anticipated
- [ ] No database migrations anticipated
- [ ] No config key changes anticipated

(Update after investigation — remove or replace each item as needed)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
