# Product Spec: fix-position-fold-correctness

**Type**: bug
**GitHub Issue**: none (Issues disabled) — reports: `docs/reports/2026-10-06-portfolio-fill-fold-not-exactly-once-defect.md`, `docs/reports/2026-10-21-portfolio-live-fold-sell-sign-loss-defect.md`, `docs/reports/2026-10-21-trading-bracket-leg-fills-missing-from-realized-pnl-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-10

---

## Problem Statement

### Portfolio re-applies the full order.filled history on every restart, and serializes position writes only in-process (SEV-2, production)

- **Observed**: `consumeEventStream` starts every consumer at `lastSeq = 0` and never persists the cursor,
  so each start replays all `order.filled` events onto already-folded rows. Broker-account qty/cost basis
  inflate until the next `account.positions.synced`; `realized_accum`/`fees_accum` inflate permanently;
  never-synced accounts never heal. `positionsMu` serializes writers in-process only, so the old+new
  instance overlap of a zero-downtime deploy double-applies fills and reopens the lost update.
- **Expected**: exactly-once consumption (applied events recorded atomically with the position write — a
  persisted per-consumer cursor or an applied-event table unique on `(consumer, event_id)`), and row-level
  serialization (`SELECT … FOR UPDATE` plus a transaction-scoped advisory lock on
  `(user_id, symbol, trading_mode, account_id)`, PgBouncer-transaction-mode safe), after which
  `positionsMu` can go and `instance_count > 1` is safe.
- Report: [`docs/reports/2026-10-06-portfolio-fill-fold-not-exactly-once-defect.md`](../../../reports/2026-10-06-portfolio-fill-fold-not-exactly-once-defect.md)

### Live position fold treats every trading sell fill as a buy (SEV-2)

- **Observed**: `processOrderFill` adds the unsigned `fill.Qty` and takes the "buying more" branch whenever
  `fill.Qty > 0`; a sell grows the position, recomputes cost/avg as an add, realizes nothing, and never
  emits `portfolio.position.closed` (feature 042 `realized_pnl` contract) until a broker sync overwrites qty.
- **Expected**: a sell reduces (or flips) the position via a signed qty, as `pnl.Fill.Qty` documents;
  realized accrues on the reducing leg; a full exit closes the row and emits `portfolio.position.closed`
  with the sealed realized.
- Report: [`docs/reports/2026-10-21-portfolio-live-fold-sell-sign-loss-defect.md`](../../../reports/2026-10-21-portfolio-live-fold-sell-sign-loss-defect.md)

### Bracket leg fills never reach the ledger, so realized P&L omits the exit (SEV-2)

- **Observed**: `order.filled`/`order.partially_filled` are emitted only from `applyBrokerOrderStatus` via
  `pollFills`, which iterates only the in-memory `s.orders`; bracket leg ids (Alpaca legs, IBKR
  `SubmitBracketLegs`) live only in `trading.order_brackets`. A stop-loss/take-profit fill writes no
  ledger event, so `GetPnL` realized and the live fold miss every bracket exit. Brackets are on by default
  (`trading.risk.bracket_orders_enabled` = true).
- **Expected**: a bracket leg fill produces a ledger fill event (symbol, side, qty, price, account, mode,
  user), so `GetPnL` realized and the live fold include the exit.
- Report: [`docs/reports/2026-10-21-trading-bracket-leg-fills-missing-from-realized-pnl-defect.md`](../../../reports/2026-10-21-trading-bracket-leg-fills-missing-from-realized-pnl-defect.md)

## Reproduction Steps

1. Replay: hold a broker-account position with realized P&L; note `qty`, `cost_basis`, `realized_accum`;
   restart `xstockstrat-portfolio`; before the next sync every historical fill is applied again; after
   the sync `realized_accum` stays inflated. Overlap: two portfolio processes on one DB/ledger, one
   `order.filled` → the position moves by twice the fill qty.
2. Sell sign: buy 10 @ 100 then sell 10 @ 150 on a broker account; before the next sync
   `portfolio.positions` shows qty 20 and the row is open (expected: closed, `realized_pnl` 500).
3. Bracket legs: with brackets enabled, place an auto-sized market buy with a stop on Alpaca or IBKR; let
   the take-profit (or stop) leg fill; ledger `order.filled` holds only the entry fill and `GetPnL`
   round-trip realized is 0.

## Root Cause Hypothesis

The consumers are an in-memory-cursor incremental fold with no idempotency key and no DB-level
concurrency control; the fold assumes a signed qty the producer never sent; no poller observes bracket leg
fills. Current sites (main-dev @ 0fecb24d):

- `services/xstockstrat-portfolio/internal/service/portfolio_service.go:260-261` `consumeEventStream`,
  `var lastSeq int64` (in memory); `:61` `positionsMu sync.Mutex`.
- `services/xstockstrat-portfolio/internal/repository/portfolio_repo.go:66` — additive
  `realized_accum`/`fees_accum` upsert.
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go:419-420` — `newQty = existing.Qty + fill.Qty`
  / `if fill.Qty > 0 { // buying more`; `:442` `pnl.RealizedDelta`. The payload struct now has a `Side`
  field (`:362`, "absent on pre-feature-251 events") and trading now emits `side` on `order.filled`
  (`services/xstockstrat-trading/internal/service/trading.go:1892-1895`), but the live fold does not apply it.
- `services/xstockstrat-trading/internal/service/trading.go:1772` `pollFills` (iterates `s.orders`, `:1788`);
  `:1852` `applyBrokerOrderStatus` (emits at `:1896`); `:3553` `createBracket`; `:3577,3619` `SubmitBracketLegs`.
- `.do/app.yaml:107` `instance_count: 1` (portfolio).

## Affected Services

- xstockstrat-portfolio (fold idempotency, concurrency, sell sign)
- xstockstrat-trading (bracket leg fill emission)
- Consumer surfaces: xstockstrat-ui trader positions / P&L and xstockstrat-agent `get_positions` read the folded rows

## Fix Scope

- Proto changes: **no** — fill events are ledger JSON payloads; report 2's side key already rides that payload.
- DB migrations: **yes** — report 1's exactly-once fix needs a persisted per-consumer cursor or an applied-event table unique on `(consumer, event_id)` in the portfolio schema.
  Strategy: one new portfolio migration (next free NNN after `018`, i.e. `019_<name>.up.sql` + `.down.sql`;
  re-check the max at `/sdd-spec`), additive only, applied by `scripts/db-migrate.sh` before the portfolio
  deploy that reads it. Approval: DBA + portfolio owner (Approval Flow).
- Trading-domain scope: broker-agnostic — Alpaca and IBKR leg fills are both in scope (C-2). Paper and live
  behave identically: the fold and the exactly-once guard do not branch on environment (C-3). Order types:
  only the bracket stop/take-profit legs gain fill emission; market/limit/stop/stop-limit parents are
  unaffected (C-4). Fills: partial and full leg fills are both folded (C-5, AC-5).
- Config key changes: **no** — no report names a new key; `trading.risk.bracket_orders_enabled` and `trading.position_sync.interval_ms` already exist.

## Open Questions

All deferred to `/sdd-design`; AC-1..AC-5 hold under every option.

1. Exactly-once mechanism: persisted per-consumer cursor vs applied-event table keyed `(consumer, event_id)` (report 1 offers both).
2. Repair of production `realized_accum`/`fees_accum` already inflated by past restarts — report 1 calls it permanent and names no remediation; is a one-off rebuild in scope, and with which approvals (DBA + portfolio owner)?
3. Side resolution for pre-251 `order.filled` events with no `side` key on replay: reuse the `order.created`/`order.submitted` sibling lookup feature 251 built for `GetPnL`, or another rule?
4. Bracket legs: how trading observes leg fills (poll legs from `trading.order_brackets`, admit legs to `s.orders`, or broker-specific) for both Alpaca and IBKR, and which event (`order.filled` with the leg id vs the parent order id) carries them.
5. Is removing `positionsMu` and allowing `instance_count > 1` in this feature's scope, or only made safe?

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- `GetPnL` source-service fold — fixed by feature 251.
- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
