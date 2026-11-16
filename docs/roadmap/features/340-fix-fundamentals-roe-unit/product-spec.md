# Product Spec: fix-fundamentals-roe-unit

**Type**: bug
**GitHub Issue**: n/a (Issues disabled) — report `docs/reports/2026-11-15-marketdata-roe-value-implausible-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-15

---

## Problem Statement

The symbol page shows `ROE +366.34%` for LYFT beside market cap `$6,726,553,623.93`, `P/B 8.77`,
`EPS 0.11`. The UI multiplies by 100, so marketdata served `roe ≈ 3.6634`. Market cap / P/B implies
book equity near $767M; EPS 0.11 implies net income in the tens of millions — an ROE in the low
single-digit percent. Expected: `roe` is a 0–1 fraction on every provider path.

## Reproduction Steps

1. Staging: `GetFundamentals` (or the symbol page Fundamentals card) for LYFT.
2. Compare `roe` with `market_cap`, `pb_ratio`, `eps`.

## Root Cause Hypothesis

Under investigation — see context.md. Suspected: one provider/merge path stores ROE in percentage
points without the `scale100` conversion (`internal/finnhub/finnhub_client.go:260` applies it; other
paths not traced). The proto field `double roe = 8` carries no unit comment.

## Affected Services

- `xstockstrat-marketdata`

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
