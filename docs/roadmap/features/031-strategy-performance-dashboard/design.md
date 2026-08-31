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

A **UI/BFF-computed, ledger-sourced** dashboard in the `xstockstrat-ui` `/insights` segment, plus a
**minimal additive extension of the `xstockstrat-portfolio` producer** (R1 resolved — operator decision,
2026-08-31, see Open Risks). No proto and no DB migration; the only backend touch is two additive keys
on an existing ledger-event payload. Reached by the consumer surface named in the product spec (C-14): a
new page `src/app/insights/performance/page.tsx`, registered into the live `NAV_GROUPS` shell (recon:
`navGroups.tsx`) and covered by the nav-reachability walk (recon: `e2e/nav-reachability.spec.ts:21`).

**Affected services:** `xstockstrat-ui` (code-bearing — all metric math), **`xstockstrat-portfolio`
(code-bearing — the additive producer emit)**, and read-only reuse of `xstockstrat-ledger`
(`QueryEvents`), `xstockstrat-trading` (`GetTradingEnvironment`), `xstockstrat-config` (`GetConfig`).

**Producer extension (portfolio — the R1 resolution).** The full-close emit
(`portfolio_service.go:295-307`) already holds the closing position as `existing` (fetched at
`portfolio_service.go:262`), a `*portfoliov1.Position` that carries both fields the two per-trade stats
need: `cost_basis` (`existing.CostBasis`, used at `portfolio_service.go:271`, scanned from the row at
`portfolio_repo.go:269`) and `opened_at` (`existing.OpenedAt`, scanned at `portfolio_repo.go:270`). Both
are existing columns on `portfolio.positions` (migration `001_portfolio_hypertable.up.sql`; `opened_at`
is `NOT NULL DEFAULT NOW()`), so **no migration**. The change is purely to add two keys to the emitted
`google.protobuf.Struct` payload at `portfolio_service.go:304-307` — `cost_basis` (JSON number) and
`opened_at` (RFC3339 string via `existing.OpenedAt.AsTime().Format(time.RFC3339)`, mirroring the `as_of`
timestamp precedent at `portfolio_service.go:842-844`; `structpb.NewValue` at `:793` accepts only
scalar/string, not `time.Time`) — so **no proto change** (same additive-Struct pattern by which feature
029 adds `fees` to the fill payload). The existing five keys are untouched (C-16 preserve). Guarded by
`existing != nil`: the redelivered-post-close edge (`portfolio_service.go:289`, `existing == nil`) omits
both keys, exactly as it already emits `realized_pnl: 0` there. The **close time** is the event's own
producer-stamped `OccurredAt` (`portfolio_service.go:800`, `timestamppb.Now()`) — the same field the
equity curve already orders on — so `closed_at` is **not** added as a redundant payload key. `qty` and
`avg_entry_price` are likewise **not** added: neither per-trade stat needs them (minimalism). This emit
change carries its own RED test asserting the two new payload keys, and updates the producer-contract
note in `services/xstockstrat-portfolio/CLAUDE.md` § Ledger Events Emitted in the same PR.

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
  `realized_pnl` sign / sum, AC-5). **avg-return-% and avg-hold-time** are now computed from the extended
  close event (R1 resolved): avg-return-% = `mean(realized_pnl / cost_basis)` across closed positions
  (AC-11); avg-hold-time = `mean(occurred_at − opened_at)` (AC-12). The same lib **presence-checks**
  `cost_basis`/`opened_at` and excludes any close event lacking them (legacy events, or the
  redelivered-post-close edge) from these two averages only — they still count toward trades/win-rate/
  total-P&L/equity-curve (AC-13). The ledger-consumer side is the existing `insightsBff.ts`
  `LedgerService.queryEvents` read plus the pure metric lib below: both simply read two more optional
  payload fields off the same `portfolio.position.closed` events — no new RPC, no second query.

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
  rejected: it reimplements portfolio's own position-lifecycle bookkeeping in the UI (DRY / minimalism),
  duplicating what the position row already tracks server-side. R1 was instead resolved by emitting the
  two already-tracked fields (`cost_basis`, `opened_at`) the producer already has in hand — cheaper and
  authoritative — rather than re-deriving them in the UI.
- **A new backend analysis RPC / relocating the math to a service** — rejected for the config reason
  (the UI consumes `ui.performance.*` cleanly via GetConfig; no relocation needed) and unnecessary for
  every AC-covered metric. R1's resolution is a **scoped additive producer emit** (two payload keys), not
  a math relocation — the equity-curve/drawdown/Sharpe/summary math still lives in the UI/BFF/lib.
- **Hardcoding risk-free rate / start-date** — rejected (F-07): both come from the config service.

## Open Risks

- [x] **R1 — RESOLVED (operator decision, 2026-08-31): extend the producer now (option b).**
  Investigation confirmed the position row already tracks everything the two stats need at close:
  `cost_basis` and `opened_at` are both existing columns on `portfolio.positions` (migration
  `001_portfolio_hypertable.up.sql`) and both are already populated on the in-scope `existing` position
  at the close emit (`portfolio_service.go:262`; `CostBasis` `portfolio_repo.go:269`, `OpenedAt`
  `portfolio_repo.go:270`). So the extension is purely additive: add `cost_basis` + `opened_at` to the
  `portfolio.position.closed` Struct payload (`portfolio_service.go:304-307`) — **no migration, no proto
  change** (see Chosen Approach § Producer extension). avg-return-% and avg-hold-time ship in V1; no
  placeholder values. `xstockstrat-portfolio` is now a code-bearing service in this feature with its own
  RED test step. Residual sub-risks folded into R5/R6 below.
- [ ] **R5 — cost_basis sign & zero-divisor for avg-return-%.** `cost_basis` is **total-signed** (positive
  for longs, negative for shorts — portfolio CLAUDE.md invariant), and the `realized_accum`/`realized_pnl`
  figure is documented exact only for **long, order-fill-originated** positions. So `realized_pnl /
  cost_basis` is well-defined for longs; the metric lib must divide by `Math.abs(cost_basis)` (or scope
  V1 avg-return-% to longs) and **guard `cost_basis === 0`** (exclude, mirroring the non-finite Sharpe
  guard) to avoid a sign flip / `Infinity`. Pin at `/sdd-spec` / first RED unit test.
- [ ] **R6 — hold-time unit = days (FR-4 changed from "hours").** The operator's confirmed example is
  "opened 2026-02-01, closed 2026-02-11 → 10 days"; FR-4 and AC-12 now express avg-hold-time in **days**
  (was "hours"). Coherent with multi-day paper holds; if the operator prefers hours, it is a one-line
  display divisor. Backward compat: older `portfolio.position.closed` events (and the redelivered edge)
  have no `opened_at`, so the lib presence-checks and excludes them from avg-hold-time (AC-13).
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
- `C-14` — honored: the primary consumer surface is the `/insights` page (named + owns its steps). R1 was
  resolved by extending the producer **now** (no deferral), so all FR-4 stats ship in V1 — no unnamed
  "later" follow-up is left dangling. The additive `xstockstrat-portfolio` producer emit is a second
  code-bearing surface with its own step + test.
- `C-16` — honored: net-new dashboard behavior; no existing `@AC-*` guarantee is broken. The
  `portfolio.position.closed` payload key-set contract is **extended additively** — the five existing
  keys (`user_id, symbol, account_id, trading_mode, realized_pnl`) are PRESERVED and only `cost_basis` +
  `opened_at` are added, so the existing `xstockstrat-analysis` P&L-pattern consumer is unaffected. The
  header-identity IDOR guard on ledger/portfolio reads is PRESERVED.
- `C-17` — honored: tokened chart colors + canonical state primitives; no hardcoded color literals.
- `P-02` — honored: proposer/adversary mediated (self-run; see Process Note).
- `F-04` — honored: every path/symbol cited to real `path:line` (producer extension verified against the
  live position row, repo scan, and emit); remaining unknowns (R2-R6) surfaced, not invented.
- `F-07` — honored: risk-free rate + start date sourced from the config service via `GetConfig` (the UI's
  sanctioned, stream-incompatible read path), not hardcoded; the 60s poll interval is a UI client
  constant, not platform config. **No Floor breach** — design is approvable.
- `F-06` — not touched: the producer extension adds **no** DB access (both fields are already on the
  in-scope `existing` position) and no pool change; no proto Floor and no secret Floor are crossed. The
  producer emit is additive to an existing event. **No Floor (F-*) breach — design remains approvable.**

## Business Rules Touched (C-16)

- Net-new dashboard behavior — no existing `@AC-*` scenario is changed. The only guardrail touched is the
  `portfolio.position.closed` payload key-set contract, which is **extended additively** (five existing
  keys preserved; `cost_basis` + `opened_at` added) — not altered or narrowed, so no downstream consumer
  guarantee changes. The self-scoped header-identity IDOR guard on ledger/portfolio reads is PRESERVED.
  New scenarios AC-11/AC-12 (per-trade averages from the extended event) and AC-13 (legacy-event
  exclusion) are net additions.
