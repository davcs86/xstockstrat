# Product Spec: fix-after-hours-positions-priced

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-19-after-hours-one-sided-quote-half-price-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-19

---

## Problem Statement

**Observed.** After the 16:00 ET close on 2026-10-19, staging `get_positions` priced quote-enriched positions
at about 45–50% of market value. For example, MSFT 534.575 → 250.705 and LYFT 17.055 → 8.025, while the
broker-synced LYFT position read 16.98 at the same moment. Unrealized P&L flips sign as a result.
Symbols that still had a two-sided quote stayed correct.

**Expected.** A quote with one side missing (≤ 0) is never averaged. The consumer either uses a usable price
or leaves the position unenriched (`current_price` 0), consistent with feature 229's "no fabricated value"
contract. This holds for every quote consumer: position enrichment, the persisted equity snapshot, the
risk/concentration valuation and the fundamentals price overlay.

## Reproduction Steps

1. Hold a position in an offline account (no broker price) in a symbol whose IEX quote goes one-sided after the close.
2. After 16:00 ET, call MCP `get_positions` (or open Book → Portfolio).
3. The position's `current_price` is about half the last trade.

## Root Cause Hypothesis

Five sites compute `(ask + bid) / 2` and reject only a non-positive *sum*:

- `services/xstockstrat-portfolio/internal/service/portfolio_service.go:457` (`applyQuotes`) and `:548` (`enrichPosition`);
- `:841` (equity snapshot, no guard);
- `:908` (risk valuation, no guard);
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go:1740` (`livePrice`).

The warm poller caches the one-sided after-hours quote every 30s, so every read returns it. The raw cached
quote has not been inspected yet. Design should confirm which side is zero and whether the feed's
last-trade price is available as a fallback.

## Affected Services

- xstockstrat-portfolio
- xstockstrat-marketdata

## Fix Scope

- [ ] No proto changes anticipated (confirm in design: a "price" field on `Quote` would be a proto change)
- [x] No database migrations anticipated
- [x] No config key changes anticipated

(Update after investigation; remove or replace each item as needed.)

## Acceptance Criteria

See `acceptance.feature`: the regression scenarios must fail on the buggy behavior and pass after the fix
(Constitution **C-15**). Also, existing tests pass and the affected services are smoke-tested on dev after
the close.

## Out of Scope

- Refactoring unrelated to the bug
- Quote timeout investigation (folded into feature 226 by the operator, 2026-10-19)
- Performance improvements unrelated to the fix
