# xstockstrat-trading — order/broker reconciliation and sync observability

## Order Status Reconciliation

The fill poller (`pollFills`) calls `GetOrder` for every non-terminal order and maps the broker
status via `alpacaStatusToProto`. Terminal statuses (`FILLED`/`CANCELED`/`EXPIRED`/`REJECTED`)
stop reconciliation for that order. **Transient or unrecognized broker statuses map to
`ORDER_STATUS_UNSPECIFIED` and are skipped** — they never overwrite the order's current status,
so reconciliation continues until a real terminal status arrives. In particular, Alpaca's
**`done_for_day`** is non-terminal: it is reported for a `day` order at market close before the
order settles to its true terminal state (`expired` or `filled`). It must **not** map to
`CANCELED` — doing so previously froze the order in a wrong terminal state, after which the poller
stopped and never captured the eventual `expired` (UI showed CANCELED while the broker showed
expired).

## Broker State Reconciliation

`StartReconciliationPoller`/`reconcileTick` (feature 102) periodically compares open orders and
positions against broker truth via `Broker.ListOrders()`/`GetPositions()`, independent of the
fill poller — it is the only path that detects an order placed directly through the broker's own
dashboard, regardless of fill state. A candidate mismatch (unknown broker order, quantity
discrepancy, or missing broker order) must persist across `1 + trading.reconciliation.grace_ticks`
consecutive ticks before it becomes a real finding — a routine partial fill or propagation delay
resolves on its own with no ledger event and no halt (self-heal). A real finding emits
`reconciliation.mismatch_found`, a CRITICAL alert, and routes to the **ordinary, per-account**
halt (`HaltSource_HALT_SOURCE_RECONCILIATION`, reusing feature 030's `broker_accounts.halted`
mechanism).

The `unknown_broker_order` classification is **DB-grounded, not memory-only**. A broker order the
in-memory map (`s.orders`) doesn't recognize is not immediately foreign: `s.orders` holds only this
process's own orders plus `LoadInflightOrders`' NEW/PARTIALLY_FILLED hydrate, so a legitimate order
the platform placed that has since reached a terminal state (FILLED/CANCELED/EXPIRED/REJECTED) is
absent from memory yet still persisted in `trading.orders`. Before flagging any unmatched broker
order, `reconcileTick` calls `reconcileOrderLookup.KnownBrokerOrderIDs` (one DB round-trip per tick,
scoped to the account's unmatched IDs, matching `trading.orders` **and** the bracket leg ids in
`trading.order_brackets` — Alpaca lists bracket legs as top-level orders) — only an order the platform
has **no persisted record of at all** is a genuine `unknown_broker_order`. Comparing against memory alone previously misclassified
every historical terminal order the platform itself placed as foreign, halting the account on a
routine restart; that was an observed production false halt. A transient DB lookup error is
**fail-safe**: the account's unknown-order check is skipped for that tick (re-evaluated next tick),
never a false halt. `emitReconciliationFinding`/`haltAccount` still no-op once the account is
already halted (any source) — defense-in-depth so any residual re-observation of the same order
can't re-fire the ledger event, CRITICAL alert, and ERROR log every tick; nothing in this service
clears a halt except the admin-gated `ResumeAccount` RPC (`ResumeAccountSvc`), so a later finding against an already-halted
account changes no trading behavior.
`reconcileTick` itself also throttles the broker calls (`ListOrders`/`GetPositions`) for an
already-halted account to `trading.reconciliation.halted_poll_interval_ms` (default 5 min) instead
of the ordinary `interval_ms` cadence (`shouldPollHaltedAccount`) — still eventually observing the
account (e.g. a manual broker-dashboard order), just not at full rate for one that already can't
trade. The **position-side** quantity check is **DB-grounded** the same way (feature 206). A broker position
that disagrees with `xstockstrat-portfolio`'s `ListPositions` projection is not immediately a foreign
position: the projection can legitimately lag (fill→`order.filled`→portfolio fold) or be transiently
zeroed by an empty `account.positions.synced`. Before halting, `reconcileTick` calls
`reconcilePositionLookup.NetFilledQtyBySymbol` (one grouped DB round-trip per tick, scoped to the
diverging symbols) — the platform's own net filled qty per symbol from `trading.orders`, **deduped
`DISTINCT ON (order_id)`** so a multi-row order isn't double-counted. If the platform's own fills
already sum to the broker qty (`qtyApproxEqual`, abs ε 1e-6), the broker position is fully explained
and the candidate clears — **no halt**; only a broker qty the platform's orders can't account for (a
genuine dashboard order) halts. A lookup error is **fail-safe** (position check skipped for the tick,
never a false halt), mirroring the order side. Residuals (not closed; full list in feature 206
`context.md` § Archive Synthesis): a stalled `pollFills` leaving `trading.orders.filled_qty` stale;
corporate actions (splits) that change broker qty with no order; Alpaca bracket-leg fills, which never
reach `trading.orders` (leg ids live only in `trading.order_brackets`); and the net being an unbounded
lifetime sum, so any untracked position-reducing fill skews it for that symbol from then on — each can
still trip the position-side halt. A net-zero foreign position is masked by design.

Only a **rare, systemic** finding — `trading.reconciliation.systemic_threshold_pct`
or more of registered accounts erroring/unreachable in one tick — escalates platform-wide to
`trading_state=REDUCE_ONLY` (namespace `platform`) via `xstockstrat-config`'s internal-caller authz channel
(`x-internal-caller`, distinct from the human-role `x-access-scope` header; see
`services/xstockstrat-config/CLAUDE.md`). The same tick also resolves feature 101's `UNKNOWN`
order intents against broker truth (FR-6) — a ledger `order_intent.late_response_conflict` event
first (not yet emitted by 101 today, see the code comment on `resolveUnknownIntents`), falling
back to a broker-side scan by the derived client-order-id nonce for **Alpaca accounts only** (IBKR
never sends a customer-order tag on submission, so its `ListOrders` results never carry one to
match against) — a genuinely inconclusive intent is retried next tick, never guessed.

## Position & Balance Sync Observability

The position-sync poller (`syncPositions`) emits no events on a quiet cycle, which previously made a
silent stall (every account skipped for invalid credentials, or a wedged broker/ledger call)
indistinguishable from a healthy idle service — zero log output for days. The poller now:

- Logs a per-cycle **heartbeat** at INFO: `position sync cycle complete accounts_synced=N accounts_skipped=M accounts_failed=K`.
- Runs a **watchdog**: WARNs `position sync stalled` when accounts are registered but none have synced for >3 intervals.
- WARNs (throttled to once per 15 min/account) when an account is **skipped for invalid credentials**, instead of a DEBUG line invisible at INFO.
- Logs broker **credential status transitions** (OK→INVALID at WARN; recoveries/first-observations at INFO) from the credential-health poller, so a credential that stops working is visible in logs, not only in the UI.

**Feature 294-signal-map-instrumentation** (the 60 s disabled recheck is a code constant; the other cadences are the `*.interval_ms` config defaults above):

- INFO `loop tick ok` carries `loop`, `duration_ms` and optional `state` (no `state` = work was done); a tick writes no record when every item that reached its fallible call failed. Written by `fill_poller` (5 s), `reconciliation` (60 s), `credential_health` (300 s; `disabled` every 60 s while off), `bracket_watchdog` (5 s) and `order_intent_sweeper` (5 s); states `idle`, `skipped`, `disabled`. `position_sync` keeps the heartbeat above and writes no `loop tick ok`, so a `|= "loop tick ok"` filter misses it; portfolio also has a `position_sync` loop, so filter on `service_name` too.
- Instruments: `trading.flatten.outcome{outcome}`, `trading.bracket.outcome{outcome}`, `trading.order_submit{broker_type, outcome accepted|rejected|uncertain|invalid_credentials}`, `trading.ledger_emit{event_type, outcome ok|retried_ok|failed}` (unknown event types map to `other`), `trading.alert_emit{alert_kind, outcome ok|failed}` (typed constants, no `other`), `trading.escalation.systemic` (unlabelled).
- Load-bearing log: ERROR `flattenAndHalt: position lookup failed` (a non-NotFound lookup error; no flatten). `flattenAndHalt: no open position to flatten` is INFO.
