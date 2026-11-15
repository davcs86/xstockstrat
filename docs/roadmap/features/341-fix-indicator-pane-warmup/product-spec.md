# Product Spec: fix-indicator-pane-warmup

**Type**: bug
**GitHub Issue**: n/a (Issues disabled) — report `docs/reports/2026-11-15-indicator-panel-sma200-single-point-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-15

---

## Problem Statement

A trader viewing the symbol page (trader segment → symbol page → Overview) with indicator set
`dip_buyer_vol_stop` on LYFT sees the SMA200 pane as a single dot near 15.07 (the live `sma200`
value is 15.07125) instead of a line. The trader cannot read the trend of any indicator whose
lookback is close to or longer than the charted window, and nothing tells them why.

## Reproduction Steps

1. Staging, symbol page for LYFT → Overview.
2. Select the `Quality Dip Buyer + Volatility Stop` indicator set; observe the SMA200 pane.

## Root Cause Hypothesis

**Not traced** (report confidence: low). The component series appears to be computed over only the
displayed window's bars, so a 200-period average yields its first value on the last bar.
`services/xstockstrat-ui/src/lib/indicatorChart.ts:27-37` maps unset values to gaps and has no
warm-up handling; the series comes from the analysis `GetIndicatorSeries` RPC
(`packages/proto/analysis/v1/analysis.proto`), whose builder is not traced.

Operator decision (2026-11-15, binding): `/sdd-design` recon must determine whether the missing
warm-up prefix is in the UI request or in the analysis series builder **before any fix is
designed**. The requirements below are stated as observable behavior and hold wherever the cause is.

## Functional Requirements

Terms: **P** = the indicator's lookback, the number of bars needed to produce its first value (SMA
with period 200 → P = 200). **W** = the number of bars in the charted window. **H** = the number of
ingested bars for the symbol and timeframe up to and including the window's last bar.

- **FR-1 — Warm-up rendering.** A charted bar shows an indicator value whenever at least P bars of
  history exist up to and including that bar, regardless of whether those bars fall inside the
  charted window. Consequences:
  - H ≥ P + W − 1 → the series has a value on every one of the W charted bars (P = 200, W = 190
    needs H ≥ 389; 400 bars satisfy it).
  - P ≤ H < P + W − 1 → the series has values on the latest H − P + 1 charted bars and a gap on
    the earlier ones (the existing "unset → gap, never a fabricated 0" contract). H = P gives a
    value on the last charted bar only.
- **FR-2 — Insufficient-history state.** When H < P, so that no charted bar can have a value, the
  indicator's pane shows the text "Not enough history" and draws no series (P = 200, H = 150).
  The state applies per indicator: other indicators in the same set whose lookback is satisfied
  render normally under FR-1.

Which applies: FR-2 if and only if H < P; otherwise FR-1.

## Affected Services

- `xstockstrat-ui` — trader symbol page indicator panes (`src/components/trader/IndicatorPanels.tsx`,
  `src/lib/indicatorChart.ts`, `src/hooks/useIndicatorSeries.ts`).
- `xstockstrat-analysis` — owner of the `GetIndicatorSeries` RPC that builds the series. Whether its
  code changes is decided by recon (see Root Cause Hypothesis).

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` segment `/trader`: symbol page → Overview indicator panes. Changed
  output only (full-window series per FR-1; "Not enough history" pane state per FR-2). No new
  page, route or nav entry.
- [ ] **Agent** — not applicable: no `xstockstrat-agent` MCP tool calls `GetIndicatorSeries` or
  returns indicator chart series (`services/xstockstrat-agent/app/` has no reference to it).

`GetIndicatorSeries` is consumed only by the trader symbol page (through the UI BFF handler map,
`src/lib/insightsBff.ts`). If recon finds another caller, FR-1 and FR-2 apply to it as well (C-10).

## Fix Scope

- **Proto**: none anticipated. If recon shows FR-1 or FR-2 needs a contract change (for example a
  warm-up request field or an insufficient-history marker on `GetIndicatorSeries`), it must be
  **additive** (new field, non-breaking) and follows the additive gate in
  `docs/runbooks/proto-versioning.md`; a breaking change is out of scope for this fix.
- **Database**: no migration. The fix reads bars that are already ingested.
- **Config**: no new or changed config key.

## Resolved Questions

- [x] Warm-up prefix **or** insufficient-history message? Both: the report's two alternatives cover
  disjoint cases, split by the rule under Functional Requirements (resolved in product-spec review,
  2026-11-15).
- [x] Where is the root cause? Unknown at spec time; assigned to `/sdd-design` recon by the operator
  decision above. The spec does not depend on the answer.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Backfilling or fetching additional bars for a symbol with H < P — FR-2 reports the shortfall, it
  does not repair it.
- Changing indicator calculation semantics (formula results on bars that already have a value).
- Indicator series colors and pane styling (peer feature `chart-series-palette`).
- A breaking proto change, any database migration, any config key.
- Refactoring or performance work unrelated to the fix.
