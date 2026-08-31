# Context: strategy-performance-dashboard

**Feature**: `docs/roadmap/features/031-strategy-performance-dashboard/feature.md`
**Product Spec**: `docs/roadmap/features/031-strategy-performance-dashboard/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/031-strategy-performance-dashboard/implementation-spec.md`

---

## Session 2026-05-26T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from brainstorming session.
- Feature number assigned: 031.
- No proto or schema changes — read-only queries against existing ledger and portfolio RPCs.
- Key design decision: daily returns computed from ledger fill events (event-driven), not from daily snapshot infra.
- Two open questions deferred to impl-spec: return computation method confirmation, charting library selection (reuse feature 014's choice).
- Practical dependency: needs 10+ closed paper trades for meaningful statistics.

## Session 2026-08-31 — sdd-story (in-place regenerate)

- Regenerated `product-spec.md` to the current template (in place; kept feature number **031** and the
  directory — no renumber). All original scope preserved: equity curve, max drawdown, rolling 30-day
  Sharpe, summary stats, auto-refresh, date-range picker, paper-trading label, and the two config keys
  `insights.performance.risk_free_rate_annual` (default 0.045) + `insights.performance.equity_curve_start_date`.
- Aligned Affected Services to exact registry names: `xstockstrat-insights` → `xstockstrat-ui` `/insights`
  segment (the standalone insights service was consolidated into `xstockstrat-ui` by feature 045);
  ledger + portfolio (`GetPnL`) remain read-only. Added the C-14 Consumer Surface section (UI).
- Authored `acceptance.feature`: 10 `@AC-*` scenarios covering all 8 FRs (concrete values — 10 closed
  paper trades, risk-free rate 0.045, max drawdown -12.4%, "Paper Trading" label at TRADING_MODE=paper).
  Moved the old inline numbered Acceptance Criteria list into it; product-spec now points at it (C-15).
- Folded ledger traps into Open Questions as one-line "Known trap" notes: single charting engine
  (146), `get_float_present` for a stored 0.0 risk-free rate, zero-variance Sharpe → non-finite guard
  (072), and C-10(a) nav reachability (060). Status stays `draft`.
