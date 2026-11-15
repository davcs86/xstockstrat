# Product Spec: fix-fundamentals-roe-unit

**Type**: bug
**GitHub Issue**: n/a (Issues disabled) — report `docs/reports/2026-11-15-marketdata-roe-value-implausible-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-15

---

## Problem Statement

A trader reading the symbol page Fundamentals card for LYFT on staging sees `ROE +366.34%` beside
market cap `$6,726,553,623.93`, `P/B 8.77`, `EPS 0.11`. The UI multiplies by 100, so marketdata
served `roe ≈ 3.6634`. Market cap / P/B implies book equity near $767M; EPS 0.11 implies net income
in the tens of millions — an ROE in the low single-digit percent. The same `roe` value feeds the
agent fundamentals tools and the analysis screener/scoring, so a strategy author filtering on ROE is
misled too. Expected: `roe` is a 0–1-scale fraction (net income / shareholders' equity; `0.0366` =
3.66%) on every provider path, and agrees with the symbol's own net income and equity.

## Reproduction Steps

1. Staging: `GetFundamentals` (or the symbol page Fundamentals card) for LYFT.
2. Compare `roe` with `market_cap`, `pb_ratio`, `eps`.

## Root Cause Hypothesis

**Not traced** — recon must trace it before any fix is designed (Open Question 1). The report's
"missing percent→fraction conversion" is one candidate, not a premise. Producers of `roe`:

- Finnhub — `internal/finnhub/finnhub_client.go:260` already applies `scale100` to `roeTTM`
  (covered by `finnhub_client_test.go:118`).
- FMP — `internal/fmp/fmp_client.go:481` passes `returnOnEquityTTM` through unscaled.
- EDGAR — `internal/edgar/edgar_client.go:491` (quarterly TTM, `annualizeQuarterlyROE`, feature 222)
  and `:560` derive net income / equity; a wrong numerator or denominator would also yield 3.66.
- Merge / storage / read — `internal/service/marketdata_service.go:2070`, `:2202`, `:2609`;
  `internal/repository/marketdata_repo.go`.

The proto fields `double roe = 8` (`Fundamentals`) and `double roe = 13`
(`HistoricalFundamentalsPeriod`) carry no unit comment.

## Functional Requirements

- **FR-1** — `Fundamentals.roe` returned by `GetFundamentals` and `GetFundamentalsMulti` is a
  fraction (net income / shareholders' equity; 3.66% is `0.0366`) on every provider and merge path
  that can populate it (Finnhub, FMP, EDGAR-derived).
- **FR-2** — The path that produced `roe ≈ 3.6634` for LYFT is corrected for whichever cause recon
  identifies (unit conversion, or a wrong net-income/equity input), so the served value equals that
  path's own net income divided by its own shareholders' equity.
- **FR-3** — `HistoricalFundamentalsPeriod.roe` returned by `GetHistoricalFundamentals` obeys the
  same unit contract as FR-1 (read-path parity, C-10(b)).
- **FR-4** — A provider that reports no ROE still yields an unset `roe` (`0` on the wire), and a
  negative ROE keeps its sign; the fix fabricates and clamps nothing.
- **FR-5** — A wrong `roe` already stored before the fix is not served after it: once the fix is
  deployed, LYFT on staging returns the corrected value.

## Affected Services

- `xstockstrat-marketdata`

## Fix Scope

- Proto changes anticipated: **yes, comment-only** — a unit comment on `roe = 8` and `roe = 13` in
  `packages/proto/marketdata/v1/marketdata.proto`. No field, number or type changes (additive,
  `buf breaking`-safe); regenerate stubs in the same PR.
- DB migrations anticipated: **no** — no schema change. If the traced path persists the wrong value
  (FR-5), it is corrected by re-derivation through the existing mechanism (EDGAR
  `DerivationVersion` bump / `BackfillFundamentals`), not a SQL migration. If recon shows a
  migration is unavoidable, design stops and escalates to the operator.
- Config key changes anticipated: **no** — no key is read, added or changed.

## Open Questions

1. ~~Which path produced `roe ≈ 3.66` for LYFT?~~ — **Decided 2026-11-15 (operator):** root cause is
   not traced; recon must trace which provider or merge path produced `roe ≈ 3.66` for LYFT on
   staging before any fix is designed. Once traced, design pins the `Given` of `@AC-1` / `@AC-5` to
   that path and its native input unit; the `Then` values are binding and may not be weakened.

## Consumer Surface(s)

No consumer code changes — each surface already treats `roe` as a fraction and is corrected by the
marketdata fix alone:

- **UI** — `xstockstrat-ui` trader segment, symbol page Fundamentals card
  (`src/app/trader/positions/[symbol]/page.tsx`; `src/lib/money.ts` multiplies by 100).
- **Agent tools** — the fundamentals query/screen tools that expose the `roe` metric
  (`services/xstockstrat-agent/app/tools.py:324`, `:1004`).

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- UI display changes — the ×100 formatting in `money.ts` is correct for a fraction
- Changing the EDGAR quarterly-TTM ROE semantics of feature 222, unless recon traces the defect there
- Unit audits of other fundamentals metrics (`dividend_yield`, `debt_to_equity`, …)
- Changes to how analysis screening/scoring or indicators consume `roe`
- Refactoring unrelated to the bug
