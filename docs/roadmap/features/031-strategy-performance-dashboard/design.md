# Design: strategy-performance-dashboard

**Created**: 2026-08-31
**Rounds**: 2 (full; termination: approved with named open risks)
**Approved by**: orchestrator-run debate @ 2026-08-31 — see Process Note (genuine forks surfaced to the operator in the run report; provisional pending sign-off)
**Grounded in**: recon.md

> **Process Note (fails.md 2026-08-08, 121/122/123).** This design phase ran inside an isolated
> subagent without `AskUserQuestion`/`Task`, so the proposer↔adversary debate and the Floor check
> were self-run (2 mediated rounds) and the P-04 human gate could not fire live. The chosen approach
> is grounded and Floor-clean; the three genuine architecture forks (per-trade-stat producer gap,
> Sharpe returns-basis, config map-key slicing) are carried as Open Risks and surfaced to the
> operator in the run report — treat their resolutions as provisional until confirmed.

---

## Chosen Approach

A **UI/BFF-computed, ledger-sourced** dashboard in the `xstockstrat-ui` `/insights` segment. No proto,
DB, or backend-service change (subject to the per-trade-stat Open Risk below). Reached by the consumer
surface named in the product spec (C-14): a new page `src/app/insights/performance/page.tsx`,
registered into the live `NAV_GROUPS` shell (recon: `navGroups.tsx`) and covered by the
nav-reachability walk (recon: `e2e/nav-reachability.spec.ts:21`).

**Data source (equity curve + realized metrics).** Query the ledger for
`event_type = "portfolio.position.closed"` events (recon: producer `portfolio_service.go:304-307`),
within the configured/derived time window, via a **new `insightsBff.ts` `LedgerService { queryEvents }`**
that **forces `stream_key = "portfolio:" + claims.user_id` server-side** (recon: copilot IDOR pattern
`traderBff.ts:117-126`). Each event carries `realized_pnl`; ordering by `occurred_at` yields the
**cumulative realized-P&L equity curve** (AC-1), realized-only by construction (C-5 — the event fires
only on a full close). From that series the BFF/lib computes:
- **Max drawdown** $ and % of peak of the cumulative curve (AC-2).
- **Rolling 30-day Sharpe** = `mean(daily_returns)/std(daily_returns) × sqrt(252)`, net of the config
  risk-free rate, with an explicit non-finite guard (AC-3/AC-4). "daily_returns" basis is pinned by
  Open Risk R2.
- **Summary stats** — total trades, win count, win rate, total realized P&L (all from event count /
  `realized_pnl` sign / sum); avg-return-% and avg-hold-time gated by Open Risk R1 (AC-5).

**Config (`ui.performance.*`).** Read one-shot via a **new `insightsBff.ts` `ConfigService { getConfig }`**
registration (recon: mirrors `traderBff.ts:143-149`; `GetConfig` is the config service's sanctioned
one-shot fetch, `config.proto:22-23`). The UI has **no `WatchConfig` subscription** and structurally
cannot hold one (stateless request/response BFF) — GetConfig is the established UI config-read idiom
(recon: `positions/page.tsx:131`). Values are read with the **oneof-`case` presence check**
(recon: `positions/page.tsx:132-133`): `values['performance.risk_free_rate_annual']?.value.case ===
'floatVal' ? …value : 0.045` — never `value || default` (zero-vs-absent guardrail; a stored `0` is a
legitimate risk-free rate). `equity_curve_start_date` absent → default to the earliest closed-position
date. Config is re-read per poll cycle, giving "live-enough" behavior without a stream.

**Paper/live label (FR-8).** Reuse `AccountContext.environmentMode` + `TradingModeBadge`
(recon: `AccountContext.tsx:46-49`): mount `AccountProvider` on the page and add
`getTradingEnvironment` to `insightsBff.ts`'s `TradingService` registration (mirror `traderBff.ts:60`)
so the same-origin `/insights` call resolves. Label shown when `environmentMode === 'paper'` (staging),
absent when `'live'` (production) — AC-9/AC-10. No `TRADING_MODE` axis (removed by feature 147).

**Chart + interactions.** Reuse the **recharts + `ui/chart.tsx`** idiom already used for insights
equity curves (recon: `EquityCurveChart.tsx`), driving colors through `ChartConfig`→`--chart-*` tokens
(C-17), not the file's hardcoded `hsl(...)` deviation. Zoom/pan (FR-6/AC-7) via recharts' native
`Brush`; the date-range picker (FR-7/AC-8) recomputes every metric for the selected window; 60s
auto-refresh (FR-5/AC-6) via a React-Query `refetchInterval` client constant. Loading/empty/error via
the canonical primitives (`Skeleton`/`QueryStateMessages`/`EmptyState`/`CardNotice`, C-17).

**Metric math lives in a pure lib** (`src/lib/performanceMetrics.ts`, vitest-unit tested — the
coverage-scoped `src/lib/**` home, feature 065) so AC-1..AC-5 get RED unit assertions independent of
the Playwright e2e.

## Rejected Alternatives

- **lightweight-charts v5 for the equity curve** (the product-spec's tentative steer) — rejected: it is
  the trader-OHLCV **candlestick** engine only (recon: `useCandlestickChart.ts`, `CLAUDE.md § Styling`);
  using it here imports a canvas engine into a segment that doesn't use it, hits the oklch→rgb parse
  trap (ledger 146, `chartColors.ts`), and misuses a candlestick hook for a P&L line. recharts is the
  incumbent `/insights` line engine. (Trade-off: recharts `Brush` zoom is coarser than lightweight-
  charts' wheel/drag — acceptable given FR-7's date picker is the primary window control.)
- **Daily portfolio snapshots for daily returns** — rejected: needs snapshotting infra that doesn't
  exist; event-driven from `portfolio.position.closed` needs none (confirms the spec's preferred fork).
- **`WatchConfig` subscription for `ui.performance.*`** — rejected: no `WatchConfig` consumer exists in
  the UI (recon: grep found only `GetConfig`/`listKeys`/`setConfig`); a stateless BFF has no daemon to
  hold a server stream. GetConfig per poll is the correct, precedented mechanism.
- **Reconstructing per-trade entry/exit/hold-time from raw `order.filled` fill-pairing in the BFF** —
  rejected as the default: it reimplements portfolio's own position-lifecycle bookkeeping in the UI
  (DRY / minimalism), duplicating what `GetPnL`'s Pass-1/Pass-2 already does server-side. Kept only as
  a fallback option under Open Risk R1.
- **A new backend analysis RPC / relocating the math to a service** — rejected for the config reason
  (the UI consumes `ui.performance.*` cleanly via GetConfig; no relocation needed) and unnecessary for
  every AC-covered metric. Only R1 (two per-trade stats) could justify a *scoped additive* producer
  touch, not a math relocation.
- **Hardcoding risk-free rate / start-date** — rejected (F-07): both come from the config service.

## Open Risks

- [ ] **R1 — FR-4 avg-return-% and avg-hold-time have no producer.** `portfolio.position.closed`
  carries `realized_pnl` but no cost basis / qty / open timestamp (recon: `portfolio_service.go:304-307`).
  **Operator decision required**: (a) ship the derivable 4 summary stats now and defer avg-return-% +
  avg-hold-time to a **named** V2 follow-up (C-14-compliant deferral; update AC-5's scope so it doesn't
  ship untested/placeholder — fails.md add-ikbr trap); or (b) **additively** extend the producer emit
  (`cost_basis` is free from `existing.CostBasis`; hold-time needs an open-timestamp source to verify —
  possibly a positions-schema field), which makes this no longer zero-backend-change and pulls
  `xstockstrat-portfolio` in as a code-bearing service with its own test step. — resolve before `/sdd-spec`.
- [ ] **R2 — Sharpe daily-returns basis.** Closed-position events give a dollar daily-P&L series; the
  annual risk-free **rate** needs percentage returns (an equity base per day) or a documented dollar-
  excess convention. Pin the exact reference formula (and whether `GetPnL` supplies the equity base) so
  AC-3's "hand-computed reference" is well-defined. — resolve at `/sdd-spec` / first RED unit test.
- [ ] **R3 — Config map-key slicing.** `GetConfig(namespace:'ui')` → `values['performance.risk_free_rate_annual']`
  is inferred from the `platform`/`trading_state` precedent (recon: `positions/page.tsx:131-133`);
  confirm the config service's exact keying (namespace vs. value-map key) against a real ListKeys/GetConfig
  before wiring. — verify at `/sdd-spec`.
- [ ] **R4 — Auto-refresh configurability.** FR-5 says "configurable" but declares no key; ship 60s as a
  named client constant unless the operator wants a third `ui.performance.*` key. — confirm at `/sdd-spec`.

## Constitution Rules Touched

- `C-05` — honored: two keys named `ui.performance.*` (`ui` = the consuming service short-name); defaults
  (`0.045`, first-fill-date) declared in `services/xstockstrat-ui/CLAUDE.md` + the config-governance log.
- `C-10(a)` — honored: page registered in the live `NAV_GROUPS` shell with an extension to the
  `e2e/nav-reachability.spec.ts` walk; `PLATFORM_SUBNAV.insights` updated only if a live consumer reads it.
- `C-12`/`C-13` — honored: the `portfolio.position.closed` / `queryEvents` mock (today inline in
  `mock-backend.ts`) is centralized into an `e2e/fixtures/` module + `INVENTORY.md` row on second consumer.
- `C-14` — honored: the consumer surface is the `/insights` page (named + owns its steps). An R1 deferral
  must point at a **named** follow-up feature, not "later".
- `C-16` — honored: net-new behavior; no existing `@AC-*` guarantee changed. The `portfolio.position.closed`
  key-set contract and the header-identity IDOR guard are PRESERVED (read-only, additive keys only).
- `C-17` — honored: tokened chart colors + canonical state primitives; no hardcoded color literals.
- `P-02` — honored: proposer/adversary mediated (self-run; see Process Note).
- `F-04` — honored: every path/symbol cited to recon `path:line`; unknowns (R1-R4) surfaced, not invented.
- `F-07` — honored: risk-free rate + start date sourced from the config service via `GetConfig` (the UI's
  sanctioned, stream-incompatible read path), not hardcoded; the 60s poll interval is a UI client
  constant, not platform config. **No Floor breach** — design is approvable.
- `F-06` — not touched: no new DB-backed service or pool change (the config-ui audit pool is unrelated).

## Business Rules Touched (C-16)

- Net-new behavior only — no existing `@AC-*` scenario is preserved-with-changes, extended, or changed.
  (Guardrails PRESERVED, not altered: the `portfolio.position.closed` payload key-set contract; the
  self-scoped header-identity IDOR guard on ledger/portfolio reads.)
