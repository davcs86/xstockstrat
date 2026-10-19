# Context: offline-account-full-pnl

**Feature**: `docs/roadmap/features/230-offline-account-full-pnl/feature.md`
**Product Spec**: `docs/roadmap/features/230-offline-account-full-pnl/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/230-offline-account-full-pnl/implementation-spec.md`

---

## Session 2026-10-19 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Scope fixed by operator Q&A (2026-10-19), before any spec was written:
  - Components: Day P&L, Total P&L + return %, fees/commissions. Offline P&L in the `GetPnL`/insights
    aggregate was offered and **not selected** → out of scope.
  - Fee model: **separate line**; realized shown gross and net; fees never enter cost basis.
  - Day P&L: **broker-style** (overnight shares vs previous close, same-session shares vs fill price,
    plus same-session realized).
  - Return % denominator: **open cost basis** (no capital-base ledger).
  - Mark fallback: **latest daily-bar close, flagged stale**.
  - Surfaces: PortfolioPanel (single + combined), Book offline card, positions list + detail, MCP agent tools.
  - Backfill: fees default 0; lifetime realized seeded from the current since-snapshot value; no reconstruction.
- **Operator override of feature 163 (explicit sign-off, 2026-10-19):** operator chose "Both" for
  realized scope, i.e. keep 163's since-snapshot reset (163 AC-14 preserved) **and** add a lifetime
  realized carried across snapshots. This overrides 163's rejected alternative "carry realized forward
  across snapshots". Fees on snapshot baselines are not part of the override.
- Baseline grounding (recon by Explore agent): offline Day P&L hard-coded 0 at
  `services/xstockstrat-trading/internal/service/trading.go` (`recomputeAndEmitOfflinePositions`);
  `ConfirmOrderRequest` has no fees field (`packages/proto/trading/v1/trading.proto:158-164`);
  `Portfolio.realized_pnl` is offline-only `optional` field 12 (`packages/proto/portfolio/v1/portfolio.proto:59-62`);
  realized stored in `portfolio.offline_account_realized` (portfolio migration 012); short
  `unrealized_pnl_pct` is 0 because it is only set when `CostBasis > 0`.
