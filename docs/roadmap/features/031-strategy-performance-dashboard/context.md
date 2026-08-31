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

## Session 2026-08-31 — sdd-review fixes (product-spec)

Applied the `/sdd-review` product-spec findings (FAIL on C-05 + warnings). Status stays `draft`.

- **Config keys → `ui.performance.*` (C-05 BLOCKER).** Renamed `insights.performance.risk_free_rate_annual`
  (default 0.045) and `insights.performance.equity_curve_start_date` to the `ui.performance.*` namespace —
  the `insights.*` prefix named a service that no longer exists (consolidated into `xstockstrat-ui` by
  feature 045; `ui` is the config short-name). Committed the **UI-computed** path (preserves the original
  "no proto changes" intent): the equity-curve / drawdown / rolling-Sharpe math runs in the
  xstockstrat-ui BFF/lib, reading ledger events + portfolio `GetPnL` over existing RPCs. Added a
  config-consumption-path Design-Phase Decision (WatchConfig subscription vs a `GetConfig` BFF read).
- **Paper/live re-gate → `GetTradingEnvironment` (FR-8, AC-9, AC-10).** `TRADING_MODE` was removed by
  feature 147; paper/live is derived from environment. Rewrote FR-8 and AC-9/AC-10 to gate the "Paper
  Trading" label on the environment-derived mode via the existing `GetTradingEnvironment` RPC (already
  used in `traderBff.ts` / `AccountContext.tsx`). Concrete values: staging → label shown; production →
  label not shown. Added `xstockstrat-trading` to Affected Services as read-only existing reuse.
- **Realized-only equity curve (C-5).** Added a note: only fully-closed (realized) positions feed the
  equity curve and all derived metrics; open/partially-filled positions are excluded; fill-lifecycle
  handling is unaffected.
- **Dropped the Python `get_float` trap (warning).** The consumer is Node/UI, not a Python service.
  Removed the Python-consumer implication (no `xstockstrat-analysis` added to Affected Services) and
  reframed the zero-vs-absent config concern as a Node/JSON Design Guardrail; likewise reframed the
  non-finite Sharpe guard for Node (`JSON.stringify` → `null`).
- **Open Questions reorganized (criterion 9).** No unchecked genuine-unknown `- [ ]` remains under
  `## Open Questions` (now "None — moved to Design-Phase Decisions below."). Moved the two design
  questions (event-driven daily returns from ledger fills; charting-library reuse — feature
  146/lightweight-charts) plus the new config-consumption-path decision into
  `## Design-Phase Decisions (owned by /sdd-design)`; the remaining known traps became
  `## Design Guardrails`.

## Session 2026-08-31 — sdd-review product-spec (approved)

- Product spec approved: `draft` → `spec-ready`. All `/sdd-review` blockers and warnings were addressed (see the sdd-review-fixes session above).
- NOTE: the confirming re-review pass was interrupted by a session usage/rate limit; fixes were applied against each reviewer's explicit findings. For 021 specifically, the orchestrator manually caught and fixed a residual field-name error (`service_origin` → `source_service`; the ledger `Event` has no `user_id` field). A quick re-review can re-confirm on resume.
