# Debate Register: fix-position-fold-correctness

**State**: in-debate
**Mode**: full
**Rounds run**: 2 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-11 | /sdd-batch | 6 | 5 | 0 | 13 | 0 | yes |
| 2 | 2026-11-11 | /sdd-batch | 5 | 3 | 9 | 9 | 1 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | The portfolio order.filled consumer dedups through an applied-event table inside one tx with pg_advisory_xact_lock and SELECT FOR UPDATE, folding with pnl.FoldFrom. A sequence cursor is not used. | ledgerServiceImpl.ts:308-309 (sequence gaps, no replay of late commits below the walk); pool.go:29-31 (PgBouncer forbids session locks); pnl.go:54 | settled |
| D-2 | 1 | The dedup guard sits before the portfolio position.* emit, so a duplicate fill never re-emits. | portfolio_service.go:466-478, 1356 | settled |
| D-3 | 1 | Bracket-leg observation runs inside a pollFills callee and never calls applyBrokerOrderStatus or touches s.orders or trading.orders. | trading.go:1772-1832, 1903, 1921; trading_repo.go:171; 294 @AC-6 | settled |
| D-4 | 1 | Leg events use order_id and stream key = leg id, side always set, and a deterministic ledger idempotency key bracket-leg:<legID>:<status>:<filledQty>. | ledger 002_idempotency_keys.up.sql:9-10; 251 @AC-17/@AC-4 | settled |
| D-5 | 1 | positionsMu and instance_count: 1 are retained. Only the fill path is made cross-process safe in this feature. | portfolio_service.go:1560,1607; .do/app.yaml:107 | settled |
| D-6 | 1 | OQ-2 (repair of already-inflated accumulators) is out of scope and handed to a separate operator-approved data-repair change. | proposal r1 Assumptions; adversary r1 did not contest | settled |
| D-7 | 2 | Bracket-leg state lives in its own table trading.bracket_legs with PRIMARY KEY (account_id, leg_order_id) and is retired per leg. It is not stored as columns on order_brackets. | trading.go:3612 (resizeBracket blanks the order_brackets leg ids); 005_broker_accounts_halted.up.sql:12-21; adversary r2 did not contest | settled |
| D-8 | 2 | The portfolio applied-event key includes account_id, using the value after the alpaca-default fallback. | ibkr.go:343 (broker-numeric leg ids); portfolio_service.go:435; adversary r2 did not contest | settled |
| D-9 | 2 | The position.closed outbox is a single nullable pending_closed column on the applied row, cleared after a successful emit and re-emitted on a duplicate redelivery. | portfolio_service.go:466-467, 1356; adversary r2 contested only the event_id used for the key | settled |
| D-10 | 2 | A flip through zero emits position.closed for the long, then position.opened for a fresh short row, and the portfolio CLAUDE.md v1 scope-limitation paragraph is rewritten. | pnl.go:80-92; adversary r2 did not contest | settled |
| D-11 | 2 | Leg observation is batched with one Broker.ListOrders per account per tick, with a per-account capped GetOrder fallback for legs missing from the list. | broker.go:69,74; alpaca.go:374-413; ibkr.go:448-482; adversary r2 did not contest | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Per-consumer sequence cursor for the fill consumer | Ledger sequences can gap and late commits below the walk are not replayed, so exactly-once breaks under concurrency (ledgerServiceImpl.ts:308-309). | locked |
| R-2 | 1 | Floor stamped by the migration | The migration runs before deploy while the old binary still folds, so the window up to the first boot would be re-folded. | locked |
| R-3 | 1 | Fail-soft (go/emitLedgerEvent) delivery for bracket-leg fill events | A ledger outage on that tick loses the fill for good once the leg/bracket is retired (trading.go:3879-3883). | locked |
| R-4 | 1 | Bracket-level terminal status (bracketStatusExited) to stop leg observation | It drops sibling-leg fills and fills on CANCELED or flattened brackets (trading.go:1400-1411, 3002). | locked |
| R-5 | 1 | A second keyed variant of appendLedgerEvent | DRY (C-18). The key becomes a parameter, with empty meaning a uuid. | locked |
| R-6 | 2 | Early return from resizeBracket when leg tracking fails | It skips ReArmProtection (trading.go:3615) and the resubmit, leaving the added fill qty unprotected. That is worse than the attribution gap it prevents. | locked |
| R-7 | 2 | Emitting the full cumulative order.filled for a leg baselined at cutover with filled_qty > 0 | It over-reduces a position that sync already set to broker truth, flips it into a phantom short and false-halts reconciliation (206 trading @AC-1). | locked |
| R-8 | 2 | Re-emitting pending_closed with a key derived from the incoming event_id | A producer duplicate carries a fresh uuid (trading.go:3848), so the key is fresh and position.closed is emitted twice. | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | Leg terminal state must be tracked per leg, and every leg of a non-FAILED bracket (CANCELED included) observed until the broker reports that leg terminal. | yes | closed @ round 2 (Per-leg trading.bracket_legs table keyed (account_id, leg_order_id). Legs are retired only on broker-terminal status or not-found, with FAILED and CANCELED brackets still observed.) |
| O-2 | 1 | Leg emits must be synchronous appendLedgerEvent with a deterministic key, and leg state advanced only after a nil return. A ledger-down retry test is required. | yes | closed @ round 2 (Synchronous appendLedgerEvent with the key parameter, row advanced only after a nil return, and a ledger-down retry test in the build order. The stall concern is tracked as a new objection.) |
| O-3 | 1 | Cutover: stop-then-start for the first deploy, or operator sign-off on the time floor and the overlap double-apply, plus a boot log of the count acked below the floor. | no | open |
| O-4 | 1 | The applied key should be (consumer, order_id) to absorb producer-side duplicate order.filled events. | no | closed @ round 2 (The applied PK is (consumer, user_id, account_id, order_id). The producer duplicate paths are enumerated (trading.go:1861, 1877-1879, 1896).) |
| O-5 | 1 | The position.closed emit is at-most-once after commit. It needs an emitted_at outbox re-emit or a named residual. | no | closed @ round 2 (pending_closed outbox column, cleared on emit success and re-emitted on a duplicate. The stored event_id requirement is tracked as a new objection.) |
| O-6 | 1 | A flip through zero emits no position.closed. Decide the semantics and rewrite the portfolio CLAUDE.md limitation paragraph. | no | closed @ round 2 (Closed for the long, then opened for a fresh short row. The CLAUDE.md paragraph is rewritten.) |
| O-7 | 1 | Per-leg GetOrder every tick exceeds the broker rate limit. Batch with ListOrders per account (C-18). | no | closed @ round 2 (One ListOrders per account plus a capped GetOrder fallback, with the per-tick budget stated.) |
| O-8 | 1 | outcome=parked cannot be produced as wired. Specify the sentinel mapping in observed() and accept that it re-parks on every boot. | no | open |
| O-9 | 1 | The idempotency key should be a parameter, and the side parser must be reused from GetPnL/orderSide (C-18 DRY). | no | closed @ round 2 (signedQty (portfolio_service.go:1065) reused; appendLedgerEvent and emitEventAs gain a key parameter where empty means a uuid.) |
| O-10 | 1 | The unused consumer_applied_events.sequence column should be dropped (YAGNI). | no | closed @ round 2 (No sequence column on consumer_applied_events.) |
| O-11 | 1 | The AC-5 amendment needs pinned wording (qty = leg total 10, fill_price = leg cumulative average) and operator sign-off. | no | open |
| O-12 | 1 | The IBKR resizeBracket hazard is unbounded. Do a synchronous old-leg fetch and emit the delta at the CANCELING transition. | no | closed @ round 2 (Old leg rows persist in bracket_legs after resizeBracket blanks the order_brackets columns (trading.go:3612) and stay observable until terminal, so no synchronous fetch is needed.) |
| O-13 | 1 | The worsened reconciliation gap (leg fills absent from NetFilledQtyBySymbol) should be raised with the operator. | no | open |
| O-14 | 2 | observed() (portfolio_service.go:231-242) maps no sentinel. It must add explicit branches (new errFillAcked: count acked, return nil; ErrFillUnattributable: count parked, ERROR "event parked", return nil), prove that no other wrapped consumer returns either sentinel, and add telemetry tests. Otherwise the floor ack hot-loops and stalls the fill consumer. | yes | open |
| O-15 | 2 | A leg baselined at cutover with filled_qty > 0 must be retired without emit. A cumulative terminal emit over-reduces and false-halts reconciliation. | yes | open |
| O-16 | 2 | The duplicate-path pending_closed re-emit must key on the stored row's event_id, not the incoming one. A test with two event_ids for one order_id is required. | yes | open |
| O-17 | 2 | Pending REOPEN D-4: the leg idempotency key must be account-scoped, because ledger.idempotency_keys is a global PK and IBKR leg ids can repeat across accounts. Either the operator rules on the amendment or the spec proves uniqueness. | yes | open |
| O-18 | 2 | Write bracket_legs rows at leg-id assignment (createBracket and the resize ACTIVE update) in the same tx, with an alert on failure, instead of the per-tick EnsureLegsTracked sweep and the resize early return. | no | open |
| O-19 | 2 | Synchronous leg emits need a per-tick budget that stops leg emits after the first failure, so pollFills, IBKR leg submits and the protection watchdog are not starved. | no | open |
| O-20 | 2 | Legs the broker no longer returns must be retired as terminal UNKNOWN with a WARN, and not polled forever. | no | open |
| O-21 | 2 | Boot replay of every post-floor fill (one tx each, PgBouncer pool of 2, unpruned applied table) must be named as a residual with a growth estimate. | no | open |
| O-22 | 2 | The O-3 cutover residual must also name fills the old binary never folded before the first new boot, and late-commit appends whose recorded_at predates the floor. Both are acked and permanently lost from the live fold. | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
| P-1 | 2 | D-4 | ledger.idempotency_keys.idempotency_key is a bare global PRIMARY KEY (services/xstockstrat-ledger/migrations/002_idempotency_keys.up.sql:10). IBKR leg ids are broker-numeric and may repeat across accounts (ibkr.go:343, first argued in proposal r2). Requested amendment: bracket-leg:<account_id>:<legID>:<status>:<filledQty>. Filed by the adversary in r2. | pending user |
