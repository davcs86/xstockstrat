# Recon: broker-state-reconciliation

**Created**: 2026-08-06
**From**: product-spec.md
**Affected services**: xstockstrat-trading, xstockstrat-portfolio, xstockstrat-notify, xstockstrat-ui

---

## Objective

Add a lightweight periodic ticker inside `xstockstrat-trading` that compares its own open-orders record
(and, per FR-1, `xstockstrat-portfolio`'s position records) against broker truth, self-heals only
propagation-delay-class mismatches, halts exposure-increasing trading via feature 100's kill switch on
anything else, resolves feature 101's `UNKNOWN` order-intent state against broker truth, and records
every finding as a ledger event — reusing the existing broker clients and ledger RPC, no new service,
table, or dashboard.

**Critical framing (per this feature's own two hard dependencies):** feature 100
(`account-trading-halt-and-kill-switch`) and feature 101 (`exactly-once-order-intent`) are both
`design-approved` but **neither has any code yet** — confirmed by direct grep: `main.go` wires only 3
pollers (fill/position-sync/credential-health), no `StartOrderIntentSweeper`; no `intent_state`/
`IntentState` reference anywhere in `trading.go`; no `platform.trading_state` read anywhere. This
feature's design must therefore plan against 100's and 101's **planned** contracts (their `design.md`
files), not real line numbers — the same situation 030 was in against 023.

## Codebase Map

- **`xstockstrat-trading`** (Go)
  - Existing broker-polling loops (direct precedent for this feature's own ticker):
    `StartFillPoller`/`pollFills` (`internal/service/trading.go:629-761`) and
    `StartPositionSyncPoller`/`syncPositions` (`trading.go:766-~950`) — both ticker + `ctx.Done()` +
    live config re-read (`s.cfgW.GetFloat`, `ticker.Reset` on change) via `trading.fill_poller.interval_ms`
    (default 5000ms, `trading.go:630,640`) and `trading.position_sync.interval_ms` (default 300000ms,
    `trading.go:767,799`). Wired at startup in `cmd/server/main.go:106,108,110`.
  - **No broker-side bulk `ListOrders` exists** — the shared `Broker` interface
    (`internal/broker/broker.go:57-76`, implemented identically by Alpaca `internal/broker/alpaca.go`
    and IBKR `internal/broker/ibkr.go`) only has per-order `GetOrder(ctx, brokerOrderID)` and account-wide
    `GetPositions(ctx) ([]BrokerPosition, error)`. `pollFills` already iterates its own known order IDs
    and calls `GetOrder` per order — this is the exact, reusable pattern 102's own order-comparison must
    follow (there is no broker bulk-list to reuse instead).
  - Trading's own order tracking: in-memory `orders map[string]*tradingv1.Order` (`trading.go:74`,
    guarded by `mu sync.Mutex`, `:76`) + persisted via `s.repo.UpsertOrder` (`:724`). **No local position
    cache exists in trading** — positions live only in `xstockstrat-portfolio`.
  - **Existing account-scoped (not per-order) ledger stream-key precedent**: `account.positions.synced`
    and `account.balance.synced`, both keyed `fmt.Sprintf("account:%s", accountID)`
    (`trading.go:898,914`) — this is the real, already-established convention for "periodic-poller,
    account-wide event," directly applicable to this feature's own reconciliation events. Product-spec's
    claimed `reconciliation:{account}` stream-key prefix has **no grounding in existing code** — the
    real precedent is bare `account:{account_id}`.
  - **Portfolio read dependency already exists — no new plumbing needed.** `xstockstrat-trading` already
    dials and calls `xstockstrat-portfolio`: client field `portfolio portfoliov1.PortfolioServiceClient`
    (`trading.go:69`), dialed at `trading.go:111-114`, called non-blocking with a bounded timeout in
    `checkPortfolioRisk` (`trading.go:1285-1305`, `s.portfolio.GetPortfolio(...)`). This same client can
    be extended with `ListPositions`/`GetPosition` calls for FR-1's position comparison.
  - `emitLedgerEvent(ctx, eventType, streamKey, payload)` — `trading.go:1426-1439`, fire-and-forget,
    10s timeout — reuse target for every reconciliation finding/correction (FR-5).
  - `xstockstrat-notify.EmitAlert` — confirmed already called from this exact service twice
    (`emitApprovalAlert`/`emitFillAlert`, `trading.go:1441-~1470`) — product-spec's "no change needed"
    claim for notify is correct, the call shape already exists to reuse.
  - **Existing fill-status compare-and-act pattern** (direct precedent for FR-2's drift detection):
    `pollFills` already compares `newStatus := alpacaStatusToProto(brokerOrder.Status)` against
    `order.Status`, skips a no-op (`if newStatus == order.Status { continue }`, `trading.go:702,710-712`),
    and explicitly does NOT overwrite on an unrecognized/transient broker status (maps to
    `ORDER_STATUS_UNSPECIFIED`, skipped — `trading.go:703-709`, documented at
    `services/xstockstrat-trading/CLAUDE.md:135-146` § Order Status Reconciliation). 102's own
    mismatch-classification loop should follow this same "compare, skip-on-no-op, never blindly
    overwrite" shape rather than inventing a new one.
  - Config-read idiom: `Watcher.GetFloat(key, def)` (`internal/config/config.go:172-180`, plus
    `GetString`/`GetInt`/`GetBool`) — snapshot-map lookup, returns `def` on miss, never errors. A new
    `trading.reconciliation.*` key follows this exactly. **Confirmed genuinely new** — no
    reconciliation-named key exists anywhere in `CLAUDE.md` or `docs/patterns/config-governance.md`.
  - **`Order` proto field numbering — must plan for 101's claimed-but-unimplemented field.** Real
    committed highest field is `broker_type = 20` (`trading.proto:52`) → real next-available = 21. But
    101's `design.md` already claims `IntentState intent_state = 21`. **102 must plan for field 22** on
    `Order` if a reconciliation-status field is needed there, exactly analogous to how 030 had to plan
    against 023's claimed-but-unimplemented fields.

- **`xstockstrat-portfolio`** (Go)
  - RPCs: `GetPortfolio` (`internal/handler/portfolio_handler.go:32`), `GetPosition` (`:44`),
    `ListPositions` (`:56`), `ListPortfolios` (`:119`) — proto at `packages/proto/portfolio/v1/portfolio.proto:11-17`.
  - `Position` message: fields 1-19 (`packages/proto/portfolio/v1/portfolio.proto:43-76`, last
    `exit_rule=19`) → **next-available = 20**, no competing claim from 100 or 101 — stands as-is.
  - Positions are **persisted, event-updated rows**, not live-computed:
    `portfolio.positions` table (`migrations/001_portfolio_hypertable.up.sql:7-17`, evolved by
    migrations `003`/`005`/`006`), updated via `ConsumeOrderFills` (`order.filled` events) and
    `ConsumePositionSyncs` (`account.positions.synced` — i.e. trading's own `syncPositions` poller
    output already flows into portfolio's position rows today).
  - **Confirmed real precedent for feature 100's planned `ErrPositionNotFound`**:
    `ErrWatchlistNotFound` (`internal/repository/watchlist_repo.go:16-17`), mapped to
    `connect.CodeNotFound` at `internal/service/portfolio_service.go:1147-1148`. `GetPosition`'s repo
    call has no `ErrNoRows` special case today (`scanPositionRow`, `internal/repository/portfolio_repo.go:203-206`,
    wraps every scan failure identically) — confirms 100's design.md claim verbatim. `ErrPositionNotFound`
    itself is **not yet real code**, only a plan in 100's `design.md`.
  - **Scoping gap found**: `GetPosition`'s service call drops the request's `account_id` —
    `internal/service/portfolio_service.go:462-466` calls `s.repo.GetPosition(ctx, req.UserId, req.Symbol, req.TradingMode)`,
    and the repo signature (`internal/repository/portfolio_repo.go:61`) has no `accountID` parameter at
    all, even though `GetPositionRequest.account_id` exists on the wire (`portfolio.proto:124`). A
    per-broker-account reconciliation loop calling `GetPosition` would not actually scope by account
    today — `ListPositions`/`ListPortfolios` (which do honor `account_id`,
    `internal/repository/portfolio_repo.go:90-92`) must be used instead, or this gap fixed.
  - Config-read idiom matches trading's (`Watcher.GetString/GetInt/GetFloat/GetBool`,
    `internal/config/config.go:48-114`) — same oneof-zero-value-on-mismatch fail pattern feature 100's
    design.md already flagged as the reason to never widen an existing key's type in place.

- **`xstockstrat-ui`** (Next.js)
  - Primary Consumer-Surface attach point: `/trader/positions` page header
    (`src/app/trader/positions/page.tsx:107-125`, "Exposure" `h1` + header row) — natural slot for a
    page-level freshness/mismatch marker. Secondary candidate: `AccountsModule.tsx:48-61` header block
    (product-spec says "account/positions view," both are plausible).
  - Data hook: `usePositions` (via `usePortfolio.ts:39-59`, `refetchInterval: 10_000` — also
    `usePortfolio`/`usePosition` at lines 16/81, all polling every 10s) — backed by
    `portfolioClient.listPositions(...)`.
  - **Reusable relative-time formatter, direct precedent for "last reconciled: Xs ago"**:
    `formatLastRun(then: Date, now: number): string` (`src/lib/formatLastRun.ts:8-17`) — pure, no
    `setInterval` (deliberately tick-free per its own doc comment), used today for the Insights
    screener's "last run 2m ago" label (feature 098). Not yet wired to any `/trader` surface.
  - Status-badge precedents: `CredentialStatusBadge.tsx:13-46` (switch-based, renders nothing for the
    healthy case — a plausible shape for "visible marker only if mismatch"); `opportunityShared.tsx:14-53`
    (`SOURCE_HEALTH`, the exhaustive `Record<Enum,EnumRender>` pattern).
  - **101's exhaustive-map conversion of `orderShared.tsx` is confirmed NOT yet implemented** — still
    string-keyed `STATUS_VARIANT: Record<string,...>` (`orderShared.tsx:10-21,46`) — relevant only if
    102's design touches the same file (it likely doesn't; 102's UI surface is positions/accounts, not
    orders).
  - Typed proto client usage confirmed standard: `import type { Position } from '@xstockstrat/proto/portfolio/v1/portfolio_pb'`
    (`positions/page.tsx:15-16`) — a new reconciliation-status field flows the same way, proto → `_pb`
    type → hook → component.

## Patterns to REUSE

- Ticker + `ctx.Done()` + live-config-reread poller shape → `StartFillPoller`/`StartPositionSyncPoller`
  (`trading.go:629-650,766-809`) — 102's own ticker should mirror this exactly, same as 101's (planned,
  unimplemented) `StartOrderIntentSweeper` does.
- Per-order broker-status comparison, skip-on-no-op, never-blind-overwrite → `pollFills`'s existing
  logic (`trading.go:702-712`) — reuse this shape for FR-2's mismatch classification rather than
  inventing new comparison logic.
- Account-scoped ledger stream-key convention → `account:{account_id}` (`trading.go:898,914`), not
  product-spec's ungrounded `reconciliation:{account}` guess.
- Portfolio gRPC client → `s.portfolio` (`trading.go:69,111-114`), already dialed, already called
  non-blocking with a bounded timeout in `checkPortfolioRisk` — extend, don't re-plumb.
- Alert emission → `emitApprovalAlert`/`emitFillAlert`'s exact `s.notify.EmitAlert(...)` call shape
  (`trading.go:1441-~1470`).
- Config-read idiom → `Watcher.GetFloat/GetInt/GetString/GetBool` (`internal/config/config.go:172-180`
  in trading, `:48-114` in portfolio) for the new `trading.reconciliation.*` key(s).

## Dependencies

- Proto/RPC: no new RPCs required — FR-1 reuses existing `GetOrder`/`ListOrders` (trading) and
  `GetPosition`/`ListPositions`/`ListPortfolios` (portfolio). A reconciliation-status field, if added,
  lands on `Order` at **field 22** (accounting for 101's claimed-but-unimplemented field 21) and/or
  `Position` at field 20 (no competing claim) — `/sdd-design` must decide per product-spec's own C-10(b)
  parity flag.
- Migration: none — product-spec confirms no schema change (ledger events only).
  **Portfolio's `GetPosition` account-scoping gap** (found above) may need a fix if the design calls
  `GetPosition` per-account rather than `ListPositions`/`ListPortfolios`.
- Config keys: `trading.reconciliation.interval_seconds` (or `_ms`, per the fill/position-sync
  precedent's `_ms` convention) — genuinely new, no existing key to extend.
- Inter-service edges: `xstockstrat-trading → xstockstrat-portfolio` (already exists, extend);
  `xstockstrat-trading → xstockstrat-notify` (already exists, no change).
- **Hard dependency on 100 and 101's actual implementation** (not just design) before this feature's
  own code can be written — both are `design-approved`, neither has landed. `merge-order.md:43` already
  records 102 → 101; a symmetric 102 → 100 dependency should be added (FR-4 needs 100's
  `platform.trading_state` gate to actually exist).

## Risks / Not-found

- **Product-spec's `reconciliation:{account}` stream-key claim is ungrounded** — no such prefix exists
  anywhere in the codebase; the real, already-established convention for this exact shape is bare
  `account:{account_id}` (`trading.go:898,914`). `/sdd-design` should correct this, not adopt the
  product-spec's guess uncritically.
- **No broker-side bulk order-list method exists on either broker client** — FR-1's "list open orders
  from the broker" must be built as a loop over trading's own known order IDs calling `GetOrder` per
  order (mirroring `pollFills`), not a single bulk broker call. This bounds the tick's cost by trading's
  own open-order count, not the broker's total order history, which is favorable but should be stated
  explicitly in the design, not left implicit.
- **`GetPosition`'s account-scoping gap in `xstockstrat-portfolio`** (found above) — if 102's design
  calls `GetPosition` per broker account, this gap must be fixed first (or the design must route around
  it via `ListPositions`/`ListPortfolios`, which already honor `account_id` correctly).
- **Both hard dependencies (100, 101) are unimplemented.** This feature's design must be written against
  their `design.md` files' planned contracts, and the design should explicitly flag any point where an
  assumption about 100/101's eventual real code could be wrong once they're actually built (the same
  discipline 030 had to apply against 023's unimplemented state).
- **`Order` field-number planning must account for 101's claimed field 21**, not just the real committed
  proto — a genuine "plan against a planned contract" risk, not a simple grep-and-confirm.
- fails.md **2026-08-06** (`durable-observable-backfills`/`fundamentals-signal-producer` — migration):
  "always verify next-available identifiers against the real current state, not a cached assumption" —
  directly relevant to the field-number planning above, even though this is a proto field, not a
  migration number.
- insights.md **2026-08-06** (`030-stop-loss-bracket-orders` — design): "verify a reused precedent's
  actual mechanics, not just its surface shape" — relevant if 102's design reuses `pollFills`'s
  comparison logic; the reuse should be mechanically faithful (skip-on-no-op, never-blind-overwrite),
  not just superficially similar.
- Product-spec's own Open Questions (unresolved, carried into design): the "unprotected/impossible
  state" bucket's concrete meaning; whether `ORDER_STATUS_FILLED` orders are excluded from open-order
  comparison and caught only via position-side discrepancy; whether the ticker needs a portfolio-side
  check at all for this pass (recon confirms the portfolio client already exists, lowering the cost of
  including it); the exact tick interval; and whether this ticker is a genuinely distinct concern from
  `pollFills`/`syncPositions` or should fold into one of them.

## Recommended Scope

Advisory only — not binding.

1. `xstockstrat-trading`: new `StartReconciliationPoller` (or fold into an existing poller — design
   decision), config key `trading.reconciliation.interval_seconds`, mirroring the existing
   ticker+`ctx.Done()`+live-reread shape.
2. `xstockstrat-trading`: per-account, per-open-order `GetOrder` comparison loop (mirroring `pollFills`'s
   compare/skip-on-no-op logic) for FR-1/FR-2's order-side mismatch detection; extend `s.portfolio`
   client calls for position-side comparison.
3. `xstockstrat-trading`: mismatch classification (FR-2) — propagation-delay / quantity-discrepancy /
   unknown-broker-order / missing-broker-order / unprotected-impossible, resolving product-spec's Open
   Questions on the exact boundaries of each bucket.
4. `xstockstrat-trading`: self-heal only propagation-delay class (FR-3); halt via 100's (planned)
   `platform.trading_state` gate + `EmitAlert` for everything else (FR-4); resolve 101's (planned)
   `UNKNOWN` intents against broker truth in the same tick (FR-6).
5. `xstockstrat-trading`: ledger events via `emitLedgerEvent`, stream key `account:{account_id}`
   (corrected from product-spec's ungrounded guess), no new DB table.
6. `xstockstrat-portfolio`: fix `GetPosition`'s account-scoping gap if the design needs it, or route
   around via `ListPositions`.
7. `xstockstrat-ui`: "last reconciled: Xs ago" + mismatch marker on `/trader/positions`, reusing
   `formatLastRun` and a `CredentialStatusBadge`-style renders-nothing-when-healthy pattern.
8. Tests per C-08/C-13 pairing at each service step.
