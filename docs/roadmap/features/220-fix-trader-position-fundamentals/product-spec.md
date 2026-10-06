# Product Spec: fix-trader-position-fundamentals

**Type**: bug
**GitHub Issue**: n/a — defect report `docs/reports/2026-10-06-ui-fundamentals-infinite-loading-defect.md`
**Severity**: SEV-3
**Created**: 2026-10-06

---

## Problem Statement

Observed: on `/trader/positions/AXP` (staging) the Fundamentals card shows "Loading fundamentals…"
and never resolves, while the backend answered `GetFundamentals(AXP)` promptly over gRPC and staging
was degraded at the time.

Expected: a stalled or slow `GetFundamentals` call terminates within a bounded deadline and the card
falls through to its existing error branch ("No fundamentals data for <symbol> — <reason>",
`page.tsx:1054-1058`) instead of loading forever.

## Reproduction Steps

1. Make `xstockstrat-marketdata` `GetFundamentals` (or the BFF hop) stall.
2. Open `/trader/positions/<held symbol>`.
3. The Fundamentals card stays on "Loading fundamentals…"; no error is ever surfaced.

## Root Cause Hypothesis

No deadline at any hop: `traderBff.ts:76` forwards `getFundamentals` without `timeoutMs`
(`bffShared.ts:70` only applies one when passed) and the browser transport sets none, so a hung
upstream never rejects and React Query's `isLoading` never clears. `insightsBff.ts:55`
(`timeoutMs: 30_000`) is the in-repo precedent for a bounded BFF call.

## Affected Services

xstockstrat-ui

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
- Diagnosing why staging `GetFundamentals` was slow at the time (backend latency is a separate concern)
