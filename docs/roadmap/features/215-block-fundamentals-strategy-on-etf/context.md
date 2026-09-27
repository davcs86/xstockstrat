# Context: block-fundamentals-strategy-on-etf

**Feature**: `docs/roadmap/features/215-block-fundamentals-strategy-on-etf/feature.md`
**Product Spec**: `docs/roadmap/features/215-block-fundamentals-strategy-on-etf/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/215-block-fundamentals-strategy-on-etf/implementation-spec.md`

---

## Session 2026-09-27 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from the user
  story ("no strategy that requires fundamentals run against an ETF").
- **Origin:** surfaced during the feature-211 @AC-5 rollout audit. Live staging run confirmed the
  behavior: `trigger_backfill(["SCHD"], data_kind=fundamentals)` returned `PARTIAL` with
  `failed_symbols: ["SCHD"]`; `query_fundamentals("SCHD", historical)` returned `periods: []`; and
  under `snapshot_source=edgar`, `query_fundamentals("SCHD", snapshot)` fell back to `source:
  "finnhub"` with all EDGAR-derived metrics (market_cap/pe/pb/roe/debt_to_equity/dividend_yield)
  missing. So `fundamentals_macd_blend`'s `fscore.composite > 0.5` gate can never evaluate true on
  SCHD → a silent no-trade that reads like a real no-signal.
- **User decision:** "Enforce it (SDD feature)" (AskUserQuestion) — a documented-only guardrail was
  offered but the operator chose code enforcement, so this goes through the full SDD pipeline rather
  than a docs note.
- **Key open design fork recorded in product-spec Open Questions:** Alpaca `asset_class` is
  `us_equity` for both stocks and ETFs, so "detect ETF via ListAssets assetClass" is not directly
  implementable. Options: (a) guard on fundamentals-unavailability (root cause), (b) vendor
  `type=="ETF"` profile field, (c) maintained ETF set.
- **Operator decision on the fork:** explicitly **left to `/sdd-design`** — the operator declined to
  pre-select an approach (briefly indicated (b), then reverted to "leave the design to decide"). The
  product spec's Open Question therefore states the options with **no recommendation**, so the
  proposer/adversary debate chooses unbiased.
- Reviewer snapshot (registry): analysis (backtest determinism / no look-ahead), marketdata
  (asset-class / fundamentals-availability source of truth), ui+agent (reason surfaced truthfully).
- Ledger trap noted (fails.md 2026-08-13, feature 129): verify the fundamental-operand detector
  against the real strategy/formula shapes and prove the guard on a real ETF run (SCHD), not stubs.
