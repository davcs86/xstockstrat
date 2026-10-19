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
- xstockstrat-config (SetConfig bounds rows for the two new keys; added at design)
- packages/proto (additive `Quote.mark_price`; added at design)

## Functional Requirements (added at design, 2026-10-19; see design.md)

FR-1. `GetLatestQuotes` sets `Quote.mark_price` (new additive proto field 8):
  - to the two-sided mid when ask > 0 and bid > 0;
  - otherwise to the newest stored 1d close > 0 no older than `marketdata.quotes.mark_close_max_age_hours`
    (default 168);
  - otherwise it leaves the field unset.
  Raw `ask_price` and `bid_price` are unchanged, and a one-sided quote is never averaged.
FR-2. The close lookup runs concurrently with the cold fetch under `marketdata.quotes.mark_timeout_ms` (default 500).
  On failure, two-sided marks are kept, one-sided marks stay unset, and a WARN is logged.
FR-3. Every portfolio read path values a non-broker position the same way: `mark_price`, else the two-sided mid,
  else unpriced (`current_price` 0). The broker price always wins.
FR-4. The equity snapshot values positions as Σ market value, broker price first. It is skipped, with a WARN naming
  the symbols, when any position is unpriced or quotes are unavailable.
FR-5. Concentration sums each symbol across accounts, broker price first. It is skipped, with a WARN naming the
  unpriced symbols, when any position is unpriced. Drawdown is unchanged.
FR-6. The EDGAR snapshot price is the quote mark, else the filed-date close. A missing mark is served uncached.
  `GetFundamentalsMulti` prices its pending symbols with one `GetLatestQuotes` call.
FR-7. GetPnL fails UNAVAILABLE when a needed position has no mark and no two-sided mid (preserves 229 AC-5).

## Consumer Surface(s)

Read-only value correction; no UI or agent code change. These now show mark-based prices after hours:
- agent MCP `get_positions`, `get_positions_by_account_id`, `get_fundamentals` (EDGAR mode);
- `/trader` Book → Portfolio (ListPortfolios / GetPnL);
- `/insights` P&L reads.

The persisted equity snapshot and concentration alerts are background effects.

## Fix Scope

- [x] Proto change: additive `optional double mark_price = 8` on `marketdata.v1.Quote` (non-breaking; C-09)
- [x] No database migrations
- [x] Config keys (new, unseeded, SetConfig-bounded): `marketdata.quotes.mark_timeout_ms` (500, [100,2500]),
  `marketdata.quotes.mark_close_max_age_hours` (168, [120,720])
- Rollout: operator purge of edgar cache rows in `marketdata.fundamentals`, after the marketdata deploy (design.md §5)

## Acceptance Criteria

See `acceptance.feature`: the regression scenarios must fail on the buggy behavior and pass after the fix
(Constitution **C-15**). Also, existing tests pass and the affected services are smoke-tested on dev after
the close.

## Out of Scope

- Refactoring unrelated to the bug
- Quote timeout investigation (folded into feature 226 by the operator, 2026-10-19)
- Performance improvements unrelated to the fix
