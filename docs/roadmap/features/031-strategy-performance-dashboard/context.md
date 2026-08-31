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

## Session 2026-08-31 — design revision (R1 operator decision: extend the portfolio producer now)

**Confirmed operator decision:** resolve Open Risk R1 via option (b) — additively extend the
`xstockstrat-portfolio` producer NOW so avg-return-% and avg-hold-time ship in V1. This overturns the
prior "UI-only / zero-backend" framing. Revised `design.md`, `product-spec.md`, `acceptance.feature`
(this note is the `context.md` record). `status.md` and code untouched.

**Investigation result (the load-bearing finding).** The position row already tracks everything the two
stats need at close — **no migration**:
- `portfolio.positions` defines `cost_basis` and `opened_at` (`NOT NULL DEFAULT NOW()`) in migration
  `001_portfolio_hypertable.up.sql`; `qty` and `avg_entry_price` are there too.
- At the full-close emit, `existing` (fetched `portfolio_service.go:262`) is a `*portfoliov1.Position`
  carrying `CostBasis` (`portfolio_repo.go:269`) and `OpenedAt` (`portfolio_repo.go:270`, RFC3339-able).
- The emit `portfolio_service.go:304-307` writes a `google.protobuf.Struct` payload via
  `emitEvent`/`structpb.NewValue` (`:790-795`) — so adding keys needs **no proto change** (mirrors
  feature 029's additive `fees`). `structpb.NewValue` rejects `time.Time`, so `opened_at` is emitted as
  an RFC3339 string (the `as_of` precedent, `:842-844`).

**Fields added to the `portfolio.position.closed` payload:** exactly **two** — `cost_basis` (JSON number,
from `existing.CostBasis`) and `opened_at` (RFC3339 string, from `existing.OpenedAt`). `qty` /
`avg_entry_price` deliberately **not** added (neither stat needs them — minimalism). `closed_at`
deliberately **not** added — the event's producer-stamped `OccurredAt` (`portfolio_service.go:800`) is
already the close time and the equity-curve ordering key, so avg-hold-time = `occurred_at − opened_at`.
Guarded by `existing != nil`: the redelivered-post-close edge omits both keys.

**Migration:** none needed. Next-free portfolio NNN would be `014` but is **not** consumed here.
**Proto change:** none (additive Struct keys). **Existing 5 keys preserved** → analysis P&L-pattern
consumer unaffected (C-16 additive-extend).

**Decisions / notes surfaced:**
- FR-4 avg-hold-time unit changed **hours → days** to match the operator's confirmed example
  (2026-02-01 → 2026-02-11 = 10 days); reversible one-line display divisor if hours preferred (R6).
- avg-return-% = `mean(realized_pnl / cost_basis)`; `cost_basis` is total-signed and `realized_pnl` is
  documented long-exact, so the UI lib must use `abs(cost_basis)` (or scope to longs) and guard
  `cost_basis == 0` (R5) — mirrors the non-finite Sharpe guard.
- Backward compat: legacy close events (and the redelivered edge) lack the two fields; the lib
  presence-checks and excludes them from the two averages only, still counting them in
  trades/win-rate/total-P&L/equity-curve. New scenario **AC-13** covers this; **AC-11**/**AC-12** cover
  the two stats concretely ($500/$10,000 → +5.0%; 10-day hold). AC-5 kept (units removed from its line).
- Impl must update `services/xstockstrat-portfolio/CLAUDE.md` § Ledger Events Emitted (producer contract)
  in the same PR, and add a portfolio service-owner approval gate + a RED test on the new payload keys.
- **No Floor (F-*) breach:** the extension adds no DB access (fields already in hand), no pool/proto/
  secret Floor crossing — additive emit only. Design remains approvable.

## Session 2026-08-31 — sdd-spec

- Generated `implementation-spec.md` with **11 steps** (2 code-bearing services per design.md). Status
  flip to `implementation-ready` deliberately **not** applied (orchestrator owns `status.md`/`feature.md`).
- Key codebase findings (grounded `path:line`):
  - Portfolio close emit is the map literal at `portfolio_service.go:304-307` inside `processOrderFill`
    (`:233`); `existing` (`:262`) carries `CostBasis` (repo `:269`) + `OpenedAt` (repo `:270`, NOT NULL);
    `emitEvent`/`structpb.NewValue` at `:790-795`; RFC3339 `as_of` precedent `:841-844`. `repo` is a
    **concrete** `*repository.PortfolioRepo` (not fakeable), and `internal/service/` is coverage-excluded
    → the RED test targets an extracted **pure** `closedPositionPayload` helper (mirrors the feature-042
    `realizedDelta` pattern), not a DB-driven `processOrderFill`.
  - **Config migration = `023_ui_performance_keys`** — confirmed against `merge-order.md:191`
    pre-assignment (tip on disk `021_notify_push_min_severity`; `022` reserved to feature 021). Post-147
    seed pattern from `021`/`019` (namespace `ui`, `staging`+`production`, `user_id NULL`,
    `ON CONFLICT (namespace,key,environment,COALESCE(user_id,'')) DO NOTHING`). **No portfolio migration**
    (`014_positions_fees_accum` is feature 029's, `merge-order.md:197`); the two payload fields are
    existing `portfolio.positions` columns.
  - Config map keying (design R3 resolved): `values[row.key]` verbatim
    (`configServiceImpl.ts:176,206`) → seed `key='performance.risk_free_rate_annual'` /
    `'performance.equity_curve_start_date'`, read `resp.values['performance.…']` with the oneof-`case`
    presence check (`positions/page.tsx:131-133`; a stored `0` survives).
  - `insightsBff.ts` gaps: no `LedgerService`, no `ConfigService`, `TradingService` has only
    `listBrokerAccounts` (`:100-102`) — Step 6 adds all three (queryEvents forces
    `stream_key=portfolio:<user>` server-side, `traderBff.ts:117-126` IDOR precedent).
  - Metric math lives in a pure `src/lib/performanceMetrics.ts` (vitest-scoped `src/lib/**`,
    `equityCurve.ts` precedent); recharts `^3.10.1` `Brush` for zoom (no lightweight-charts);
    paper label via `AccountProvider`/`TradingModeBadge` (same-origin `/trader/api`, SignalOrderTicket
    precedent). Sharpe R2 pinned: `rollingSharpe(returns[], rfAnnual)` = `(mean − rf/252)/popStd × √252`,
    `null` on <2 pts / std 0 / non-finite (AC-4).
- Every `@AC-*` (1–13) is covered by ≥1 test step (see § Scenario Coverage): AC-1..AC-5/AC-8/AC-11..13 by
  the metric-lib vitest (Step 8) + portfolio emit test (Step 2); AC-6/AC-7/AC-8/AC-9/AC-10 by the
  Playwright e2e (Step 11); AC-1 render also Step 11.
- Deduped Reviewers: `xstockstrat-portfolio` service owner (Steps 1,2); `xstockstrat-ui` service owner
  (Steps 5–11); `xstockstrat-config` service owner (Steps 4,5); DBA (Step 4); none (Step 3 docs).
- No "Not found / create from scratch" steps — every path/symbol cited to a real `path:line`.

## Session 2026-08-31 — sdd-review impl-spec (advisory)

- Result: 0 failures, 2 warnings, 3 notes. No Floor risk. Nav CORRECTLY registers in the rendered NAV_GROUPS (Engine group) + reachability walk (not legacy PLATFORM_SUBNAV); cost_basis/opened_at confirmed already on the position row (additive Struct, no migration); config seed 023 correct; BFF reads (queryEvents server-forced stream_key, oneof-presence getConfig, GetTradingEnvironment) grounded; metrics precedents verified.
- Unresolved ⚠ carried into execution:
  - Step 10: add `pnpm run lint` (or `+ tsc --noEmit`) to the Verification — the step edits `navGroups.tsx` source but has no lint gate (paired test is in-step e2e). — [ ] unaddressed
  - Step 4: config NNN 023 presumes 021 lands 022 first (merge-order); re-derive next-free across remote branches at execute time (spec already instructs). — [ ] note only
  - Step 7: oneof-read precedent line drift (:131-133 -> :132-134; pattern present). — [ ] note only
  - Step 11: mock-backend.ts already defines getTradingEnvironment/queryEvents/getConfig — reword "add handlers" as "point queryEvents at the ledgerEvents fixture + extend getConfig for the ui namespace". — [ ] note only
- Overlap findings: batch scan CLEAN; 031 shares portfolio_service.go emit with 029 (029 before 031), navGroups.tsx with 043, ledgerEvents.ts create with 021 (021 before 031) — all in merge-order.md.
