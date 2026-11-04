# Product Spec: fix-marketdata-dead-symbol-ingest

**Type**: bug
**Defect report**: `docs/reports/2026-11-04-marketdata-bar-ingest-dead-symbols-refetched-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-04

---

## Problem Statement

`bar ingest: symbols returned no bars` fires on essentially every ingest cycle for the same small set, 206-287 lines per day. The symbols are never demoted, so the vendor is called and a WARN logged for each, forever.

## Reproduction Steps

1. Query staging marketdata logs for `bar ingest: symbols returned no bars` on any day.
2. The same `sample` repeats each cycle.

## Root Cause Hypothesis

Under investigation. The warm set has no eviction for symbols without data and the feature 282 OTC filter does not cover these. LXP and PSKY look like live listings, so the vendor/feed cause (IEX coverage, renamed tickers) must be established in recon. May also feed analysis live_loop 'had no 1d bars' WARNs.

## Affected Services

xstockstrat-marketdata

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
