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

## Session 2026-08-31 — sdd-design

- **Phase 0 Recon**: wrote `recon.md` (services: xstockstrat-ui [code-bearing], + read-only ledger/portfolio/trading/config). Key reuse patterns: one-shot `GetConfig` via a BFF `ConfigService` registration (`traderBff.ts:143-149`) read with the oneof-`case` presence check (`positions/page.tsx:132-133`); ledger `queryEvents` with a server-forced `stream_key` IDOR guard (`traderBff.ts:117-126`); recharts + `ui/chart.tsx` insights equity-curve idiom (`EquityCurveChart.tsx`); `AccountContext.environmentMode`/`TradingModeBadge` for the paper/live label.
- **Config-consumption decision (the load-bearing question)**: the UI has **no `WatchConfig` consumer anywhere** (grep of `src` returned only `GetConfig`/`listKeys`/`setConfig`) — it is a stateless request/response BFF and cannot hold a server stream. `ui.performance.*` is read via **one-shot `GetConfig`** through a new `insightsBff.ts` `ConfigService { getConfig }` registration. The metric math therefore **stays in the UI/BFF**; no new backend RPC / no math relocation needed for the config reason.
- **Phase 1 Grilling**: 2 rounds, full mode (self-run in this isolated subagent — no live `AskUserQuestion`/`Task`; per fails.md 2026-08-08 the forks are surfaced to the operator as provisional). Chosen approach: UI/BFF-computed equity curve from `portfolio.position.closed` ledger events (`realized_pnl`), realized-only by construction (C-5); drawdown $/% off the cumulative peak; rolling-30d Sharpe with a non-finite guard; recharts/`ui/chart.tsx` chart with `Brush` zoom + date picker + 60s poll. Rejected: lightweight-charts (trader-OHLCV canvas engine, oklch trap 146), WatchConfig subscription, backend RPC / math relocation, BFF fill-pairing reconstruction.
- **DECISIVE recon finding (072/080 producer trap)**: the `portfolio.position.closed` payload is only `{user_id, symbol, account_id, trading_mode, realized_pnl}` (`portfolio_service.go:304-307`) — it carries realized P&L but **no cost basis, qty, or open timestamp**, so FR-4's **avg-return-% and avg-hold-time are NOT derivable from the ledger event**. Carried as Open Risk R1 — operator decision: defer the two stats to a **named** V2 follow-up (C-14), or additively extend the portfolio producer (making this no longer zero-backend-change). Do not ship placeholder values.
- **Other open risks**: R2 Sharpe daily-returns basis (dollar Δ vs % of an equity base — pin the reference formula, may need `GetPnL`); R3 config map-key slicing (confirm `namespace:'ui'` → `values['performance.*']` against real keying); R4 FR-5 poll interval declared "configurable" with no key (ship 60s client constant).
- **Constitution rules touched**: C-05, C-10(a), C-12/C-13, C-14, C-16 (net-new; PRESERVE the `portfolio.position.closed` key-set contract + header-identity IDOR guard), C-17; P-02; F-04, F-07 (config sourced via `GetConfig`, not hardcoded — no Floor breach), F-06 (untouched). **Floor breaches: none.**
- Status: unchanged (this run writes only `recon.md` + `design.md` + this note; the `spec-ready` → `design-approved` flip and `feature.md`/`status.md` updates are deferred to the operator-confirmed design gate).
