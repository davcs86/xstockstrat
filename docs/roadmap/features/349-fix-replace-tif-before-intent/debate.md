# Debate Register: fix-replace-tif-before-intent

**State**: approved
**Mode**: quick
**Rounds run**: 1

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-16 | /sdd-design | 6 | 5 | 7 | 7 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | In `ReplaceOrder`, the TIF block (validate + wire string) runs right after `resolveAccount` and before `deriveReplaceCancelIntentID`; gates above it keep their order; everything from the derive down is unchanged (dedup switch, `prevIntent`, PENDING mark, `ErrRateLimited` branch, finalize paths). | `trading.go:1558`, `:1564`, `:1603-1604`, `:1613-1622`; `PlaceOrder` `trading.go:519-531` | settled |
| D-2 | 1 | The `brokerReq` literal moves up together with the TIF block, unchanged (a pure move: one `req.TimeInForce != nil` branch, no new local). An absent TIF still sends an empty `TimeInForce`, which both adapters read as "leave unchanged". | `trading.go:1607-1618`; `internal/broker/alpaca.go:389-391`; `internal/broker/ibkr.go:383-385` | settled |
| D-3 | 1 | Precedence: a TIF the broker does not allow returns `InvalidArgument` whatever intent row already exists for that content (PENDING, UNKNOWN, REJECTED, COMPLETED), as in `PlaceOrder`. A row stranded before the fix is no longer reactively reclaimed by an identical retry; the sweeper still reclaims it once. | `trading.go:521-531`, `:1576-1602`; `tif_validation.go:61-70` | settled |
| D-4 | 1 | No `ReleasePendingIntent` and no REJECTED finalize on the TIF path; intent-id derivation unchanged. | TRADING-6, TRADING-8 (`services/xstockstrat-trading/docs/context-constitution.md:20,22`) | settled |
| D-5 | 1 | Tests: new `internal/service/trading_replace_tif_test.go` (package `service`) drives the real handler through `newRLFakeHarness` with the `acct-1` pool entry swapped to IBKR. AC-1 (OPG and CLS on IBKR, explicit UNSPECIFIED) is RED today; AC-2 (corrected retry, then the refused request again) is RED today; AC-4 (refusal beats a seeded UNKNOWN row) is RED today; AC-3 (allowed TIF claims one intent, identical replay collapses, a no-TIF replace sends an empty TIF) is a guard that passes today. Intent state is read from `h.svc.orders[...]` after the call, never from a pointer captured before it. Success-path tests wait for the `order.replaced` ledger event. The broker double is a `replaceOrderFn` hook added to `fakeBroker` (panic stays the default). | `trading_rate_limit_test.go:207,475,491,604`; `trading_flatten_rejection_test.go:40-82`; `trading_bracket_test.go:26-55`; `trading_order_state_audit_test.go:92-103`; `trading.go:422-433` | settled |
| D-6 | 1 | Docs: TRADING-7 gains "and before any order-intent claim" plus the `ReplaceOrder` position and precedence; `CLAUDE.md` § Order Replace gains one caller-facing sentence pointing at TRADING-7. The code comment states the constraint as "must". | `services/xstockstrat-trading/docs/context-constitution.md:21`; `services/xstockstrat-trading/CLAUDE.md` § Order Replace | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Release the intent (`ReleasePendingIntent`) on the TIF error path | TRADING-8 limits the delete to `broker.ErrRateLimited`; operator constraint | locked |
| R-2 | 1 | Finalize the intent REJECTED on the TIF error path | Still writes a row and a PENDING mark for a request that never reached the broker (FR-1); an identical retry would replay the stored row | locked |
| R-3 | 1 | Validate from `order.BrokerType` at the top of the gate chain | Second source of truth for the broker type; reorders errors against halt / trading-state; diverges from `PlaceOrder` | locked |
| R-4 | 1 | Move `resolveAccount` above the earlier gates | Reorders unrelated NotFound / FailedPrecondition errors for no gain | locked |
| R-5 | 1 | A `tifWire` local computed at the validate site, or validating early while keeping the wire assignment in place | Works, but adds a local or a second `req.TimeInForce != nil` branch; the pure move (D-2) is the smaller diff | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | AC-1 must read the order's intent state from the service map after the call; `updateOrder` stores a clone, so a pre-captured pointer passes falsely (C-15) | no | closed @ round 1 (D-5) |
| O-2 | 1 | The empty-ledger check is not RED evidence for "however long the caller waits"; that clause is covered by the zero-row precondition (C-15) | no | closed @ round 1 (D-5; the spec's AC trace says so) |
| O-3 | 1 | FR-2 "or absent" TIF is unpinned: nothing asserts a no-TIF replace sends an empty `TimeInForce` (C-15) | no | closed @ round 1 (D-5: asserted in the AC-3 test) |
| O-4 | 1 | Success-path tests leak the `order.replaced` goroutine; AC-2 should also end with exactly one intent row | no | closed @ round 1 (D-5) |
| O-5 | 1 | A fourth ad-hoc `ReplaceOrder` double duplicates existing ones (C-18 DRY) | no | closed @ round 1 (D-5: `replaceOrderFn` hook on `fakeBroker`) |
| O-6 | 1 | The precedence rule (D-3) is new behavior and only loosely covered by AC-2 (C-15) | no | closed @ round 1 (`@AC-4` appended to acceptance.feature) |
| O-7 | 1 | Code comment worded "may"; the `CLAUDE.md` sentence repeats the invariant | no | closed @ round 1 (D-6) |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
