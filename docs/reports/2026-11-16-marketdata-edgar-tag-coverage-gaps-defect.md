# Defect: EDGAR fundamentals have no net income or ROE for filers that report under tags the derivation does not read

**Recorded**: 2026-11-16
**Severity**: SEV-3
**Impact type**: missing-fundamentals
**Environment**: staging (homelab, main-dev)
**Affected service(s)**: xstockstrat-marketdata
**Config-only fix possible**: no

## Observed

The feature 340 homelab audit (`docs/roadmap/features/340-fix-fundamentals-roe-unit/audit-lane-a-homelab.md`)
listed two groups that predate feature 340:

- 11 symbols with no quarterly net income on any stored row: JEF, BMO, ETR, SABR, TXNM, AVGO, FMS,
  BE, RAIL, TRIN, VG.
- 13 symbols with no `roe` on the latest quarter: CARR, ET, MTRX, PFSI, FOXF, CCI, ASTS, KMX, SNOW,
  HSY, UWMC, USAR, AVPT.

Checked on 2026-11-16 against live SEC companyfacts for three symbols of each group, derived through
`FetchHistorical` on `main-dev`:

| Symbol | Derived rows | What the filing carries |
|---|---|---|
| AVGO | 21 of the quarterly rows have no net income | `NetIncomeLoss` quarterly facts stop at 2019-08-04; `ProfitLoss` runs to 2026-08-02. `StockholdersEquity` stops at 2019-11-03; `StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest` runs to 2026-08-02 |
| JEF | 20 quarterly rows have no net income | `NetIncomeLoss` stops at 2023-08-31; `ProfitLoss` and `NetIncomeLossAvailableToCommonStockholdersBasic` continue |
| BMO | 22 quarterly rows have no net income, no equity | IFRS filer: `ifrs-full` `ProfitLoss`, `ProfitLossAttributableToOwnersOfParent`, `Equity` (CAD); no `us-gaap` namespace at all |
| CARR | net income present, equity absent on every recent row | `StockholdersEquity` has 2 facts, the last dated 2020-03-31; the equity-including-NCI tag runs to 2026-09-30 |
| HSY | equity present only on annual rows | `StockholdersEquity` is tagged in the 10-K only (last 2025-12-31); the 10-Q balance sheets use the equity-including-NCI tag |
| SNOW | equity absent from `Q1-2027` on | `StockholdersEquity` stops at 2026-01-31; the equity-including-NCI tag continues |

The other symbols of each group were not checked individually.

## Expected

A filer whose income statement or balance sheet reports the same economic quantity under another
standard tag still gets `net_income`, `stockholders_equity` and the ratios derived from them; or the
gap is a documented, deliberate limit of the EDGAR lane.

## Reproduction

1. Fetch `https://data.sec.gov/api/xbrl/companyfacts/CIK0001730168.json` (AVGO).
2. Derive it through `edgar.Client.FetchHistorical`; every quarterly period after 2019 has no
   `net_income` in `extra_metrics` and a nil `roe`.

## Evidence

`services/xstockstrat-marketdata/internal/edgar/edgar_client.go:188`
> "NetIncomeLoss": "net_income",

`services/xstockstrat-marketdata/internal/edgar/edgar_client.go:196`
> "StockholdersEquity":                 "stockholders_equity",

`services/xstockstrat-marketdata/internal/edgar/edgar_client.go:201-202`
> // Financial-debt line items (feature 211, FR-2) — us-gaap only; summed no-double-count in
> // buildPeriod. All three acceptance filers report us-gaap (no IFRS tags — C-18).

## Root cause hypothesis

The tag vocabulary maps one tag per quantity (`NetIncomeLoss`, `StockholdersEquity`). Filers with a
non-controlling interest tag `ProfitLoss` and equity including NCI on some or all filings, and IFRS
filers use the `ifrs-full` taxonomy; those facts are ignored, so the value is absent (never
fabricated). Which substitute tags are economically equivalent (parent-only versus including NCI) is
a design question, not settled here.

## Confidence

high for the six symbols checked; low for the other eighteen (not individually checked)
